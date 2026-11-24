import { randomUUID } from "node:crypto";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { isAbsolute } from "node:path";
import type { ScanRunInput } from "@desarrolloseguro/persistence";
import { assessPrivacy, assessPublicServiceComparison } from "@desarrolloseguro/core";
import { SCAN_FAILURE_CODES, type ScanFailureCode } from "@desarrolloseguro/core";
import {
  MAX_EXECUTOR_RESPONSE_BYTES,
  parseTransportV1ExecutorResponse,
  type TransportV1ExecutorRequest,
} from "./transport-v1-executor-protocol.js";
import type { RuntimeCoordinatorRunner } from "./runtime-coordinator-server.js";
import { assessPrivacyObservation, getObservedPublicServices } from "./privacy-assessment-builder.js";
import { buildLegalCookieFindings } from "./privacy-legal-cookie-findings.js";
import { assessFirstEntryPolicyAccessObservation } from "./privacy-first-entry-policy-access.js";
import type { PrivacyBrowserObservation } from "./privacy-browser-observer.js";
import {
  createJsonLineRuntimeDiagnostic,
  RUNTIME_DIAGNOSTIC_CODES,
  type RuntimeDiagnosticCode,
  type RuntimeDiagnosticEvent,
  type RuntimeDiagnosticStage,
  type RuntimeDiagnosticWriter,
  attachScanFailureDiagnostic,
} from "./runtime-diagnostics.js";

const DEFAULT_BROKER_STARTUP_TIMEOUT_MS = 20_000;
const DOCKER_COMMAND_TIMEOUT_MS = 10_000;
const DOCKER_CLEANUP_COMMAND_TIMEOUT_MS = 3_000;
const DOCKER_CLEANUP_ATTEMPTS = 3;
const DOCKER_CLEANUP_RETRY_DELAY_MS = 100;
const LEGACY_EXECUTOR_COMMAND_TIMEOUT_MS = 38_000;
const DOMAIN_V3_EXECUTOR_COMMAND_TIMEOUT_MS = 158_000;
const PRIVACY_BROWSER_COMMAND_TIMEOUT_MS = 125_000;
const BROKER_STOP_TIMEOUT_MS = 3_000;
const MAX_DOCKER_COMMAND_OUTPUT_BYTES = 256 * 1024;
const MAX_DOCKER_ERROR_OUTPUT_BYTES = 4 * 1024;
const MAX_BROKER_STARTUP_OUTPUT_BYTES = 4 * 1024;
const MAX_BROKER_STARTUP_ERROR_BYTES = 4 * 1024;
const EGRESS_SOCKET_DIRECTORY = "/run/development-security-egress";
const VOLUME_PREFIX = "development-security-job-";
const BROKER_CONTAINER_PREFIX = "development-security-broker-";
const EXECUTOR_CONTAINER_PREFIX = "development-security-executor-";
const PRIVACY_NETWORK_PREFIX = "development-security-privacy-";
const PRIVACY_PROXY_PREFIX = "development-security-privacy-proxy-";
const PRIVACY_BROWSER_PREFIX = "development-security-privacy-browser-";
const SAFE_BROKER_STARTUP_FAILURES = new Set([
  "egress_broker_startup_invalid",
  "egress_broker_startup_failed",
  "egress_broker_socket_invalid",
  "egress_broker_socket_directory_invalid",
  "egress_broker_socket_setup_failed",
  "egress_broker_socket_listen_failed",
  "runtime_broker_process_error",
  "runtime_broker_process_exited",
  "runtime_broker_process_killed",
  "runtime_broker_application_failed",
  "runtime_broker_container_start_failed",
  "runtime_broker_entrypoint_failed",
  "runtime_broker_ready_timeout",
  "runtime_broker_module_load_failed",
  "runtime_broker_core_package_missing",
  "runtime_broker_html_parser_missing",
  "runtime_broker_persistence_package_missing",
  "runtime_broker_entrypoint_module_missing",
  "runtime_broker_permission_denied",
  "runtime_broker_file_missing",
]);
const IMAGE_REFERENCE = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$/u;
const NETWORK_REFERENCE = /^(?:none|[A-Za-z0-9][A-Za-z0-9_.-]{0,127})$/u;
const BROKER_INITIALIZER =
  `chown 1000:1000 ${EGRESS_SOCKET_DIRECTORY} && chmod 0700 ${EGRESS_SOCKET_DIRECTORY}`;

export type DockerRuntimeCoordinatorRunnerOptions = {
  executorImage: string;
  brokerImage: string;
  privacyBrowserImage?: string;
  privacyEgressImage?: string;
  dockerBinary?: string;
  dockerSocketPath?: string;
  brokerNetwork?: string;
  brokerStartupTimeoutMs?: number;
  diagnostic?: RuntimeDiagnosticWriter;
};

