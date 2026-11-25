import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ScanRunInput } from "@desarrolloseguro/persistence";
import {
  classifyBrokerStartupStderr,
  createDockerRuntimeCoordinatorRunner,
  createDockerRuntimeSessionFactory,
  runRuntimePhase,
  type DockerRuntimeSessionFactory,
} from "./docker-runtime-coordinator-runner.js";
import type { RuntimeDiagnosticEvent } from "./runtime-diagnostics.js";
import { readScanFailureDiagnostic } from "./runtime-diagnostics.js";
import type { TransportV1ExecutorRequest } from "./transport-v1-executor-protocol.js";
import type { PrivacyBrowserFlowObservation, PrivacyBrowserObservation } from "./privacy-browser-observer.js";

const { spawnMock } = vi.hoisted(() => ({ spawnMock: vi.fn() }));
vi.mock("node:child_process", () => ({ spawn: spawnMock }));

const dockerCalls: string[][] = [];
const dockerHostArguments: string[][] = [];
const dockerBehavior = {
  failVolumeCreate: false,
  failBrokerInitialization: false,
  failExecutorRemoval: false,
  failVolumeRemoval: false,
  executorContainerAlreadyAbsent: false,
  executorRemovalTransientFailures: 0,
  brokerExitsBeforeReady: false,
  executorOutput: undefined as string | undefined,
  executorExitCode: 0,
  hangExecutor: false,
  spawnErrorOnVolumeCreate: false,
  privacyProxyStopped: false,
};

beforeEach(() => {
  dockerCalls.length = 0;
  dockerHostArguments.length = 0;
  activeBroker = undefined;
  Object.assign(dockerBehavior, {
    failVolumeCreate: false,
    failBrokerInitialization: false,
    failExecutorRemoval: false,
    failVolumeRemoval: false,
    executorContainerAlreadyAbsent: false,
    executorRemovalTransientFailures: 0,
    brokerExitsBeforeReady: false,
    executorOutput: undefined,
    executorExitCode: 0,
    hangExecutor: false,
    spawnErrorOnVolumeCreate: false,
    privacyProxyStopped: false,
  });
  spawnMock.mockReset();
  spawnMock.mockImplementation((_binary: string, args: string[]) => {
    if (args[0] === "--host") {
      dockerHostArguments.push(args.slice(0, 2));
      args = args.slice(2);
    }
    dockerCalls.push([...args]);
    const nameIndex = args.indexOf("--name");
    const containerName = nameIndex >= 0 ? args[nameIndex + 1] : undefined;
    const isBroker = containerName?.startsWith("development-security-broker-") === true;
    const isExecutor = containerName?.startsWith("development-security-executor-") === true;
    const isPrivacyBrowser = containerName?.startsWith("development-security-privacy-browser-") === true;
    let requestText = "";
    const child = new FakeDockerChild(() => {
      if (isBroker) {
        queueMicrotask(() => child.stdout.write('{"protocolVersion":1,"state":"ready"}\n'));
      }
      if (isExecutor && !dockerBehavior.hangExecutor) {
        const request = JSON.parse(requestText) as { requestId: string };
        const output = dockerBehavior.executorOutput ?? `${JSON.stringify({
          protocolVersion: 1,
          requestId: request.requestId,
          result: JSON.parse(JSON.stringify(makeResult())) as unknown,
        })}\n`;
        queueMicrotask(() => child.finish(dockerBehavior.executorExitCode, output));
      }
      if (isPrivacyBrowser) queueMicrotask(() => child.finish(0, `${JSON.stringify(makePrivacyObservation())}\n`));
    });
    child.stdin.on("data", (chunk) => {
      requestText += chunk.toString("utf8");
    });
    if (args[0] === "volume" && args[1] === "create") {
      if (dockerBehavior.spawnErrorOnVolumeCreate) {
        queueMicrotask(() => child.emit("error", new Error("private spawn detail")));
      } else {
        queueMicrotask(() => child.finish(dockerBehavior.failVolumeCreate ? 1 : 0, "volume-created\n"));
      }
    } else if (args[0] === "run" && args.includes("/bin/sh")) {
      queueMicrotask(() => child.finish(dockerBehavior.failBrokerInitialization ? 1 : 0));
    } else if (args[0] === "run" && isBroker) {
      activeBroker = child;
      if (dockerBehavior.brokerExitsBeforeReady) {
        queueMicrotask(() => child.finish(1));
      }
    } else if (args[0] === "run" && isExecutor) {
      // The executor response is scheduled when the command's stdin closes.
    } else if (args[0] === "run" && isPrivacyBrowser) {
      // The bounded browser observation is emitted at process completion.
    } else if (args[0] === "logs") {
      const output = dockerBehavior.privacyProxyStopped
        ? '{"event":"privacy_proxy_stats","receivedBytes":321,"budgetExceeded":false}\n'
        : '{"event":"privacy_proxy_ready","port":3128}\n';
      queueMicrotask(() => child.finish(0, output));
    } else if (args[0] === "stop") {
      dockerBehavior.privacyProxyStopped = true;
      queueMicrotask(() => child.finish(0, "proxy\n"));
    } else if (
      args[0] === "rm" &&
      args[2]?.startsWith("development-security-broker-") === true
    ) {
      activeBroker?.finish(null, "", "SIGTERM");
      queueMicrotask(() => child.finish(0));
    } else if (args[0] === "rm" && args[2]?.startsWith("development-security-executor-") === true) {
      if (dockerBehavior.executorContainerAlreadyAbsent) {
        queueMicrotask(() => child.finish(1, "", null, "Error response from daemon: No such container: ephemeral\n"));
      } else if (dockerBehavior.executorRemovalTransientFailures > 0) {
        dockerBehavior.executorRemovalTransientFailures -= 1;
        queueMicrotask(() => child.finish(1, "", null, "Error response from daemon: removal is already in progress\n"));
      } else {
        queueMicrotask(() => child.finish(dockerBehavior.failExecutorRemoval ? 1 : 0));
      }
    } else if (args[0] === "volume" && args[1] === "rm") {
      queueMicrotask(() => child.finish(
        dockerBehavior.failVolumeRemoval ? 1 : 0,
        "",
        null,
        dockerBehavior.failVolumeRemoval ? "Error response from daemon: volume is in use\n" : "",
      ));
    } else {
      queueMicrotask(() => child.finish(0));
    }
    return child;
  });
});

