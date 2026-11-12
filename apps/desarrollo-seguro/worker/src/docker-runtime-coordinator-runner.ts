import { randomUUID } from "node:crypto";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { isAbsolute } from "node:path";
import type { ScanRunInput } from "@desarrolloseguro/persistence";
import {
  SCAN_FAILURE_CODES,
  type ScanFailureCode,
} from "@desarrolloseguro/persistence";
import {
  MAX_EXECUTOR_RESPONSE_BYTES,
  parseTransportV1ExecutorResponse,
  type TransportV1ExecutorRequest,
} from "./transport-v1-executor-protocol.js";
import type { RuntimeCoordinatorRunner } from "./runtime-coordinator-server.js";

const DEFAULT_BROKER_STARTUP_TIMEOUT_MS = 20_000;
const DOCKER_COMMAND_TIMEOUT_MS = 10_000;
const EXECUTOR_COMMAND_TIMEOUT_MS = 38_000;
const BROKER_STOP_TIMEOUT_MS = 3_000;
const MAX_DOCKER_COMMAND_OUTPUT_BYTES = 256 * 1024;
const MAX_BROKER_STARTUP_OUTPUT_BYTES = 4 * 1024;
const EGRESS_SOCKET_DIRECTORY = "/run/development-security-egress";
const VOLUME_PREFIX = "development-security-job-";
const BROKER_CONTAINER_PREFIX = "development-security-broker-";
const EXECUTOR_CONTAINER_PREFIX = "development-security-executor-";
const SAFE_BROKER_STARTUP_FAILURES = new Set([
  "egress_broker_startup_invalid",
  "egress_broker_startup_failed",
  "egress_broker_socket_invalid",
  "egress_broker_socket_directory_invalid",
  "egress_broker_socket_setup_failed",
  "egress_broker_socket_listen_failed",
  "runtime_broker_process_error",
  "runtime_broker_process_exited",
  "runtime_broker_ready_timeout",
]);
const IMAGE_REFERENCE = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$/u;
const NETWORK_REFERENCE = /^(?:none|[A-Za-z0-9][A-Za-z0-9_.-]{0,127})$/u;
const BROKER_INITIALIZER =
  `chown 1000:1000 ${EGRESS_SOCKET_DIRECTORY} && chmod 0700 ${EGRESS_SOCKET_DIRECTORY}`;

export type DockerRuntimeCoordinatorRunnerOptions = {
  executorImage: string;
  brokerImage: string;
  dockerBinary?: string;
  dockerSocketPath?: string;
  brokerNetwork?: string;
  brokerStartupTimeoutMs?: number;
};

export type DockerRuntimeSession = {
  execute(
    request: TransportV1ExecutorRequest,
    signal: AbortSignal,
  ): Promise<unknown>;
  close(): Promise<void>;
};

export type DockerRuntimeSessionFactory = {
  create(
    request: TransportV1ExecutorRequest,
    signal: AbortSignal,
  ): Promise<DockerRuntimeSession>;
};

