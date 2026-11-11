import { chmod, mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TransportV1NetworkExecutor } from "./transport-v1-executor.js";
import type { TransportV1ObservationSource } from "./transport-v1-executor.js";
import {
  createUnixSocketObservationSource,
  listenTransportV1EgressBroker,
} from "./transport-v1-egress-ipc.js";

const HOSTNAME = "sample.example.net";
const directories: string[] = [];

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

async function socketPath(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "ds-egress-ipc-"));
  directories.push(directory);
  return join(directory, "broker.sock");
}

function makeSource(): TransportV1ObservationSource {
  const result = { evidence: { tls: true }, requestsCount: 1, bytesCount: 12 };
  return {
    sourceKind: "network",
    observeDns: vi.fn().mockResolvedValue(result),
    observeTls: vi.fn().mockResolvedValue(result),
    observeHttp: vi.fn().mockResolvedValue(result),
    observeHeaders: vi.fn().mockResolvedValue(result),
  };
}

describe("transport-v1 egress IPC", () => {
  it("completes all five checks through the IPC broker under the executor concurrency limit", async () => {
    const path = await socketPath();
    const source: TransportV1ObservationSource = {
      sourceKind: "network",
      observeDns: vi.fn().mockResolvedValue({
        evidence: { addressClass: "public", aRecordCount: 1, aaaaRecordCount: 0 },
        requestsCount: 0,
        bytesCount: 0,
      }),
      observeTls: vi.fn().mockResolvedValue({
        evidence: { protocol: "TLSv1.3", certificateValid: true, hostnameMatches: true },
        requestsCount: 1,
        bytesCount: 12,
      }),
      observeHttp: vi.fn().mockResolvedValue({
        evidence: { statusCode: 200, redirectedToHttps: true, finalScheme: "https" },
        requestsCount: 1,
        bytesCount: 12,
      }),
      observeHeaders: vi.fn().mockResolvedValue({
        evidence: {
          finalScheme: "https",
          hsts: true,
          nosniff: true,
          frameProtection: true,
          referrerPolicy: true,
          csp: true,
        },
        requestsCount: 1,
        bytesCount: 12,
      }),
    };
    const broker = await listenTransportV1EgressBroker(path, HOSTNAME, source);
    try {
      const executor = new TransportV1NetworkExecutor(
        createUnixSocketObservationSource(path),
      );
      const result = await executor.execute(
        { hostname: HOSTNAME, profileVersion: "transport-v1" },
        new AbortController().signal,
      );

      expect(result.verdict).toBe("pass");
      expect(result.checks).toHaveLength(5);
      expect(result.checks.map(({ status }) => status)).toEqual([
        "pass",
        "pass",
        "pass",
        "pass",
        "pass",
      ]);
      expect(source.observeDns).toHaveBeenCalledOnce();
      expect(source.observeTls).toHaveBeenCalledOnce();
      expect(source.observeHttp).toHaveBeenCalledTimes(2);
      expect(source.observeHeaders).toHaveBeenCalledOnce();
    } finally {
      await broker.close();
    }
  });

  it("exchanges the five bounded profile operations through the Unix socket", async () => {
    const path = await socketPath();
    const source = makeSource();
    const broker = await listenTransportV1EgressBroker(path, HOSTNAME, source);
    try {
      expect((await stat(path)).mode & 0o777).toBe(0o660);
      const client = createUnixSocketObservationSource(path);
      const signal = new AbortController().signal;
      await expect(client.observeDns(HOSTNAME, signal)).resolves.toEqual({
        evidence: { tls: true }, requestsCount: 1, bytesCount: 12,
      });
      await expect(client.observeTls(HOSTNAME, signal)).resolves.toEqual({
        evidence: { tls: true }, requestsCount: 1, bytesCount: 12,
      });
      await expect(client.observeHttp(HOSTNAME, "HEAD", signal)).resolves.toMatchObject({ evidence: { tls: true } });
      await expect(client.observeHttp(HOSTNAME, "GET", signal)).resolves.toMatchObject({ evidence: { tls: true } });
      await expect(client.observeHeaders(HOSTNAME, signal)).resolves.toMatchObject({ evidence: { tls: true } });
      expect(source.observeDns).toHaveBeenCalledOnce();
      expect(source.observeTls).toHaveBeenCalledOnce();
      expect(source.observeHttp).toHaveBeenNthCalledWith(1, HOSTNAME, "HEAD", expect.any(AbortSignal));
      expect(source.observeHttp).toHaveBeenNthCalledWith(2, HOSTNAME, "GET", expect.any(AbortSignal));
      expect(source.observeHeaders).toHaveBeenCalledOnce();
    } finally {
      await broker.close();
    }
  });

  it("preserves safe probe error categories across the Unix socket", async () => {
    const path = await socketPath();
    const source: TransportV1ObservationSource = {
      sourceKind: "network",
      observeDns: vi.fn().mockResolvedValue({
        evidence: {},
        requestsCount: 0,
        bytesCount: 0,
        errorCode: "dns_resolution_failed",
      }),
      observeTls: vi.fn().mockResolvedValue({ evidence: {}, requestsCount: 0, bytesCount: 0 }),
      observeHttp: vi.fn().mockResolvedValue({ evidence: {}, requestsCount: 0, bytesCount: 0 }),
      observeHeaders: vi.fn().mockResolvedValue({ evidence: {}, requestsCount: 0, bytesCount: 0 }),
    };
    const broker = await listenTransportV1EgressBroker(path, HOSTNAME, source);
    try {
      await expect(
        createUnixSocketObservationSource(path).observeDns(
          HOSTNAME,
          new AbortController().signal,
        ),
      ).resolves.toMatchObject({ errorCode: "dns_resolution_failed" });
    } finally {
      await broker.close();
    }
  });

  it("rejects a hostname outside the job scope before network observation", async () => {
    const path = await socketPath();
    const source = makeSource();
    const broker = await listenTransportV1EgressBroker(path, HOSTNAME, source);
    try {
      await expect(
        createUnixSocketObservationSource(path).observeDns(
          "other.example.net",
          new AbortController().signal,
        ),
      ).rejects.toThrow("egress_broker_request_invalid");
      expect(source.observeDns).not.toHaveBeenCalled();
    } finally {
      await broker.close();
    }
  });

  it("refuses to create the broker socket inside a group- or world-accessible directory", async () => {
    const path = await socketPath();
    await chmod(directories.at(-1) as string, 0o777);

    await expect(
      listenTransportV1EgressBroker(path, HOSTNAME, makeSource()),
    ).rejects.toThrow("egress_broker_socket_directory_invalid");
  });
});