export type DockerRuntimeSession = {
  execute(
    request: TransportV1ExecutorRequest,
    signal: AbortSignal,
  ): Promise<unknown>;
  observePrivacy?(request: TransportV1ExecutorRequest, signal: AbortSignal): Promise<PrivacyBrowserObservation>;
  close(): Promise<void>;
};

export type DockerRuntimeSessionFactory = {
  diagnostic?: RuntimeDiagnosticWriter;
  create(
    request: TransportV1ExecutorRequest,
    signal: AbortSignal,
  ): Promise<DockerRuntimeSession>;
  getLastDiagnostic?(): RuntimeDiagnosticEvent | null;
};

/** Runs one executor/broker pair, validates its response, and always tears it down. */
export function createDockerRuntimeCoordinatorRunner(
  factory: DockerRuntimeSessionFactory,
): RuntimeCoordinatorRunner {
  const diagnostic = factory.diagnostic ?? createJsonLineRuntimeDiagnostic();
  return {
    async execute(request, signal): Promise<
      Omit<ScanRunInput, "jobId" | "leaseToken" | "hostname" | "profileVersion">
    > {
      if (signal.aborted) throw new Error("request_aborted");
      let session: DockerRuntimeSession | undefined;
      let result:
        | Omit<
            ScanRunInput,
            "jobId" | "leaseToken" | "hostname" | "profileVersion"
          >
        | undefined;
      let executionError: unknown;
      let executorDiagnostic: RuntimeDiagnosticEvent | null = null;
      try {
        session = await factory.create(request, signal);
        if (signal.aborted) throw new Error("request_aborted");
        const responseInput = await session.execute(request, signal);
        let response: ReturnType<typeof parseTransportV1ExecutorResponse>;
        try {
          response = parseTransportV1ExecutorResponse(
            responseInput,
            request.requestId,
            request.profileVersion,
          );
        } catch {
          throw new Error("executor_response_invalid");
        }
        if ("errorCode" in response) {
          if (response.diagnostic?.category === "network_observation_unavailable") {
            executorDiagnostic = {
              type: "runtime_diagnostic",
              stage: "executor",
              code: "executor_application_failed",
              probeFailures: response.diagnostic.probeFailures,
            };
            diagnostic(executorDiagnostic);
          }
          throw new Error(
            response.errorCode === "request_invalid"
              ? "transport_failed"
              : response.errorCode,
          );
        }
        result = response.result;
        let privacyAssessment = assessPrivacy({ criteria: [] });
        let legalCookieFindings: ReturnType<typeof buildLegalCookieFindings> = [];
        let observation: PrivacyBrowserObservation | undefined;
        try {
          observation = await session.observePrivacy?.(request, signal);
          if (observation) {
            privacyAssessment = assessPrivacyObservation(observation);
            legalCookieFindings = buildLegalCookieFindings(observation);
          }
        } catch {
          // Privacy browser failures lower coverage but never block the established scan or certification.
        }
        const publicServiceComparison = result.publicPolicyTransparencyAssessment
          ? assessPublicServiceComparison({
              observed: observation ? getObservedPublicServices(observation) : [],
              declared: result.publicServiceDeclarations ?? [],
              policyStatus: result.publicPolicyTransparencyAssessment?.status ?? "unknown",
              auditorError: result.publicServiceDeclarations === undefined || !observation || [observation.initial, observation.accept, observation.reject]
                .some(({ status }) => status === "unknown"),
            })
          : null;
        const firstEntryPolicyAccess = assessFirstEntryPolicyAccessObservation(observation ?? null);
        const completedResult = { ...result };
        result = {
          ...completedResult,
          privacyAssessment,
          legalCookieFindings,
          firstEntryPolicyAccess,
          ...(publicServiceComparison ? { publicServiceComparison } : {}),
        };
      } catch (error) {
        executionError = error;
      }
      try {
        await session?.close();
      } catch (cleanupError: unknown) {
        if (executionError === undefined) {
          executionError = new Error("runtime_volume_failed", { cause: cleanupError });
        }
      }
      if (executionError !== undefined) {
        if (
          signal.aborted ||
          (executionError instanceof Error &&
            executionError.message === "request_aborted")
        ) {
          throw new Error("request_aborted", { cause: executionError });
        }
        const failure = new Error(getRuntimeFailureCode(executionError), { cause: executionError });
        const runtimeDiagnostic = factory.getLastDiagnostic?.() ?? null;
        const safeDiagnostic = executorDiagnostic ?? runtimeDiagnostic ?? {
          type: "runtime_diagnostic" as const,
          stage: "executor" as const,
          code: "executor_application_failed" as const,
        };
        throw attachScanFailureDiagnostic(
          failure,
          safeDiagnostic,
        );
      }
      if (!session || !result) {
        throw attachScanFailureDiagnostic(new Error("executor_failed"), {
          type: "runtime_diagnostic",
          stage: "executor",
          code: "executor_application_failed",
        });
      }
      return result;
    },
  };
}