/** Runs one executor/broker pair, validates its response, and always tears it down. */
export function createDockerRuntimeCoordinatorRunner(
  factory: DockerRuntimeSessionFactory,
): RuntimeCoordinatorRunner {
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
          throw new Error(
            response.errorCode === "request_invalid"
              ? "transport_failed"
              : response.errorCode,
          );
        }
        result = response.result;
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
        throw new Error(getRuntimeFailureCode(executionError), { cause: executionError });
      }
      if (!session || !result) throw new Error("executor_failed");
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
  if (
    !IMAGE_REFERENCE.test(options.executorImage) ||
    !IMAGE_REFERENCE.test(options.brokerImage) ||
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
    async create(request, signal): Promise<DockerRuntimeSession> {
      if (signal.aborted) throw new Error("request_aborted");
      const runtimeId = randomUUID();
      const volumeName = `${VOLUME_PREFIX}${runtimeId}`;
      const brokerName = `${BROKER_CONTAINER_PREFIX}${runtimeId}`;
      const executorName = `${EXECUTOR_CONTAINER_PREFIX}${runtimeId}`;
      let volumeMayExist = false;
      let brokerProcess: ChildProcessWithoutNullStreams | undefined;
      let executorMayExist = false;
      let closed = false;

      const close = async () => {
        if (closed) return;
        closed = true;
        let cleanupFailed = false;
        if (executorMayExist) {
          const removed = await removeContainer(dockerBinary, executorName, dockerSocketPath);
          if (!removed) cleanupFailed = true;
          executorMayExist = false;
        }
        if (brokerProcess) {
          const removed = await removeContainer(dockerBinary, brokerName, dockerSocketPath);
          const processClosed = await waitForChildClose(brokerProcess, BROKER_STOP_TIMEOUT_MS);
          if (!removed && !processClosed) cleanupFailed = true;
          if (!processClosed) brokerProcess.kill("SIGKILL");
          brokerProcess = undefined;
        }
        if (volumeMayExist) {
          const removed = await removeVolume(dockerBinary, volumeName, dockerSocketPath);
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
          await removeVolume(dockerBinary, volumeName, dockerSocketPath);
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
          const output = await runDocker(
            dockerBinary,
            executorArguments(options.executorImage, volumeName, executorName),
            `${JSON.stringify(executorRequest)}\n`,
            executorSignal,
            MAX_EXECUTOR_RESPONSE_BYTES,
            true,
            EXECUTOR_COMMAND_TIMEOUT_MS,
            dockerSocketPath,
          );
          try {
            return JSON.parse(output.trim()) as unknown;
          } catch (error) {
            throw new Error("executor_response_invalid", { cause: error });
          }
        },
        close,
      };
    },
  };
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

function waitForBrokerReady(
  child: ChildProcessWithoutNullStreams,
  signal: AbortSignal,
  timeoutMs: number,
): Promise<void> {
  return new Promise((resolve, reject) => {
    let receivedBytes = 0;
    let buffer = "";
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
      const code = chunk.toString("utf8").trim();
      if (SAFE_BROKER_STARTUP_FAILURES.has(code)) startupFailureCode = code;
    };
    const onError = () => finish(new Error(startupFailureCode ?? "runtime_broker_process_error"));
    const onClose = () => finish(new Error(startupFailureCode ?? "runtime_broker_process_exited"));
    child.stdout.on("data", onData);
    child.stderr.on("data", onStderr);
    child.once("error", onError);
    child.once("close", onClose);
    signal.addEventListener("abort", onAbort, { once: true });
    if (signal.aborted) onAbort();
  });
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
): Promise<string> {
  if (signal?.aborted) throw new Error("request_aborted");
  return new Promise((resolve, reject) => {
    const child = spawn(dockerBinary, dockerCommandArguments(dockerSocketPath, args), {
      stdio: ["pipe", "pipe", "ignore"],
    });
    const chunks: Buffer[] = [];
    let receivedBytes = 0;
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
    child.stdout.on("data", (chunk: Buffer) => {
      receivedBytes += chunk.byteLength;
      if (receivedBytes > maxOutputBytes) {
        child.kill("SIGTERM");
        finish(new Error("docker_command_output_too_large"));
        return;
      }
      chunks.push(Buffer.from(chunk));
    });
    child.once("error", () => finish(new Error("docker_runtime_unavailable")));
    child.once("close", (code) => {
      if (code !== 0 && !allowNonZeroExit) {
        finish(new Error("docker_runtime_command_failed"));
        return;
      }
      finish(undefined, Buffer.concat(chunks).toString("utf8"));
    });
    signal?.addEventListener("abort", onAbort, { once: true });
    if (signal?.aborted) {
      onAbort();
      return;
    }
    child.stdin.end(input);
  });
}

async function removeContainer(
  dockerBinary: string,
  containerName: string,
  dockerSocketPath: string,
): Promise<boolean> {
  try {
    await runDocker(
      dockerBinary,
      ["rm", "--force", containerName],
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      dockerSocketPath,
    );
    return true;
  } catch {
    return false;
  }
}

async function removeVolume(
  dockerBinary: string,
  volumeName: string,
  dockerSocketPath: string,
): Promise<boolean> {
  try {
    await runDocker(
      dockerBinary,
      ["volume", "rm", volumeName],
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      dockerSocketPath,
    );
    return true;
  } catch {
    return false;
  }
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
