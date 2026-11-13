import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ScanRunInput } from "@desarrolloseguro/persistence";
import {
  classifyBrokerStartupStderr,
  createDockerRuntimeCoordinatorRunner,
  createDockerRuntimeSessionFactory,
  type DockerRuntimeSessionFactory,
} from "./docker-runtime-coordinator-runner.js";
import type { TransportV1ExecutorRequest } from "./transport-v1-executor-protocol.js";

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

    await expect(runner.execute(REQUEST, signal)).resolves.toEqual(result);

    expect(factory.create).toHaveBeenCalledExactlyOnceWith(REQUEST, signal);
    expect(execute).toHaveBeenCalledExactlyOnceWith(REQUEST, signal);
    expect(close).toHaveBeenCalledOnce();
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

    await expect(runner.execute(REQUEST, new AbortController().signal)).rejects.toThrow(
      "transport_failed",
    );
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

    await expect(runner.execute(REQUEST, new AbortController().signal)).rejects.toThrow(
      "executor_failed",
    );
    expect(close).toHaveBeenCalledOnce();
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