let activeBroker: FakeDockerChild | undefined;

describe("createDockerRuntimeCoordinatorRunner", () => {
  it.each(["service_comparison", "first_entry_policy_access"] as const)(
    "retains the bounded failing phase for %s",
    (stage) => {
      let thrown: unknown;
      try {
        runRuntimePhase(stage, () => { throw new Error("private runtime detail"); });
      } catch (error) { thrown = error; }
      const error = thrown as Error & {
        scanFailureDiagnostic?: unknown;
      };

      expect(error.message).toBe("executor_failed");
      expect(error.scanFailureDiagnostic).toEqual({
        stage,
        code: "executor_application_failed",
      });
      expect(JSON.stringify(error)).not.toContain("private runtime detail");
    },
  );

  it("runs the browser only on its internal network behind the bounded egress proxy", async () => {
    const factory = createDockerRuntimeSessionFactory({
      executorImage: "executor:local", brokerImage: "broker:local",
      privacyBrowserImage: "privacy-browser:local", privacyEgressImage: "privacy-egress:local",
      brokerNetwork: "development-security-egress",
    });
    const session = await factory.create(REQUEST, new AbortController().signal);
    const observation = await session.observePrivacy!(REQUEST, new AbortController().signal);
    await session.close();

    expect(observation.receivedBytes).toBe(321);
    expect(dockerCalls.some((args) => args[0] === "network" && args[1] === "create" && args.includes("--internal"))).toBe(true);
    const browserRun = dockerCalls.find((args) => args[0] === "run" && args.includes("privacy-browser:local"));
    expect(browserRun?.[browserRun.indexOf("--network") + 1]).toMatch(/^development-security-privacy-/u);
    expect(browserRun).not.toContain("development-security-egress");
    expect(browserRun).toContain("--cap-drop");
    expect(browserRun).toContain("ALL");
    expect(dockerCalls.some((args) => args[0] === "network" && args[1] === "connect" && args.includes("--alias"))).toBe(true);
  });

  it("reduces broker startup stderr to a safe failure category", () => {
    expect(classifyBrokerStartupStderr("Cannot find module '/private/runtime.js'"))
      .toBe("runtime_broker_module_load_failed");
    expect(classifyBrokerStartupStderr("permission denied: /run/private/socket"))
      .toBe("runtime_broker_permission_denied");
    expect(classifyBrokerStartupStderr("Cannot find package parse5 imported from /private/path"))
      .toBe("runtime_broker_html_parser_missing");
    expect(classifyBrokerStartupStderr("secret host path and token")).toBeUndefined();
  });

  it("validates the executor response and closes the per-job runtime", async () => {
    const result = makeResult();
    const close = vi.fn().mockResolvedValue(undefined);
    const execute = vi.fn().mockResolvedValue({
      protocolVersion: 1,
      requestId: REQUEST.requestId,
      result: JSON.parse(JSON.stringify(result)) as unknown,
    });
    const factory: DockerRuntimeSessionFactory = {
      create: vi.fn().mockResolvedValue({ execute, close }),
    };
    const runner = createDockerRuntimeCoordinatorRunner(factory);
    const signal = new AbortController().signal;

    await expect(runner.execute(REQUEST, signal)).resolves.toMatchObject(result);

    expect(factory.create).toHaveBeenCalledExactlyOnceWith(REQUEST, signal);
    expect(execute).toHaveBeenCalledExactlyOnceWith(REQUEST, signal);
    expect(close).toHaveBeenCalledOnce();
  });

  it("logs a privacy-assessment phase error and preserves the base scan", async () => {
    const diagnostics: RuntimeDiagnosticEvent[] = [];
    const factory: DockerRuntimeSessionFactory = {
      diagnostic: (event) => diagnostics.push(event),
      create: vi.fn().mockResolvedValue({
        execute: vi.fn().mockResolvedValue({
          protocolVersion: 1,
          requestId: REQUEST.requestId,
          result: JSON.parse(JSON.stringify(makeResult())) as unknown,
        }),
        observePrivacy: vi.fn().mockResolvedValue({}),
        close: vi.fn().mockResolvedValue(undefined),
      }),
    };

    const result = await createDockerRuntimeCoordinatorRunner(factory).execute(
      REQUEST,
      new AbortController().signal,
    );

    expect(result.scannerVersion).toBe("transport-v1-network-adapter-1");
    expect(result.privacyAssessment).toBeDefined();
    expect(diagnostics).toContainEqual({
      type: "runtime_diagnostic",
      stage: "privacy_assessment",
      code: "executor_application_failed",
    });
  });

  it("logs a cookie-finding phase error without discarding the base scan", async () => {
    const observation = makePrivacyObservation();
    observation.initial.phaseEvidence.networkRequests = [null] as unknown as typeof observation.initial.phaseEvidence.networkRequests;
    const diagnostics: RuntimeDiagnosticEvent[] = [];
    const factory: DockerRuntimeSessionFactory = {
      diagnostic: (event) => diagnostics.push(event),
      create: vi.fn().mockResolvedValue({
        execute: vi.fn().mockResolvedValue({
          protocolVersion: 1,
          requestId: REQUEST.requestId,
          result: JSON.parse(JSON.stringify(makeResult())) as unknown,
        }),
        observePrivacy: vi.fn().mockResolvedValue(observation),
        close: vi.fn().mockResolvedValue(undefined),
      }),
    };

    const result = await createDockerRuntimeCoordinatorRunner(factory).execute(
      REQUEST,
      new AbortController().signal,
    );

    expect(result.scannerVersion).toBe("transport-v1-network-adapter-1");
    expect(diagnostics).toContainEqual({
      type: "runtime_diagnostic",
      stage: "cookie_legal_findings",
      code: "executor_application_failed",
    });
  });

  it("builds the public service comparison from provider declarations", async () => {
    const base = makeResult();
    const request = { ...REQUEST, profileVersion: "domain-v4" as const };
    const executorResult = {
      ...base,
      scannerVersion: "domain-v4-network-adapter-3",
      checks: [...base.checks, ...base.checks],
      publicPolicyTransparencyAssessment: {
        policyVersion: "public-policy-v1",
        status: "pass",
        reasonCode: "disclosure_found",
        evidence: {
          linksFound: 1,
          pagesInspected: 1,
          unavailablePages: 0,
          accessDeniedPages: 0,
          providerMentions: 2,
          providersMissingPurpose: 0,
          categories: ["other"],
        },
      },
      publicServiceDeclarations: [
        { providerId: "openai-api", purposes: ["ai_processing"] },
        { providerId: "ionos", purposes: ["infrastructure", "email_delivery"] },
      ],
    };
    const close = vi.fn().mockResolvedValue(undefined);
    const factory: DockerRuntimeSessionFactory = {
      create: vi.fn().mockResolvedValue({
        execute: vi.fn().mockResolvedValue({
          protocolVersion: 1,
          requestId: request.requestId,
          result: JSON.parse(JSON.stringify(executorResult)) as unknown,
        }),
        observePrivacy: vi.fn().mockResolvedValue(makePrivacyObservation()),
        close,
      }),
    };

    const result = await createDockerRuntimeCoordinatorRunner(factory).execute(request, new AbortController().signal);

    expect(result.publicServiceComparison).toMatchObject({
      status: "pass",
      items: [
        { providerId: "ionos", observation: "declared" },
        { providerId: "openai-api", observation: "declared" },
      ],
    });
    expect(close).toHaveBeenCalledOnce();
  });

  it.each(["service_comparison", "first_entry_policy_access"] as const)(
    "preserves the %s diagnostic through the runtime boundary",
    async (stage) => {
      const request = { ...REQUEST, profileVersion: "domain-v4" as const };
      const observation = makePrivacyObservation();
      if (stage === "service_comparison") {
        let reads = 0;
        Object.defineProperty(observation.initial, "completedHostsAfterChoice", {
          get: () => {
            reads += 1;
            if (reads >= 4) throw new Error("private observed-service detail");
            return [];
          },
        });
      } else {
        Object.defineProperty(observation.initial, "firstEntryPolicyLinks", {
          get: () => { throw new Error("private policy-link detail"); },
        });
      }
      const factory: DockerRuntimeSessionFactory = {
        create: vi.fn().mockResolvedValue({
          execute: vi.fn().mockResolvedValue({
            protocolVersion: 1,
            requestId: request.requestId,
            result: JSON.parse(JSON.stringify(makeDomainV4Result())) as unknown,
          }),
          observePrivacy: vi.fn().mockResolvedValue(observation),
          close: vi.fn().mockResolvedValue(undefined),
        }),
      };

      const failure = await createDockerRuntimeCoordinatorRunner(factory).execute(
        request,
        new AbortController().signal,
      ).then(() => null, (error: unknown) => error);
      expect(failure).toMatchObject({
        message: "executor_failed",
        scanFailureDiagnostic: { stage, code: "executor_application_failed" },
      });
    },
  );

  it("persists an explicit first-entry failure when consent has only a footer link", async () => {
    const request = REQUEST;
    const observation = makePrivacyObservation();
    observation.initial = {
      ...observation.initial,
      consentPromptDetected: true,
      firstEntryPolicyLinks: {
        status: "evaluated",
        consentComponentDetected: true,
        consentComponentLink: null,
        consentComponentDocumentAccess: "not_checked",
        footerLink: { hostname: "example.org", path: "/privacy", kind: "privacy" },
        footerLinkDocumentAccess: "accessible",
      },
      phaseEvidence: {
        ...observation.initial.phaseEvidence,
        beforeChoice: { capturedAtMs: 1, cookies: [], storageKeys: [], cookieReadComplete: true, storageReadComplete: true },
      },
    };
    const factory: DockerRuntimeSessionFactory = {
      create: vi.fn().mockResolvedValue({
        execute: vi.fn().mockResolvedValue({
          protocolVersion: 1, requestId: request.requestId, result: JSON.parse(JSON.stringify(makeResult())) as unknown,
        }),
        observePrivacy: vi.fn().mockResolvedValue(observation),
        close: vi.fn().mockResolvedValue(undefined),
      }),
    };

    const result = await createDockerRuntimeCoordinatorRunner(factory).execute(request, new AbortController().signal);

    expect(result.firstEntryPolicyAccess).toMatchObject({
      status: "fail",
      reasonCode: "consent_link_missing",
      consentPromptDetected: true,
      linkLocation: "none",
      link: null,
    });
  });

  it("rejects a mismatched executor response and still closes the runtime", async () => {
    const close = vi.fn().mockResolvedValue(undefined);
    const factory: DockerRuntimeSessionFactory = {
      create: vi.fn().mockResolvedValue({
        execute: vi.fn().mockResolvedValue({
          protocolVersion: 1,
          requestId: "22222222-2222-4222-8222-222222222222",
          result: makeResult(),
        }),
        close,
      }),
    };
    const runner = createDockerRuntimeCoordinatorRunner(factory);

    const error = await runner.execute(REQUEST, new AbortController().signal).catch((failure: unknown) => failure);
    expect(error).toMatchObject({ message: "transport_failed" });
    expect(readScanFailureDiagnostic(error)).toEqual({ stage: "response_validation", code: "executor_response_invalid" });
    expect(close).toHaveBeenCalledOnce();
  });

  it("closes the runtime after executor failure and does not expose its error", async () => {
    const close = vi.fn().mockResolvedValue(undefined);
    const factory: DockerRuntimeSessionFactory = {
      create: vi.fn().mockResolvedValue({
        execute: vi.fn().mockRejectedValue(new Error("private docker detail")),
        close,
      }),
    };
    const runner = createDockerRuntimeCoordinatorRunner(factory);

    const error = await runner.execute(REQUEST, new AbortController().signal).catch((failure: unknown) => failure);
    expect(error).toMatchObject({ message: "executor_failed" });
    expect(readScanFailureDiagnostic(error)).toEqual({ stage: "executor_execution", code: "executor_application_failed" });
    expect(close).toHaveBeenCalledOnce();
  });

  it("labels an unclassified runtime creation failure at its boundary", async () => {
    const runner = createDockerRuntimeCoordinatorRunner({
      create: vi.fn().mockRejectedValue(new Error("private docker detail")),
    });

    const error = await runner.execute(REQUEST, new AbortController().signal).catch((failure: unknown) => failure);
    expect(error).toMatchObject({ message: "executor_failed" });
    expect(readScanFailureDiagnostic(error)).toEqual({ stage: "runtime_session_create", code: "executor_application_failed" });
  });

  it("reports a safe cleanup category when closing the runtime fails", async () => {
    const factory: DockerRuntimeSessionFactory = {
      create: vi.fn().mockResolvedValue({
        execute: vi.fn().mockResolvedValue({
          protocolVersion: 1,
          requestId: REQUEST.requestId,
          result: JSON.parse(JSON.stringify(makeResult())) as unknown,
        }),
        close: vi.fn().mockRejectedValue(new Error("private volume path")),
      }),
    };
    const runner = createDockerRuntimeCoordinatorRunner(factory);

    await expect(runner.execute(REQUEST, new AbortController().signal)).rejects.toThrow(
      "runtime_volume_failed",
    );
  });

  it("preserves the execution failure when cleanup also fails", async () => {
    const factory: DockerRuntimeSessionFactory = {
      create: vi.fn().mockResolvedValue({
        execute: vi.fn().mockRejectedValue(new Error("broker_failed")),
        close: vi.fn().mockRejectedValue(new Error("private volume path")),
      }),
    };
    const runner = createDockerRuntimeCoordinatorRunner(factory);

    await expect(runner.execute(REQUEST, new AbortController().signal)).rejects.toThrow(
      "broker_failed",
    );
  });

  it("closes the runtime when execution is cancelled", async () => {
    const close = vi.fn().mockResolvedValue(undefined);
    const factory: DockerRuntimeSessionFactory = {
      create: vi.fn().mockResolvedValue({
        execute: vi.fn().mockRejectedValue(new Error("request_aborted")),
        close,
      }),
    };
    const runner = createDockerRuntimeCoordinatorRunner(factory);

    await expect(runner.execute(REQUEST, new AbortController().signal)).rejects.toThrow(
      "request_aborted",
    );
    expect(close).toHaveBeenCalledOnce();
  });

  it("does not create a container when the job is already aborted", async () => {
    const factory: DockerRuntimeSessionFactory = {
      create: vi.fn(),
    };
    const runner = createDockerRuntimeCoordinatorRunner(factory);
    const controller = new AbortController();
    controller.abort();

    await expect(runner.execute(REQUEST, controller.signal)).rejects.toThrow(
      "request_aborted",
    );
    expect(factory.create).not.toHaveBeenCalled();
  });

  it("preserves a categorized runtime startup failure", async () => {
    const factory: DockerRuntimeSessionFactory = {
      create: vi.fn().mockRejectedValue(new Error("runtime_coordinator_unavailable")),
    };
    const runner = createDockerRuntimeCoordinatorRunner(factory);

    await expect(runner.execute(REQUEST, new AbortController().signal)).rejects.toThrow(
      "coordinator_unavailable",
    );
  });
});