function getRuntimeFailureCode(error: unknown): ScanFailureCode {
  const message = error instanceof Error ? error.message : "";
  if (SCAN_FAILURE_CODES.includes(message as ScanFailureCode)) {
    return message as ScanFailureCode;
  }
  if (SAFE_BROKER_STARTUP_FAILURES.has(message)) return "broker_failed";
  if (message === "runtime_coordinator_unavailable") return "coordinator_unavailable";
  if (message === "runtime_coordinator_socket_untrusted") return "coordinator_socket_untrusted";
  if (message.startsWith("runtime_volume_") || message === "runtime_cleanup_failed") {
    return "runtime_volume_failed";
  }
  if (message.startsWith("runtime_broker_")) return "broker_failed";
  if (message.includes("egress")) return "egress_failed";
  if (message === "executor_response_invalid" || message === "executor_result_invalid") {
    return "transport_failed";
  }
  return "executor_failed";
}

/** Creates a private, network-disabled Docker runtime for each job. */
export function createDockerRuntimeSessionFactory(
  options: DockerRuntimeCoordinatorRunnerOptions,
): DockerRuntimeSessionFactory {
  const dockerBinary = options.dockerBinary ?? "docker";
  const dockerSocketPath = options.dockerSocketPath ?? "/var/run/docker.sock";
  const brokerNetwork = options.brokerNetwork ?? "none";
  const brokerStartupTimeoutMs = options.brokerStartupTimeoutMs ?? DEFAULT_BROKER_STARTUP_TIMEOUT_MS;
  const diagnosticWriter = options.diagnostic ?? createJsonLineRuntimeDiagnostic();
  let lastDiagnostic: RuntimeDiagnosticEvent | null = null;
  const diagnostic: RuntimeDiagnosticWriter = (event) => {
    try {
      lastDiagnostic = event;
      diagnosticWriter(event);
    } catch {
      // A diagnostic sink must never change runtime behavior.
    }
  };
  if (
    !IMAGE_REFERENCE.test(options.executorImage) ||
    !IMAGE_REFERENCE.test(options.brokerImage) ||
    (options.privacyBrowserImage !== undefined && !IMAGE_REFERENCE.test(options.privacyBrowserImage)) ||
    (options.privacyEgressImage !== undefined && !IMAGE_REFERENCE.test(options.privacyEgressImage)) ||
    ((options.privacyBrowserImage === undefined) !== (options.privacyEgressImage === undefined)) ||
    dockerBinary.length === 0 ||
    !isAbsolute(dockerSocketPath) ||
    !NETWORK_REFERENCE.test(brokerNetwork) ||
    !Number.isSafeInteger(brokerStartupTimeoutMs) ||
    brokerStartupTimeoutMs < 1 ||
    brokerStartupTimeoutMs > 30_000
  ) {
    throw new Error("docker_runtime_config_invalid");
  }

  return {
    diagnostic,
    getLastDiagnostic: () => lastDiagnostic,
    async create(request, signal): Promise<DockerRuntimeSession> {
      lastDiagnostic = null;
      if (signal.aborted) throw new Error("request_aborted");
      const runtimeId = randomUUID();
      const volumeName = `${VOLUME_PREFIX}${runtimeId}`;
      const brokerName = `${BROKER_CONTAINER_PREFIX}${runtimeId}`;
      const executorName = `${EXECUTOR_CONTAINER_PREFIX}${runtimeId}`;
      const privacyNetworkName = `${PRIVACY_NETWORK_PREFIX}${runtimeId}`;
      const privacyProxyName = `${PRIVACY_PROXY_PREFIX}${runtimeId}`;
      const privacyBrowserName = `${PRIVACY_BROWSER_PREFIX}${runtimeId}`;
      let volumeMayExist = false;
      let brokerProcess: ChildProcessWithoutNullStreams | undefined;
      let executorMayExist = false;
      let privacyNetworkMayExist = false;
      let privacyProxyMayExist = false;
      let privacyBrowserMayExist = false;
      let closed = false;

      const close = async () => {
        if (closed) return;
        closed = true;
        let cleanupFailed = false;
        if (executorMayExist) {
          const removed = await removeContainer(
            dockerBinary,
            executorName,
            dockerSocketPath,
            "executor_container_cleanup",
            diagnostic,
          );
          if (!removed) cleanupFailed = true;
          executorMayExist = false;
        }
        for (const [name, active] of [[privacyBrowserName, privacyBrowserMayExist], [privacyProxyName, privacyProxyMayExist]] as const) {
          if (active && !await removeContainer(dockerBinary, name, dockerSocketPath, "executor_container_cleanup", diagnostic)) cleanupFailed = true;
        }
        if (privacyNetworkMayExist) {
          try {
            await runDockerCleanup(dockerBinary, ["network", "rm", privacyNetworkName], dockerSocketPath, /not found|no such network/iu, "executor_container_cleanup", diagnostic);
          } catch { cleanupFailed = true; }
        }
        if (brokerProcess) {
          const removed = await removeContainer(
            dockerBinary,
            brokerName,
            dockerSocketPath,
            "broker_container_cleanup",
            diagnostic,
          );
          const processClosed = await waitForChildClose(brokerProcess, BROKER_STOP_TIMEOUT_MS);
          if (!removed && !processClosed) cleanupFailed = true;
          if (!processClosed) brokerProcess.kill("SIGKILL");
          brokerProcess = undefined;
        }
        if (volumeMayExist) {
          const removed = await removeVolume(
            dockerBinary,
            volumeName,
            dockerSocketPath,
            diagnostic,
          );
          if (!removed) cleanupFailed = true;
          volumeMayExist = false;
        }
        if (cleanupFailed) throw new Error("runtime_cleanup_failed");
      };

      let startupFailureCode = "runtime_volume_create_failed";
      try {
        try {
          await runDocker(dockerBinary, [
            "volume", "create",
            "--label", "io.desarrolloseguro.role=ephemeral-runtime",
            volumeName,
          ], undefined, signal, undefined, undefined, undefined, dockerSocketPath);
          volumeMayExist = true;
        } catch (error) {
          await removeVolume(dockerBinary, volumeName, dockerSocketPath, diagnostic);
          throw error;
        }
        startupFailureCode = "runtime_volume_prepare_failed";
        await initializeBrokerVolume(
          dockerBinary,
          dockerSocketPath,
          options.brokerImage,
          volumeName,
          signal,
        );
        startupFailureCode = "runtime_broker_start_failed";
        brokerProcess = startBroker(
          dockerBinary,
          options.brokerImage,
          dockerSocketPath,
          brokerNetwork,
          brokerName,
          volumeName,
          { hostname: request.hostname, profileVersion: request.profileVersion },
        );
        startupFailureCode = "runtime_broker_ready_failed";
        await waitForBrokerReady(brokerProcess, signal, brokerStartupTimeoutMs);
      } catch (error) {
        diagnostic({
          type: "runtime_diagnostic",
          stage: getStartupDiagnosticStage(startupFailureCode),
          code: getRuntimeDiagnosticCode(error),
        });
        try {
          await close();
        } catch (cleanupError) {
          throw new Error("runtime_cleanup_failed", { cause: cleanupError });
        }
        if (error instanceof Error && SAFE_BROKER_STARTUP_FAILURES.has(error.message)) {
          throw error;
        }
        if (error instanceof Error && error.message === "request_aborted") throw error;
        throw new Error(startupFailureCode, { cause: error });
      }

      return {
        execute: async (executorRequest, executorSignal) => {
          if (closed || executorSignal.aborted) throw new Error("request_aborted");
          executorMayExist = true;
          try {
            const output = await runDocker(
              dockerBinary,
              executorArguments(options.executorImage, volumeName, executorName),
              `${JSON.stringify(executorRequest)}\n`,
              executorSignal,
              MAX_EXECUTOR_RESPONSE_BYTES,
              true,
              getExecutorCommandTimeoutMs(executorRequest.profileVersion),
              dockerSocketPath,
            );
            try {
              return JSON.parse(output.trim()) as unknown;
            } catch (error) {
              throw new Error("executor_response_invalid", { cause: error });
            }
          } catch (error) {
            if (!(error instanceof Error) || error.message !== "request_aborted") {
              diagnostic({
                type: "runtime_diagnostic",
                stage: "executor",
                code: getRuntimeDiagnosticCode(error),
              });
            }
            throw error;
          }
        },
        observePrivacy: async (privacyRequest, privacySignal) => {
          if (!options.privacyBrowserImage || !options.privacyEgressImage) {
            throw new Error("privacy_runtime_images_missing");
          }
          if (closed || privacySignal.aborted) throw new Error("request_aborted");
          const browserInput = JSON.stringify({ protocolVersion: 1, requestId: privacyRequest.requestId, hostname: privacyRequest.hostname });
          privacyNetworkMayExist = true;
          await runDocker(dockerBinary, ["network", "create", "--internal", "--label", "io.desarrolloseguro.role=ephemeral-privacy", privacyNetworkName], undefined, privacySignal, undefined, undefined, undefined, dockerSocketPath);
          privacyProxyMayExist = true;
          await runDocker(dockerBinary, ["run", "--detach", "--name", privacyProxyName, "--network", brokerNetwork, "--read-only", "--user", "1000:1000", "--cap-drop", "ALL", "--security-opt", "no-new-privileges", "--pids-limit", "64", "--memory", "128m", "--cpus", "0.25", "--tmpfs", "/tmp:rw,noexec,nosuid,size=16m,uid=1000,gid=1000", "--env", "DS_PRIVACY_MAX_RECEIVED_BYTES=20971520", options.privacyEgressImage], undefined, privacySignal, undefined, undefined, undefined, dockerSocketPath);
          await runDocker(dockerBinary, ["network", "connect", "--alias", "privacy-egress", privacyNetworkName, privacyProxyName], undefined, privacySignal, undefined, undefined, undefined, dockerSocketPath);
          await waitForPrivacyProxy(dockerBinary, dockerSocketPath, privacyProxyName, privacySignal);
          privacyBrowserMayExist = true;
          const output = await runDocker(dockerBinary, ["run", "--interactive", "--name", privacyBrowserName, ...restrictedPrivacyBrowserArguments(privacyNetworkName), options.privacyBrowserImage], `${browserInput}\n`, privacySignal, 256 * 1024, false, PRIVACY_BROWSER_COMMAND_TIMEOUT_MS, dockerSocketPath);
          try {
            let observation = JSON.parse(output.trim()) as PrivacyBrowserObservation;
            const proxyStats = await stopPrivacyProxyAndReadStats(dockerBinary, dockerSocketPath, privacyProxyName, privacySignal);
            if (!proxyStats || proxyStats.receivedBytes > 20 * 1024 * 1024 || proxyStats.budgetExceeded) {
              observation = {
                ...observation,
                status: "partial",
                receivedBytes: proxyStats?.receivedBytes ?? null,
                vendorControlCoverage: "partial",
                vendorControls: observation.vendorControls.map((check) => ({
                  ...check,
                  status: "unknown",
                  disabled: null,
                  persistedDisabled: null,
                  signalHostsAfterDisable: [],
                  completedHostsAfterDisable: [],
                  cookiesAfterDisable: [],
                })),
                initial: { ...observation.initial, status: "unknown", cookieReadComplete: false, storageReadComplete: false },
                accept: { ...observation.accept, status: "unknown", cookieReadComplete: false, storageReadComplete: false },
                reject: { ...observation.reject, status: "unknown", cookieReadComplete: false, storageReadComplete: false },
              };
            } else {
              observation = { ...observation, receivedBytes: proxyStats.receivedBytes };
            }
            return observation;
          } catch { throw new Error("privacy_browser_response_invalid"); }
        },
        close,
      };
    },
  };
}

