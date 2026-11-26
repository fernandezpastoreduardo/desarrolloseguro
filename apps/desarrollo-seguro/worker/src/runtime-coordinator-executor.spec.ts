import { chmod, mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { createServer, type Server } from "node:net";
import { afterEach, describe, expect, it, vi } from "vitest";
import { RuntimeCoordinatorExecutor } from "./runtime-coordinator-executor.js";

const directories: string[] = [];
const servers: Server[] = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve) => server.close(() => resolve()))));
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe("RuntimeCoordinatorExecutor", () => {
  it("streams correlated per-aspect progress before the final report", async () => {
    const directory = await mkdtemp(join(tmpdir(), "ds-runtime-progress-"));
    directories.push(directory);
    const socketPath = join(directory, "coordinator.sock");
    const progressEvent = { aspect: "privacy", state: "running" };
    const server = createServer((socket) => {
      let requestBuffer = "";
      socket.on("data", (chunk) => {
        requestBuffer += chunk.toString("utf8");
        const newline = requestBuffer.indexOf("\n");
        if (newline < 0) return;
        const request = JSON.parse(requestBuffer.slice(0, newline)) as { requestId: string };
        socket.write(`${JSON.stringify({ protocolVersion: 1, requestId: request.requestId, progressEvent })}\n`);
        socket.end(`${JSON.stringify({ protocolVersion: 1, requestId: request.requestId, result: makeResult() })}\n`);
      });
    });
    servers.push(server);
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(socketPath, resolve);
    });
    await chmod(socketPath, 0o660);
    const executor = new RuntimeCoordinatorExecutor({ socketPath, expectedSocketUid: process.getuid?.() ?? 0, expectedSocketGid: process.getgid?.() ?? 0 });
    const received: unknown[] = [];

    await executor.execute({ hostname: "sample.example.net", profileVersion: "transport-v1", targetUrl: null }, new AbortController().signal, async (event) => { received.push(event); });

    expect(received).toEqual([progressEvent]);
  });

  it("sends only the normalized hostname and profile through the trusted socket", async () => {
    const socketPath = await startCoordinator((request) => {
      expect(Object.keys(request).sort()).toEqual([
        "hostname",
        "profileVersion",
        "protocolVersion",
        "requestId",
      ]);
      expect(request.hostname).toBe("sample.example.net");
      expect(request.profileVersion).toBe("transport-v1");
      return {
        protocolVersion: 1,
        requestId: request.requestId,
        result: makeResult(),
      };
    });
    const socket = await stat(socketPath);
    const executor = new RuntimeCoordinatorExecutor({
      socketPath,
      expectedSocketUid: socket.uid,
      expectedSocketGid: socket.gid,
    });

    const result = await executor.execute(
      {
        hostname: " SAMPLE.EXAMPLE.NET. ",
        targetUrl: null, profileVersion: "transport-v1",
      },
      new AbortController().signal,
    );

    expect(result.scannerVersion).toBe("transport-v1-network-adapter-1");
    expect(result.checks).toHaveLength(5);
  });

  it("rejects a socket with the wrong owner or world permissions", async () => {
    const socketPath = await startCoordinator((request) => ({
      protocolVersion: 1,
      requestId: request.requestId,
      result: makeResult(),
    }));
    const socket = await stat(socketPath);
    const executor = new RuntimeCoordinatorExecutor({
      socketPath,
      expectedSocketUid: socket.uid + 1,
      expectedSocketGid: socket.gid,
    });

    await expect(
      executor.execute(
        { hostname: "sample.example.net", targetUrl: null, profileVersion: "transport-v1" },
        new AbortController().signal,
      ),
    ).rejects.toThrow("coordinator_socket_untrusted");
  });

  it("rejects a coordinator socket inside a group-writable directory", async () => {
    const socketPath = await startCoordinator((request) => ({
      protocolVersion: 1,
      requestId: request.requestId,
      result: makeResult(),
    }));
    const socket = await stat(socketPath);
    await chmod(dirname(socketPath), 0o770);
    const executor = new RuntimeCoordinatorExecutor({
      socketPath,
      expectedSocketUid: socket.uid,
      expectedSocketGid: socket.gid,
    });

    await expect(
      executor.execute(
        { hostname: "sample.example.net", targetUrl: null, profileVersion: "transport-v1" },
        new AbortController().signal,
      ),
    ).rejects.toThrow("coordinator_socket_untrusted");
  });

  it("fails closed when the coordinator returns an invalid response", async () => {
    const socketPath = await startCoordinator(() => ({
      protocolVersion: 1,
      requestId: "different-request",
      result: {},
    }));
    const socket = await stat(socketPath);
    const executor = new RuntimeCoordinatorExecutor({
      socketPath,
      expectedSocketUid: socket.uid,
      expectedSocketGid: socket.gid,
    });

    await expect(
      executor.execute(
        { hostname: "sample.example.net", targetUrl: null, profileVersion: "transport-v1" },
        new AbortController().signal,
      ),
    ).rejects.toThrow("transport_failed");
  });

  it("rejects malformed job data before contacting the coordinator", async () => {
    const socketPath = await startCoordinator(vi.fn());
    const socket = await stat(socketPath);
    const executor = new RuntimeCoordinatorExecutor({
      socketPath,
      expectedSocketUid: socket.uid,
      expectedSocketGid: socket.gid,
    });

    await expect(
      executor.execute(
        { hostname: "127.0.0.1", targetUrl: null, profileVersion: "transport-v1" },
        new AbortController().signal,
      ),
    ).rejects.toThrow("executor_request_invalid");
  });
});

async function startCoordinator(
  respond: (request: Record<string, unknown>) => unknown,
): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "ds-runtime-coordinator-"));
  directories.push(directory);
  const socketPath = join(directory, "coordinator.sock");
  const server = createServer((socket) => {
    const chunks: Buffer[] = [];
    let responded = false;
    socket.on("data", (chunk) => {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      const requestBytes = Buffer.concat(chunks);
      const newline = requestBytes.indexOf(0x0a);
      if (responded || newline < 0) return;
      responded = true;
      const request = JSON.parse(requestBytes.subarray(0, newline).toString("utf8")) as Record<string, unknown>;
      socket.end(JSON.stringify(respond(request)));
    });
  });
  servers.push(server);
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(socketPath, resolve);
  });
  await chmod(socketPath, 0o660);
  return socketPath;
}

function makeResult() {
  const observedAt = "2026-11-10T12:00:00.000Z";
  return {
    scannerVersion: "transport-v1-network-adapter-1",
    startedAt: observedAt,
    completedAt: observedAt,
    verdict: "inconclusive",
    scope: ["/"],
    checks: ["DNS", "TLS", "HEAD", "GET", "GET"].map((method, index) => ({
      controlId: ["DS-DNS-01", "DS-TLS-01", "DS-HTTP-01", "DS-HTTP-01", "DS-HDR-01"][index],
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