describe("createDockerRuntimeSessionFactory", () => {
  it("starts isolated broker and executor containers and removes their volume", async () => {
    activeBroker = undefined;
    const factory = createDockerRuntimeSessionFactory({
      executorImage: "development-security-executor:test",
      brokerImage: "development-security-egress-broker:test",
      dockerBinary: "/usr/bin/docker",
    });
    const runner = createDockerRuntimeCoordinatorRunner(factory);

    await expect(runner.execute(REQUEST, new AbortController().signal)).resolves.toMatchObject({
      scannerVersion: "transport-v1-network-adapter-1",
      verdict: "inconclusive",
    });

    const brokerRun = dockerCalls.find((args) => args[0] === "run" && args.includes("--name") &&
      args[args.indexOf("--name") + 1]?.startsWith("development-security-broker-"));
    const executorRun = dockerCalls.find((args) => args[0] === "run" && args.includes("--name") &&
      args[args.indexOf("--name") + 1]?.startsWith("development-security-executor-"));
    expect(dockerHostArguments.length).toBeGreaterThan(0);
    expect(dockerHostArguments.every(([flag, socket]) =>
      flag === "--host" && socket === "unix:///var/run/docker.sock",
    )).toBe(true);
    expect(brokerRun).toContain("none");
    expect(executorRun).toContain("none");
    expect(executorRun?.find((argument) => argument.includes("target=/run/development-security-egress")))
      .toContain("readonly");
    expect(dockerCalls.some((args) => args[0] === "rm" && args.includes("--force"))).toBe(true);
    expect(dockerCalls.some((args) => args[0] === "volume" && args[1] === "rm")).toBe(true);
  });

  it("connects only the broker to the configured dedicated egress network", async () => {
    const runner = createDockerRuntimeCoordinatorRunner(createDockerRuntimeSessionFactory({
      executorImage: "development-security-executor:test",
      brokerImage: "development-security-egress-broker:test",
      brokerNetwork: "development-security-egress",
    }));

    await expect(runner.execute(REQUEST, new AbortController().signal)).resolves.toMatchObject({
      verdict: "inconclusive",
    });

    const brokerRun = dockerCalls.find((args) => args[0] === "run" && args.includes("--name") &&
      args[args.indexOf("--name") + 1]?.startsWith("development-security-broker-"));
    const executorRun = dockerCalls.find((args) => args[0] === "run" && args.includes("--name") &&
      args[args.indexOf("--name") + 1]?.startsWith("development-security-executor-"));
    expect(brokerRun?.[brokerRun.indexOf("--network") + 1]).toBe("development-security-egress");
    expect(executorRun?.[executorRun.indexOf("--network") + 1]).toBe("none");
  });

  it.each([
    ["executor image", { executorImage: "--privileged", brokerImage: "broker:test" }],
    ["broker image", { executorImage: "executor:test", brokerImage: "bad image" }],
    ["startup timeout", { executorImage: "executor:test", brokerImage: "broker:test", brokerStartupTimeoutMs: 30_001 }],
    ["relative Docker socket", { executorImage: "executor:test", brokerImage: "broker:test", dockerSocketPath: "docker.sock" }],
    ["invalid broker network", { executorImage: "executor:test", brokerImage: "broker:test", brokerNetwork: "bad network" }],
  ])("rejects invalid %s configuration before invoking Docker", (_label, options) => {
    expect(() => createDockerRuntimeSessionFactory(options)).toThrow("docker_runtime_config_invalid");
    expect(spawnMock).not.toHaveBeenCalled();
  });

  it("reports a volume creation failure and hides Docker output", async () => {
    dockerBehavior.failVolumeCreate = true;
    const diagnostic = vi.fn();
    const runner = createDockerRuntimeCoordinatorRunner(createDockerRuntimeSessionFactory({
      executorImage: "executor:test",
      brokerImage: "broker:test",
      diagnostic,
    }));

    await expect(runner.execute(REQUEST, new AbortController().signal)).rejects.toThrow(
      "runtime_volume_failed",
    );
    expect(diagnostic).toHaveBeenCalledWith({
      type: "runtime_diagnostic",
      stage: "volume_create",
      code: "docker_runtime_command_failed",
    });
  });

  it("logs safe probe failure categories returned by the isolated executor", async () => {
    dockerBehavior.executorOutput = `${JSON.stringify({
      protocolVersion: 1,
      requestId: REQUEST.requestId,
      errorCode: "executor_failed",
      diagnostic: {
        category: "network_observation_unavailable",
        probeFailures: [
          { operation: "dns", code: "dns_resolution_failed" },
          { operation: "http-get", code: "connection_failed" },
        ],
      },
    })}\n`;
    const diagnostic = vi.fn();
    const runner = createDockerRuntimeCoordinatorRunner(createDockerRuntimeSessionFactory({
      executorImage: "executor:test",
      brokerImage: "broker:test",
      diagnostic,
    }));

    await expect(runner.execute(REQUEST, new AbortController().signal)).rejects.toMatchObject({
      message: "executor_failed",
      scanFailureDiagnostic: {
        stage: "executor",
        code: "executor_application_failed",
        probeFailures: [
          { operation: "dns", code: "dns_resolution_failed" },
          { operation: "http-get", code: "connection_failed" },
        ],
      },
    });
    expect(diagnostic).toHaveBeenCalledWith({
      type: "runtime_diagnostic",
      stage: "executor",
      code: "executor_application_failed",
      probeFailures: [
        { operation: "dns", code: "dns_resolution_failed" },
        { operation: "http-get", code: "connection_failed" },
      ],
    });
  });

  it("preserves a failure phase returned by the isolated executor protocol", async () => {
    dockerBehavior.executorOutput = `${JSON.stringify({
      protocolVersion: 1,
      requestId: REQUEST.requestId,
      errorCode: "executor_failed",
      failureDiagnostic: { stage: "public_policy_assessment", code: "executor_application_failed" },
    })}\n`;
    const diagnostic = vi.fn();
    const runner = createDockerRuntimeCoordinatorRunner(createDockerRuntimeSessionFactory({
      executorImage: "executor:test",
      brokerImage: "broker:test",
      diagnostic,
    }));

    await expect(runner.execute(REQUEST, new AbortController().signal)).rejects.toMatchObject({
      message: "executor_failed",
      scanFailureDiagnostic: { stage: "public_policy_assessment", code: "executor_application_failed" },
    });
    expect(diagnostic).toHaveBeenCalledWith({
      type: "runtime_diagnostic",
      stage: "public_policy_assessment",
      code: "executor_application_failed",
    });
  });

  it("categorizes a Docker process spawn error without exposing its detail", async () => {
    dockerBehavior.spawnErrorOnVolumeCreate = true;
    const runner = createDockerRuntimeCoordinatorRunner(createDockerRuntimeSessionFactory({
      executorImage: "executor:test",
      brokerImage: "broker:test",
    }));

    await expect(runner.execute(REQUEST, new AbortController().signal)).rejects.toThrow(
      "runtime_volume_failed",
    );
  });

  it("cleans the volume and reports broker initialization failures", async () => {
    dockerBehavior.failBrokerInitialization = true;
    const runner = createDockerRuntimeCoordinatorRunner(createDockerRuntimeSessionFactory({
      executorImage: "executor:test",
      brokerImage: "broker:test",
    }));

    await expect(runner.execute(REQUEST, new AbortController().signal)).rejects.toThrow(
      "runtime_volume_failed",
    );
    expect(dockerCalls.some((args) => args[0] === "volume" && args[1] === "rm")).toBe(true);
  });

  it("fails closed when the broker exits before it is ready", async () => {
    dockerBehavior.brokerExitsBeforeReady = true;
    const runner = createDockerRuntimeCoordinatorRunner(createDockerRuntimeSessionFactory({
      executorImage: "executor:test",
      brokerImage: "broker:test",
    }));

    await expect(runner.execute(REQUEST, new AbortController().signal)).rejects.toThrow(
      "broker_failed",
    );
  });

  it("rejects malformed executor output and removes the runtime", async () => {
    dockerBehavior.executorOutput = "not-json";
    const runner = createDockerRuntimeCoordinatorRunner(createDockerRuntimeSessionFactory({
      executorImage: "executor:test",
      brokerImage: "broker:test",
    }));

    await expect(runner.execute(REQUEST, new AbortController().signal)).rejects.toThrow(
      "transport_failed",
    );
    expect(dockerCalls.some((args) => args[0] === "volume" && args[1] === "rm")).toBe(true);
  });

  it("stops oversized executor output and reports a generic failure", async () => {
    dockerBehavior.executorOutput = `${"x".repeat(300_000)}\n`;
    const runner = createDockerRuntimeCoordinatorRunner(createDockerRuntimeSessionFactory({
      executorImage: "executor:test",
      brokerImage: "broker:test",
    }));

    await expect(runner.execute(REQUEST, new AbortController().signal)).rejects.toThrow(
      "executor_failed",
    );
  });

  it("accepts a bounded error response from a nonzero executor exit", async () => {
    dockerBehavior.executorOutput = `${JSON.stringify({
      protocolVersion: 1,
      requestId: REQUEST.requestId,
      errorCode: "executor_failed",
    })}\n`;
    dockerBehavior.executorExitCode = 1;
    const runner = createDockerRuntimeCoordinatorRunner(createDockerRuntimeSessionFactory({
      executorImage: "executor:test",
      brokerImage: "broker:test",
    }));

    await expect(runner.execute(REQUEST, new AbortController().signal)).rejects.toThrow(
      "executor_failed",
    );
  });

  it("removes named containers and the volume if cleanup fails", async () => {
    dockerBehavior.failExecutorRemoval = true;
    const runner = createDockerRuntimeCoordinatorRunner(createDockerRuntimeSessionFactory({
      executorImage: "executor:test",
      brokerImage: "broker:test",
    }));

    await expect(runner.execute(REQUEST, new AbortController().signal)).rejects.toThrow(
      "runtime_volume_failed",
    );
    expect(dockerCalls.some((args) => args[0] === "volume" && args[1] === "rm")).toBe(true);
  });

  it("treats an already absent executor container as successfully cleaned up", async () => {
    dockerBehavior.executorContainerAlreadyAbsent = true;
    const runner = createDockerRuntimeCoordinatorRunner(createDockerRuntimeSessionFactory({
      executorImage: "executor:test",
      brokerImage: "broker:test",
    }));

    await expect(runner.execute(REQUEST, new AbortController().signal)).resolves.toMatchObject({
      verdict: "inconclusive",
    });
    expect(dockerCalls.some((args) => args[0] === "volume" && args[1] === "rm")).toBe(true);
  });

  it("retries transient container cleanup errors before failing the scan", async () => {
    dockerBehavior.executorRemovalTransientFailures = 1;
    const diagnostic = vi.fn();
    const runner = createDockerRuntimeCoordinatorRunner(createDockerRuntimeSessionFactory({
      executorImage: "executor:test",
      brokerImage: "broker:test",
      diagnostic,
    }));

    await expect(runner.execute(REQUEST, new AbortController().signal)).resolves.toMatchObject({
      verdict: "inconclusive",
    });
    expect(dockerCalls.filter((args) => args[0] === "rm" && args[2]?.startsWith("development-security-executor-")).length)
      .toBe(2);
    expect(diagnostic).toHaveBeenCalledWith({
      type: "runtime_diagnostic",
      stage: "executor_container_cleanup",
      code: "runtime_cleanup_retry",
      attempt: 1,
      causeCode: "docker_removal_in_progress",
    });
  });

  it("reports a volume cleanup failure after removing the containers", async () => {
    dockerBehavior.failVolumeRemoval = true;
    const diagnostic = vi.fn();
    const runner = createDockerRuntimeCoordinatorRunner(createDockerRuntimeSessionFactory({
      executorImage: "executor:test",
      brokerImage: "broker:test",
      diagnostic,
    }));

    await expect(runner.execute(REQUEST, new AbortController().signal)).rejects.toThrow(
      "runtime_volume_failed",
    );
    expect(dockerCalls.some((args) => args[0] === "rm" && args.includes("--force"))).toBe(true);
    expect(diagnostic).toHaveBeenCalledWith({
      type: "runtime_diagnostic",
      stage: "volume_cleanup",
      code: "runtime_cleanup_failed",
      attempt: 3,
      causeCode: "docker_resource_in_use",
    });
  });

  it("does not let a failing diagnostic sink interrupt scanning or cleanup", async () => {
    const runner = createDockerRuntimeCoordinatorRunner(createDockerRuntimeSessionFactory({
      executorImage: "executor:test",
      brokerImage: "broker:test",
      diagnostic: () => { throw new Error("private diagnostic sink failure"); },
    }));

    await expect(runner.execute(REQUEST, new AbortController().signal)).resolves.toMatchObject({
      verdict: "inconclusive",
    });
    expect(dockerCalls.some((args) => args[0] === "volume" && args[1] === "rm")).toBe(true);
  });
});