function getExecutorCommandTimeoutMs(profileVersion: string): number {
  return profileVersion === "domain-v3"
    ? DOMAIN_V3_EXECUTOR_COMMAND_TIMEOUT_MS
    : LEGACY_EXECUTOR_COMMAND_TIMEOUT_MS;
}

async function initializeBrokerVolume(
  dockerBinary: string,
  dockerSocketPath: string,
  brokerImage: string,
  volumeName: string,
  signal: AbortSignal,
): Promise<void> {
  await runDocker(dockerBinary, [
    "run", "--rm",
    "--network", "none",
    "--user", "0:0",
    "--mount", `type=volume,source=${volumeName},target=${EGRESS_SOCKET_DIRECTORY}`,
    "--entrypoint", "/bin/sh",
    brokerImage,
    "-c", BROKER_INITIALIZER,
  ], undefined, signal, undefined, undefined, undefined, dockerSocketPath);
}

function startBroker(
  dockerBinary: string,
  brokerImage: string,
  dockerSocketPath: string,
  brokerNetwork: string,
  brokerName: string,
  volumeName: string,
  options: { hostname: string; profileVersion: TransportV1ExecutorRequest["profileVersion"] },
): ChildProcessWithoutNullStreams {
  const child = spawn(dockerBinary, dockerCommandArguments(dockerSocketPath, [
    "run", "--interactive",
    "--name", brokerName,
    ...restrictedContainerArguments(brokerNetwork),
    "--mount", `type=volume,source=${volumeName},target=${EGRESS_SOCKET_DIRECTORY}`,
    brokerImage,
  ]), { stdio: ["pipe", "pipe", "pipe"] });
  child.stdin.end(`${JSON.stringify({
    protocolVersion: 1,
    hostname: options.hostname,
    profileVersion: options.profileVersion,
  })}\n`);
  return child;
}

