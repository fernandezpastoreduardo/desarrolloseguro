import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createConnection } from "node:net";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ScanRunInput } from "@desarrolloseguro/persistence";
import { RuntimeCoordinatorExecutor } from "./runtime-coordinator-executor.js";
import { listenRuntimeCoordinator } from "./runtime-coordinator-server.js";
import type { RuntimeCoordinatorRunner } from "./runtime-coordinator-server.js";
import { parseTransportV1ExecutorResponse } from "./transport-v1-executor-protocol.js";

const directories: string[] = [];
const closeCoordinator: Array<() => Promise<void>> = [];

afterEach(async () => {
  await Promise.all(closeCoordinator.splice(0).map((close) => close()));
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe("runtime coordinator server", () => {
  it("rejects unsafe error codes in executor responses", () => {
    expect(() => parseTransportV1ExecutorResponse({
      protocolVersion: 1,
      requestId: "11111111-1111-4111-8111-111111111111",
      errorCode: "permission denied: /secret",
    }, "11111111-1111-4111-8111-111111111111")).toThrow("executor_result_invalid");
  });

  it("rejects malformed probe diagnostics from the isolated executor", () => {
    expect(() => parseTransportV1ExecutorResponse({
      protocolVersion: 1,
      requestId: "11111111-1111-4111-8111-111111111111",
      errorCode: "executor_failed",
      diagnostic: {
        category: "network_observation_unavailable",
        probeFailures: [
          { operation: "dns", code: "dns_resolution_failed" },
          { operation: "dns", code: "connection_failed" },
        ],
      },
    }, "11111111-1111-4111-8111-111111111111")).toThrow("executor_response_invalid");
  });

  it("runs a validated request and returns a correlated bounded result", async () => {
    expect(() => parseTransportV1ExecutorResponse({
      protocolVersion: 1,
      requestId: "11111111-1111-4111-8111-111111111111",
      result: JSON.parse(JSON.stringify(makeResult())) as unknown,
    }, "11111111-1111-4111-8111-111111111111")).not.toThrow();
    const runner: RuntimeCoordinatorRunner = {
      execute: vi.fn().mockResolvedValue(makeResult()),
    };
    const socketPath = await startCoordinator(runner);
    const executor = await createClient(socketPath);

    const result = await executor.execute(
      { hostname: " SAMPLE.EXAMPLE.NET. ", profileVersion: "transport-v1" },
      new AbortController().signal,
    );

    expect(result.scannerVersion).toBe("transport-v1-network-adapter-1");
    expect(runner.execute).toHaveBeenCalledOnce();
    expect(runner.execute).toHaveBeenCalledWith(
      expect.objectContaining({ hostname: "sample.example.net", profileVersion: "transport-v1" }),
      expect.any(AbortSignal),
    );
  });

  it("returns a generic failure when the runtime throws synchronously", async () => {
    const runner: RuntimeCoordinatorRunner = {
      execute: vi.fn(() => {
        throw new Error("private runtime detail");
      }),
    };
    const socketPath = await startCoordinator(runner);
    const executor = await createClient(socketPath);

    await expect(
      executor.execute(
        { hostname: "sample.example.net", profileVersion: "transport-v1" },
        new AbortController().signal,
      ),
    ).rejects.toThrow("executor_failed");
    expect(runner.execute).toHaveBeenCalledOnce();
  });

  it("returns only an allowlisted runtime stage category", async () => {
    const runner: RuntimeCoordinatorRunner = {
      execute: vi.fn(() => {
        throw new Error("broker_failed", { cause: new Error("private path /secret") });
      }),
    };
    const socketPath = await startCoordinator(runner);
    const executor = await createClient(socketPath);

    await expect(
      executor.execute(
        { hostname: "sample.example.net", profileVersion: "transport-v1" },
        new AbortController().signal,
      ),
    ).rejects.toThrow("broker_failed");
    expect(runner.execute).toHaveBeenCalledOnce();
  });

  it("rejects extra protocol fields before invoking the runtime", async () => {
    const runner: RuntimeCoordinatorRunner = { execute: vi.fn().mockResolvedValue(makeResult()) };
    const socketPath = await startCoordinator(runner);
    const socket = createConnection(socketPath);
    const responseEnded = new Promise<string>((resolve) => {
      const chunks: Buffer[] = [];
      socket.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
      socket.once("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    });
    socket.end(`${JSON.stringify({
      protocolVersion: 1,
      requestId: "11111111-1111-4111-8111-111111111111",
      hostname: "sample.example.net",
      profileVersion: "transport-v1",
      leaseToken: "must-not-be-accepted",
    })}\n`);

    const response = JSON.parse(await responseEnded) as Record<string, unknown>;
    expect(response.errorCode).toBe("request_invalid");
    socket.destroy();
    expect(runner.execute).not.toHaveBeenCalled();
  });

  it("keeps only one runtime job active", async () => {
    const pending = createDeferred<ReturnType<typeof makeResult>>();
    const runner: RuntimeCoordinatorRunner = {
      execute: vi.fn(() => pending.promise),
    };
    const socketPath = await startCoordinator(runner);
    const executor = await createClient(socketPath);
    const signal = new AbortController().signal;
    const firstExecution = executor.execute(
      { hostname: "sample.example.net", profileVersion: "transport-v1" },
      signal,
    );
    await vi.waitFor(() => expect(runner.execute).toHaveBeenCalledOnce());

    await expect(
      executor.execute(
        { hostname: "sample.example.net", profileVersion: "transport-v1" },
        signal,
      ),
    ).rejects.toThrow("coordinator_unavailable");
    expect(runner.execute).toHaveBeenCalledOnce();

    pending.resolve(makeResult());
    await expect(firstExecution).resolves.toMatchObject({
      scannerVersion: "transport-v1-network-adapter-1",
    });
  });

  it("aborts an active runtime request when its client disconnects", async () => {
    let wasAborted = false;
    const runner: RuntimeCoordinatorRunner = {
      execute: vi.fn((
        _request: Parameters<RuntimeCoordinatorRunner["execute"]>[0],
        signal: AbortSignal,
      ) => new Promise<ReturnType<typeof makeResult>>((_resolve, reject) => {
        signal.addEventListener("abort", () => {
          wasAborted = true;
          reject(new Error("cancelled"));
        }, { once: true });
      })),
    };
    const socketPath = await startCoordinator(runner);
    const executor = await createClient(socketPath);
    const controller = new AbortController();
    const execution = executor.execute(
      { hostname: "sample.example.net", profileVersion: "transport-v1" },
      controller.signal,
    );
    const rejectedExecution = expect(execution).rejects.toThrow("request_aborted");
    await vi.waitFor(() => expect(runner.execute).toHaveBeenCalledOnce());
    controller.abort();

    await rejectedExecution;
    await vi.waitFor(() => expect(wasAborted).toBe(true));
  });

  it("waits for active runtime cleanup when the supervisor shuts down", async () => {
    let wasAborted = false;
    const runner: RuntimeCoordinatorRunner = {
      execute: vi.fn((
        _request: Parameters<RuntimeCoordinatorRunner["execute"]>[0],
        signal: AbortSignal,
      ) => new Promise<ReturnType<typeof makeResult>>((_resolve, reject) => {
        signal.addEventListener("abort", () => {
          wasAborted = true;
          reject(new Error("cancelled"));
        }, { once: true });
      })),
    };
    const socketPath = await startCoordinator(runner);
    const executor = await createClient(socketPath);
    const execution = executor.execute(
      { hostname: "sample.example.net", profileVersion: "transport-v1" },
      new AbortController().signal,
    ).catch(() => undefined);
    await vi.waitFor(() => expect(runner.execute).toHaveBeenCalledOnce());
    const close = closeCoordinator.at(-1);
    expect(close).toBeDefined();

    await close?.();
    await execution;
    expect(wasAborted).toBe(true);
  });
});

async function startCoordinator(runner: RuntimeCoordinatorRunner): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "ds-runtime-supervisor-"));
  directories.push(directory);
  const directoryMetadata = await stat(directory);
  const socketPath = join(directory, "coordinator.sock");
  const coordinator = await listenRuntimeCoordinator({
    socketPath,
    socketUid: directoryMetadata.uid,
    socketGid: directoryMetadata.gid,
  }, runner);
  closeCoordinator.push(coordinator.close);
  return socketPath;
}

async function createClient(socketPath: string): Promise<RuntimeCoordinatorExecutor> {
  const socket = await stat(socketPath);
  return new RuntimeCoordinatorExecutor({
    socketPath,
    expectedSocketUid: socket.uid,
    expectedSocketGid: socket.gid,
  });
}

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

function createDeferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}