const REQUEST: TransportV1ExecutorRequest = {
  protocolVersion: 1,
  requestId: "11111111-1111-4111-8111-111111111111",
  hostname: "sample.example.net",
  profileVersion: "transport-v1",
};

function makeResult(): Omit<ScanRunInput, "jobId" | "leaseToken" | "hostname" | "profileVersion"> {
  const observedAt = new Date("2026-11-10T12:00:00.000Z");
  const controlIds = ["DS-DNS-01", "DS-TLS-01", "DS-HTTP-01", "DS-HTTP-01", "DS-HDR-01"];
  const methods = ["DNS", "TLS", "HEAD", "GET", "GET"];
  return {
    scannerVersion: "transport-v1-network-adapter-1",
    startedAt: observedAt,
    completedAt: observedAt,
    verdict: "inconclusive",
    scope: ["/"],
    checks: methods.map((method, index) => ({
      controlId: controlIds[index],
      status: "unknown",
      required: true,
      severity: "high",
      observedAt,
      targetPath: "/",
      method,
      summary: "Fixture observation.",
      limitation: "Fixture only.",
      evidence: {},
    })),
    metrics: { requestsCount: 0, bytesCount: 0, durationMs: 0, pagesCount: 0 },
  };
}

function makeDomainV4Result(): ReturnType<typeof makeResult> & Record<string, unknown> {
  const base = makeResult();
  return {
    ...base,
    scannerVersion: "domain-v4-network-adapter-3",
    checks: [...base.checks, ...base.checks],
    publicPolicyTransparencyAssessment: {
      policyVersion: "public-policy-v1",
      status: "pass",
      reasonCode: "disclosure_found",
      evidence: {
        linksFound: 1,
        pagesInspected: 1,
        unavailablePages: 0,
        accessDeniedPages: 0,
        providerMentions: 2,
        providersMissingPurpose: 0,
        categories: ["other"],
      },
    },
    publicServiceDeclarations: [
      { providerId: "openai-api", purposes: ["ai_processing"] },
      { providerId: "ionos", purposes: ["infrastructure", "email_delivery"] },
    ],
  };
}