function executorArguments(
  executorImage: string,
  volumeName: string,
  executorName: string,
): string[] {
  return [
    "run", "--interactive",
    "--name", executorName,
    ...restrictedContainerArguments("none"),
    "--mount", `type=volume,source=${volumeName},target=${EGRESS_SOCKET_DIRECTORY},readonly`,
    executorImage,
  ];
}

function restrictedContainerArguments(network: string): string[] {
  return [
    "--network", network,
    "--read-only",
    "--user", "1000:1000",
    "--cap-drop", "ALL",
    "--security-opt", "no-new-privileges",
    "--pids-limit", "64",
    "--memory", "256m",
    "--cpus", "0.5",
    "--tmpfs", "/tmp:rw,noexec,nosuid,size=16m,uid=1000,gid=1000",
  ];
}

function restrictedPrivacyBrowserArguments(network: string): string[] {
  return ["--network", network, "--read-only", "--user", "1000:1000", "--cap-drop", "ALL",
    "--security-opt", "no-new-privileges", "--pids-limit", "128", "--memory", "512m", "--cpus", "0.5",
    "--shm-size", "128m", "--tmpfs", "/tmp:rw,noexec,nosuid,size=64m,uid=1000,gid=1000"];
}

async function waitForPrivacyProxy(
  dockerBinary: string,
  dockerSocketPath: string,
  containerName: string,
  signal: AbortSignal,
): Promise<void> {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    if (signal.aborted) throw new Error("request_aborted");
    try {
      const output = await runDocker(dockerBinary, ["logs", "--tail", "20", containerName], undefined, signal,
        MAX_BROKER_STARTUP_OUTPUT_BYTES, true, 1_000, dockerSocketPath);
      if (output.includes('"event":"privacy_proxy_ready"')) return;
    } catch { /* The container may not have emitted its startup line yet. */ }
    await new Promise((resolveWait) => setTimeout(resolveWait, 100));
  }
  throw new Error("privacy_proxy_ready_timeout");
}