function makePrivacyObservation(): PrivacyBrowserObservation {
  const flow = (): PrivacyBrowserFlowObservation => ({
    status: "evaluated", pageLoaded: true, consentPromptDetected: false,
    acceptVisibleAtFirstLayer: false, rejectVisibleAtFirstLayer: false,
    actionsToAccept: 0, actionsToReject: 0, preferenceWriteAllowed: false,
    rejectionPersistedAfterReload: null, signalHostsAfterChoice: [], completedHostsAfterChoice: [],
    cookiesAfterChoice: [], storageKeysAfterChoice: [], cookieReadComplete: true, storageReadComplete: true,
    firstEntryPolicyLinks: { status: "unknown", consentComponentDetected: null, consentComponentLink: null, consentComponentDocumentAccess: "unknown", footerLink: null, footerLinkDocumentAccess: "unknown" },
    phaseEvidence: { beforeChoice: null, choiceActionAtMs: null, afterChoice: null, reloadStartedAtMs: null,
      afterReload: null, rejectionChoiceStateAfterReload: "unknown", rejectionChoiceEvidence: null,
      networkRequests: [], networkRequestsComplete: true },
  });
  return {
    protocolVersion: 1, requestId: REQUEST.requestId, hostname: REQUEST.hostname, status: "complete",
    context: { browser: "Chromium", locale: "es-ES", timezone: "Europe/Madrid", viewport: "desktop-1365x768" },
    initial: flow(), policyLinkVisit: { status: "not_applicable", link: null, documentAccess: "not_checked", navigationStartedAtMs: null, beforeNavigation: null, afterNavigation: null },
    accept: flow(), reject: flow(), requestCount: 1, blockedRequestCount: 0,
    vendorControlCoverage: "not_applicable", vendorControlCount: 0, vendorControls: [],
    requestBudgetExceeded: false, thirdPartyRequestHosts: [], receivedBytes: null,
  };
}

class FakeDockerChild extends EventEmitter {
  readonly stdin = new PassThrough();
  readonly stdout = new PassThrough();
  readonly stderr = new PassThrough();
  exitCode: number | null = null;
  signalCode: NodeJS.Signals | null = null;

  constructor(onInputEnd: () => void) {
    super();
    this.stdin.once("end", onInputEnd);
  }

  kill(signal: NodeJS.Signals = "SIGTERM"): boolean {
    this.finish(null, "", signal);
    return true;
  }

  finish(
    code: number | null,
    output = "",
    signal: NodeJS.Signals | null = null,
    errorOutput = "",
  ): void {
    if (this.stdout.writableEnded) return;
    this.exitCode = code;
    this.signalCode = signal;
    if (output.length > 0) this.stdout.write(output);
    this.stdout.end();
    if (errorOutput.length > 0) this.stderr.write(errorOutput);
    this.stderr.end();
    queueMicrotask(() => this.emit("close", code, signal));
  }
}