async function stopPrivacyProxyAndReadStats(
  dockerBinary: string,
  dockerSocketPath: string,
  containerName: string,
  signal: AbortSignal,
): Promise<{ receivedBytes: number; budgetExceeded: boolean } | null> {
  try {
    await runDocker(dockerBinary, ["stop", "--time", "3", containerName], undefined, signal,
      MAX_BROKER_STARTUP_OUTPUT_BYTES, false, 5_000, dockerSocketPath);
    const output = await runDocker(dockerBinary, ["logs", "--tail", "20", containerName], undefined, signal,
      MAX_BROKER_STARTUP_OUTPUT_BYTES, true, 1_000, dockerSocketPath);
    for (const line of output.split(/\r?\n/u).reverse()) {
      try {
        const value: unknown = JSON.parse(line);
        if (isRecord(value) && value.event === "privacy_proxy_stats" && Number.isSafeInteger(value.receivedBytes) &&
            typeof value.budgetExceeded === "boolean") {
          return { receivedBytes: value.receivedBytes as number, budgetExceeded: value.budgetExceeded };
        }
      } catch { /* Ignore bounded startup lines. */ }
    }
  } catch { return null; }
  return null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function waitForBrokerReady(
  child: ChildProcessWithoutNullStreams,
  signal: AbortSignal,
  timeoutMs: number,
): Promise<void> {
  return new Promise((resolve, reject) => {
    let receivedBytes = 0;
    let buffer = "";
    let stderrBuffer = "";
    let startupFailureCode: string | undefined;
    let settled = false;
    const timer = setTimeout(() => finish(new Error("runtime_broker_ready_timeout")), timeoutMs);
    const onAbort = () => finish(new Error("request_aborted"));
    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal.removeEventListener("abort", onAbort);
      child.stdout.removeListener("data", onData);
      child.stderr.removeListener("data", onStderr);
      child.removeListener("error", onError);
      child.removeListener("close", onClose);
      if (error) reject(error);
      else resolve();
    };
    const onData = (chunk: Buffer) => {
      receivedBytes += chunk.byteLength;
      if (receivedBytes > MAX_BROKER_STARTUP_OUTPUT_BYTES) {
        finish(new Error("runtime_coordinator_unavailable"));
        return;
      }
      buffer += chunk.toString("utf8");
      if (buffer.split(/\r?\n/u).some((line) => line === '{"protocolVersion":1,"state":"ready"}')) {
        finish();
      }
    };
    const onStderr = (chunk: Buffer) => {
      const output = chunk.toString("utf8");
      if (stderrBuffer.length < MAX_BROKER_STARTUP_ERROR_BYTES) {
        stderrBuffer += output.slice(0, MAX_BROKER_STARTUP_ERROR_BYTES - stderrBuffer.length);
      }
      const code = output.trim();
      if (SAFE_BROKER_STARTUP_FAILURES.has(code)) startupFailureCode = code;
    };
    const onError = () => finish(new Error(startupFailureCode ?? "runtime_broker_process_error"));
    const onClose = (exitCode: number | null, signalName: string | null) => {
      if (startupFailureCode) {
        finish(new Error(startupFailureCode));
        return;
      }
      const diagnosticCode = classifyBrokerStartupStderr(stderrBuffer);
      if (diagnosticCode) {
        finish(new Error(diagnosticCode));
        return;
      }
      if (signalName === "SIGKILL") {
        finish(new Error("runtime_broker_process_killed"));
        return;
      }
      if (exitCode === 125) {
        finish(new Error("runtime_broker_container_start_failed"));
        return;
      }
      if (exitCode === 126 || exitCode === 127) {
        finish(new Error("runtime_broker_entrypoint_failed"));
        return;
      }
      if (exitCode === 1) {
        finish(new Error("runtime_broker_application_failed"));
        return;
      }
      finish(new Error("runtime_broker_process_exited"));
    };
    child.stdout.on("data", onData);
    child.stderr.on("data", onStderr);
    child.once("error", onError);
    child.once("close", onClose);
    signal.addEventListener("abort", onAbort, { once: true });
    if (signal.aborted) onAbort();
  });
}

export function classifyBrokerStartupStderr(output: string): string | undefined {
  const normalized = output.toLowerCase();
  if (normalized.includes("@desarrolloseguro/core")) {
    return "runtime_broker_core_package_missing";
  }
  if (normalized.includes("@desarrolloseguro/persistence")) {
    return "runtime_broker_persistence_package_missing";
  }
  if (normalized.includes("parse5")) return "runtime_broker_html_parser_missing";
  if (normalized.includes("transport-v1-egress-broker-child")) {
    return "runtime_broker_entrypoint_module_missing";
  }
  if (normalized.includes("cannot find module") || normalized.includes("module_not_found")) {
    return "runtime_broker_module_load_failed";
  }
  if (normalized.includes("permission denied") || normalized.includes("operation not permitted")) {
    return "runtime_broker_permission_denied";
  }
  if (normalized.includes("no such file or directory")) {
    return "runtime_broker_file_missing";
  }
  return undefined;
}

async function runDocker(
  dockerBinary: string,
  args: string[],
  input?: string,
  signal?: AbortSignal,
  maxOutputBytes = MAX_DOCKER_COMMAND_OUTPUT_BYTES,
  allowNonZeroExit = false,
  timeoutMs = DOCKER_COMMAND_TIMEOUT_MS,
  dockerSocketPath = "/var/run/docker.sock",
  acceptNonZeroStderr?: RegExp,
): Promise<string> {
  if (signal?.aborted) throw new Error("request_aborted");
  return new Promise((resolve, reject) => {
    const child = spawn(dockerBinary, dockerCommandArguments(dockerSocketPath, args), {
      stdio: ["pipe", "pipe", "pipe"],
    });
    const chunks: Buffer[] = [];
    const errorChunks: Buffer[] = [];
    let receivedBytes = 0;
    let receivedErrorBytes = 0;
    let settled = false;
    const timeout = setTimeout(() => {
      child.kill("SIGTERM");
      finish(new Error("docker_command_timeout"));
    }, timeoutMs);
    const onAbort = () => {
      child.kill("SIGTERM");
      finish(new Error("request_aborted"));
    };
    const finish = (error?: Error, output = "") => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      signal?.removeEventListener("abort", onAbort);
      if (error) reject(error);
      else resolve(output);
    };
    child.stdout?.on("data", (chunk: Buffer) => {
      receivedBytes += chunk.byteLength;
      if (receivedBytes > maxOutputBytes) {
        child.kill("SIGTERM");
        finish(new Error("docker_command_output_too_large"));
        return;
      }
      chunks.push(Buffer.from(chunk));
    });
    child.stderr?.on("data", (chunk: Buffer) => {
      receivedErrorBytes += chunk.byteLength;
      if (receivedErrorBytes <= MAX_DOCKER_ERROR_OUTPUT_BYTES) {
        errorChunks.push(Buffer.from(chunk));
      }
    });
    child.once("error", () => finish(new Error("docker_runtime_unavailable")));
    child.once("close", (code) => {
      if (code !== 0 && !allowNonZeroExit) {
        const errorOutput = Buffer.concat(errorChunks).toString("utf8").trim();
        if (acceptNonZeroStderr?.test(errorOutput)) {
          finish(undefined, Buffer.concat(chunks).toString("utf8"));
          return;
        }
        finish(new Error(classifyDockerCommandFailure(errorOutput)));
        return;
      }
      finish(undefined, Buffer.concat(chunks).toString("utf8"));
    });
    signal?.addEventListener("abort", onAbort, { once: true });
    if (signal?.aborted) {
      onAbort();
      return;
    }
    child.stdin?.end(input);
  });
}

function classifyDockerCommandFailure(output: string): RuntimeDiagnosticCode {
  const normalized = output.toLowerCase();
  if (/permission denied|operation not permitted/u.test(normalized)) {
    return "docker_permission_denied";
  }
  if (/cannot connect to the docker daemon|error during connect|is the docker daemon running/u.test(normalized)) {
    return "docker_daemon_unavailable";
  }
  if (/removal is already in progress|being removed/u.test(normalized)) {
    return "docker_removal_in_progress";
  }
  if (/volume(?: .*?)? is in use|resource is in use|device or resource busy/u.test(normalized)) {
    return "docker_resource_in_use";
  }
  return "docker_runtime_command_failed";
}

async function removeContainer(
  dockerBinary: string,
  containerName: string,
  dockerSocketPath: string,
  stage: RuntimeDiagnosticStage,
  diagnostic: RuntimeDiagnosticWriter,
): Promise<boolean> {
  return runDockerCleanup(
    dockerBinary,
    ["rm", "--force", containerName],
    dockerSocketPath,
    /\bno such container:/iu,
    stage,
    diagnostic,
  );
}

async function removeVolume(
  dockerBinary: string,
  volumeName: string,
  dockerSocketPath: string,
  diagnostic: RuntimeDiagnosticWriter,
): Promise<boolean> {
  return runDockerCleanup(
    dockerBinary,
    ["volume", "rm", volumeName],
    dockerSocketPath,
    /\bno such volume\b/iu,
    "volume_cleanup",
    diagnostic,
  );
}

async function runDockerCleanup(
  dockerBinary: string,
  args: string[],
  dockerSocketPath: string,
  absentResourcePattern: RegExp,
  stage: RuntimeDiagnosticStage,
  diagnostic: RuntimeDiagnosticWriter,
): Promise<boolean> {
  let lastCauseCode: RuntimeDiagnosticCode;
  for (let attempt = 0; attempt < DOCKER_CLEANUP_ATTEMPTS; attempt += 1) {
    try {
      await runDocker(
        dockerBinary,
        args,
        undefined,
        undefined,
        undefined,
        false,
        DOCKER_CLEANUP_COMMAND_TIMEOUT_MS,
        dockerSocketPath,
        absentResourcePattern,
      );
      return true;
    } catch (error) {
      lastCauseCode = getRuntimeDiagnosticCode(error);
      if (attempt + 1 === DOCKER_CLEANUP_ATTEMPTS) {
        diagnostic({
          type: "runtime_diagnostic",
          stage,
          code: "runtime_cleanup_failed",
          attempt: attempt + 1,
          causeCode: lastCauseCode,
        });
        return false;
      }
      diagnostic({
        type: "runtime_diagnostic",
        stage,
        code: "runtime_cleanup_retry",
        attempt: attempt + 1,
        causeCode: lastCauseCode,
      });
      await new Promise((resolve) => setTimeout(resolve, DOCKER_CLEANUP_RETRY_DELAY_MS));
    }
  }
  return false;
}

function getStartupDiagnosticStage(startupFailureCode: string): RuntimeDiagnosticStage {
  if (startupFailureCode === "runtime_volume_create_failed") return "volume_create";
  if (startupFailureCode === "runtime_volume_prepare_failed") return "volume_prepare";
  if (startupFailureCode === "runtime_broker_start_failed") return "broker_start";
  return "broker_ready";
}

function getRuntimeDiagnosticCode(error: unknown): RuntimeDiagnosticCode {
  const message = error instanceof Error ? error.message : "";
  if (RUNTIME_DIAGNOSTIC_CODES.includes(message as RuntimeDiagnosticCode)) {
    return message as RuntimeDiagnosticCode;
  }
  return "docker_runtime_command_failed";
}

function dockerCommandArguments(dockerSocketPath: string, args: string[]): string[] {
  return ["--host", `unix://${dockerSocketPath}`, ...args];
}

function waitForChildClose(
  child: ChildProcessWithoutNullStreams,
  timeoutMs: number,
): Promise<boolean> {
  if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve(true);
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      resolve(false);
    }, timeoutMs);
    child.once("close", () => {
      clearTimeout(timer);
      resolve(true);
    });
  });
}
