import {
  createServer as createHttpsServer,
  request as httpsRequest,
  type RequestOptions,
} from "node:https";
import { EventEmitter } from "node:events";
import { createRequire } from "node:module";
import type { LookupFunction } from "node:net";
import type { ClientRequest, IncomingMessage, ServerResponse } from "node:http";
import { afterEach, describe, expect, it, vi } from "vitest";
import { getCanonicalScanPaths } from "@desarrolloseguro/core";
import type {
  ClaimedScanJob,
  ScanJobStore,
  ScanRunInput,
} from "@desarrolloseguro/persistence";
import { ScanJobProcessor } from "./scan-job-processor.js";
import {
  requestPinnedHttps,
  type HttpsRequestFactory,
} from "./pinned-https-transport.js";

const FIXTURE_HOSTNAME = "scan-fixture.example.net";
const FIXTURE_ROOT_PATH = "/";
const FIXTURE_SAFE_PATH = "/precios";
const { createEphemeralHttpsFixture } = createRequire(import.meta.url)(
  "../test/fixtures/https-fixture.cjs",
) as { createEphemeralHttpsFixture: () => { certificate: string; privateKey: string } };
const { certificate: FIXTURE_CERTIFICATE, privateKey: FIXTURE_PRIVATE_KEY } =
  createEphemeralHttpsFixture();
const FIXTURE_REQUEST_PATHS = [FIXTURE_ROOT_PATH, FIXTURE_SAFE_PATH];
const LOOPBACK_ADDRESS = "127.0.0.1";
const LOOPBACK_FAMILY = 4;

type FixtureHandler = (
  request: IncomingMessage,
  response: ServerResponse,
) => void;

const servers: ReturnType<typeof createHttpsServer>[] = [];

afterEach(async () => {
  await Promise.all(
    servers.splice(0).map(
      (server) =>
        new Promise<void>((resolve, reject) => {
          server.close((error) => (error ? reject(error) : resolve()));
        }),
    ),
  );
});

describe("requestPinnedHttps", () => {
  it("pins the real TLS socket, verifies the certificate, and preserves Host/SNI", async () => {
    const requests: Array<{
      host: string | undefined;
      path: string | null | undefined;
    }> = [];
    const serverNames: Array<string | null> = [];
    const fixture = await startHttpsFixture((_request, response) => {
      response.writeHead(200, { "content-type": "text/plain" });
      response.end("fixture response body is not retained");
    });
    fixture.server.on("secureConnection", (socket) => {
      serverNames.push(socket.servername || null);
    });
    const lookup = createLoopbackLookup();
    const lookupRequests: Array<[string, number]> = [];
    const lookupFactory = vi.fn((hostname: string, port: number) => {
      lookupRequests.push([hostname, port]);
      return lookup;
    });

    const result = await requestPinnedHttps(
      {
        hostname: FIXTURE_HOSTNAME,
        path: FIXTURE_ROOT_PATH,
        method: "GET",
        allowedPaths: FIXTURE_REQUEST_PATHS,
        signal: new AbortController().signal,
      },
      {
        ca: FIXTURE_CERTIFICATE,
        lookupFactory,
        requestFactory: (options, callback) => {
          requests.push({
            host: (options.headers as Record<string, string | undefined>).host,
            path: options.path,
          });
          return httpsRequest({ ...options, port: fixture.port }, callback);
        },
      },
    );

    expect(result).toMatchObject({
      statusCode: 200,
      finalPath: FIXTURE_ROOT_PATH,
      finalScheme: "https",
      redirectCount: 0,
      remoteAddress: LOOPBACK_ADDRESS,
      tlsAuthorized: true,
    });
    expect(requests).toEqual([
      { host: FIXTURE_HOSTNAME, path: FIXTURE_ROOT_PATH },
    ]);
    expect(serverNames).toEqual([FIXTURE_HOSTNAME]);
    expect(lookup).toHaveBeenCalledOnce();
    expect(lookupRequests).toEqual([[FIXTURE_HOSTNAME, 443]]);
  });

  it("re-resolves and pins the same approved host for each in-scope HTTPS redirect", async () => {
    const receivedPaths: string[] = [];
    const fixture = await startHttpsFixture((request, response) => {
      receivedPaths.push(request.url ?? "");
      if (request.url === FIXTURE_ROOT_PATH) {
        response.writeHead(302, { location: FIXTURE_SAFE_PATH });
        response.end();
        return;
      }
      response.writeHead(200);
      response.end();
    });
    const lookup = createLoopbackLookup();
    const requestFactory: HttpsRequestFactory = (options, callback) =>
      httpsRequest({ ...options, port: fixture.port }, callback);

    const result = await requestPinnedHttps(
      {
        hostname: FIXTURE_HOSTNAME,
        path: FIXTURE_ROOT_PATH,
        method: "HEAD",
        allowedPaths: FIXTURE_REQUEST_PATHS,
        signal: new AbortController().signal,
      },
      {
        ca: FIXTURE_CERTIFICATE,
        lookupFactory: () => lookup,
        requestFactory,
      },
    );

    expect(result).toMatchObject({
      statusCode: 200,
      finalPath: FIXTURE_SAFE_PATH,
      redirectCount: 1,
      tlsAuthorized: true,
    });
    expect(receivedPaths).toEqual([FIXTURE_ROOT_PATH, FIXTURE_SAFE_PATH]);
    expect(lookup).toHaveBeenCalledTimes(2);
  });

  it("rejects a redirect to a different hostname before resolving or connecting to it", async () => {
    const fixture = await startHttpsFixture((_request, response) => {
      response.writeHead(302, {
        location: "https://outside.example.org/",
      });
      response.end();
    });
    const lookup = createLoopbackLookup();
    const requestFactory = vi.fn(
      (
        options: RequestOptions,
        callback: (response: IncomingMessage) => void,
      ) => httpsRequest({ ...options, port: fixture.port }, callback),
    );

    await expect(
      requestPinnedHttps(
        {
          hostname: FIXTURE_HOSTNAME,
          path: FIXTURE_ROOT_PATH,
          method: "GET",
          allowedPaths: FIXTURE_REQUEST_PATHS,
          signal: new AbortController().signal,
        },
        {
          ca: FIXTURE_CERTIFICATE,
          lookupFactory: () => lookup,
          requestFactory,
        },
      ),
    ).rejects.toThrow("redirect_origin_not_allowlisted");

    expect(requestFactory).toHaveBeenCalledOnce();
    expect(lookup).toHaveBeenCalledOnce();
  });

  it("rejects an HTTPS redirect to a path outside the declared scan scope", async () => {
    const fixture = await startHttpsFixture((_request, response) => {
      response.writeHead(302, { location: "/admin" });
      response.end();
    });
    const lookup = createLoopbackLookup();
    const requestFactory = vi.fn(
      (
        options: RequestOptions,
        callback: (response: IncomingMessage) => void,
      ) => httpsRequest({ ...options, port: fixture.port }, callback),
    );

    await expect(
      requestPinnedHttps(
        {
          hostname: FIXTURE_HOSTNAME,
          path: FIXTURE_ROOT_PATH,
          method: "GET",
          allowedPaths: FIXTURE_REQUEST_PATHS,
          signal: new AbortController().signal,
        },
        {
          ca: FIXTURE_CERTIFICATE,
          lookupFactory: () => lookup,
          requestFactory,
        },
      ),
    ).rejects.toThrow("redirect_path_not_allowlisted");

    expect(requestFactory).toHaveBeenCalledOnce();
  });

  it("rejects a redirect that downgrades TLS or changes the port", async () => {
    const unsafeLocations = [
      "http://scan-fixture.example.net/safe",
      "https://scan-fixture.example.net:8443/safe",
    ];

    for (const location of unsafeLocations) {
      const fixture = await startHttpsFixture((_request, response) => {
        response.writeHead(302, { location });
        response.end();
      });
      const lookup = createLoopbackLookup();
      const requestFactory = vi.fn(
        (
          options: RequestOptions,
          callback: (response: IncomingMessage) => void,
        ) => httpsRequest({ ...options, port: fixture.port }, callback),
      );

      await expect(
        requestPinnedHttps(
          {
            hostname: FIXTURE_HOSTNAME,
            path: FIXTURE_ROOT_PATH,
            method: "GET",
            allowedPaths: FIXTURE_REQUEST_PATHS,
            signal: new AbortController().signal,
          },
          {
            ca: FIXTURE_CERTIFICATE,
            lookupFactory: () => lookup,
            requestFactory,
          },
        ),
      ).rejects.toThrow("redirect_origin_not_allowlisted");

      expect(requestFactory).toHaveBeenCalledOnce();
      await closeServer(fixture.server);
      servers.splice(servers.indexOf(fixture.server), 1);
    }
  });

  it("rejects a requested path before any socket or DNS call when it is out of scope", async () => {
    const lookup = createLoopbackLookup();
    const requestFactory = vi.fn();

    await expect(
      requestPinnedHttps(
        {
          hostname: FIXTURE_HOSTNAME,
          path: "/admin",
          method: "GET",
          allowedPaths: FIXTURE_REQUEST_PATHS,
          signal: new AbortController().signal,
        },
        {
          ca: FIXTURE_CERTIFICATE,
          lookupFactory: () => lookup,
          requestFactory,
        },
      ),
    ).rejects.toThrow("request_path_not_allowlisted");

    expect(requestFactory).not.toHaveBeenCalled();
    expect(lookup).not.toHaveBeenCalled();
  });

  it("does not let a caller expand the hostname's canonical scan scope", async () => {
    const lookup = createLoopbackLookup();
    const requestFactory = vi.fn();

    await expect(
      requestPinnedHttps(
        {
          hostname: "outside.example.net",
          path: "/admin",
          method: "GET",
          allowedPaths: ["/admin"],
          signal: new AbortController().signal,
        },
        {
          ca: FIXTURE_CERTIFICATE,
          lookupFactory: () => lookup,
          requestFactory,
        },
      ),
    ).rejects.toThrow("request_path_not_allowlisted");

    expect(requestFactory).not.toHaveBeenCalled();
    expect(lookup).not.toHaveBeenCalled();
  });

  it("rejects an untrusted TLS certificate", async () => {
    const fixture = await startHttpsFixture((_request, response) => {
      response.writeHead(200);
      response.end();
    });

    await expect(
      requestPinnedHttps(
        {
          hostname: FIXTURE_HOSTNAME,
          path: FIXTURE_ROOT_PATH,
          method: "GET",
          allowedPaths: FIXTURE_REQUEST_PATHS,
          signal: new AbortController().signal,
        },
        {
          lookupFactory: createLoopbackLookup,
          requestFactory: (options, callback) =>
            httpsRequest({ ...options, port: fixture.port }, callback),
        },
      ),
    ).rejects.toThrow("tls_certificate_invalid");
  });

  it("aborts an in-flight request when its signal is cancelled", async () => {
    let notifyRequestStarted: (() => void) | undefined;
    const requestStarted = new Promise<void>((resolve) => {
      notifyRequestStarted = resolve;
    });
    const fixture = await startHttpsFixture(() => {
      notifyRequestStarted?.();
    });
    const controller = new AbortController();
    const request = requestPinnedHttps(
      {
        hostname: FIXTURE_HOSTNAME,
        path: FIXTURE_ROOT_PATH,
        method: "GET",
        allowedPaths: FIXTURE_REQUEST_PATHS,
        signal: controller.signal,
      },
      {
        ca: FIXTURE_CERTIFICATE,
        lookupFactory: createLoopbackLookup,
        requestFactory: (options, callback) =>
          httpsRequest({ ...options, port: fixture.port }, callback),
      },
    );

    await requestStarted;
    controller.abort();
    await expect(request).rejects.toThrow("request_aborted");
  });

  it("enforces the total request deadline", async () => {
    let notifyRequestStarted: (() => void) | undefined;
    const requestStarted = new Promise<void>((resolve) => {
      notifyRequestStarted = resolve;
    });
    const fixture = await startHttpsFixture(() => {
      notifyRequestStarted?.();
    });
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    try {
      const request = requestPinnedHttps(
        {
          hostname: FIXTURE_HOSTNAME,
          path: FIXTURE_ROOT_PATH,
          method: "GET",
          allowedPaths: FIXTURE_REQUEST_PATHS,
          signal: new AbortController().signal,
        },
        {
          ca: FIXTURE_CERTIFICATE,
          lookupFactory: createLoopbackLookup,
          requestFactory: (options, callback) =>
            httpsRequest({ ...options, port: fixture.port }, callback),
        },
      );

      await requestStarted;
      const rejectedRequest =
        expect(request).rejects.toThrow("request_timeout");
      await vi.advanceTimersByTimeAsync(10_001);
      await rejectedRequest;
    } finally {
      vi.useRealTimers();
    }
  });

  it("rejects response bodies larger than the fixed byte budget", async () => {
    const fixture = await startHttpsFixture((_request, response) => {
      response.writeHead(200);
      response.end("x".repeat(64 * 1024 + 1));
    });

    await expect(
      requestPinnedHttps(
        {
          hostname: FIXTURE_HOSTNAME,
          path: FIXTURE_ROOT_PATH,
          method: "GET",
          allowedPaths: FIXTURE_REQUEST_PATHS,
          signal: new AbortController().signal,
        },
        {
          ca: FIXTURE_CERTIFICATE,
          lookupFactory: createLoopbackLookup,
          requestFactory: (options, callback) =>
            httpsRequest({ ...options, port: fixture.port }, callback),
        },
      ),
    ).rejects.toThrow("response_size_limit_exceeded");
  });

  it("preserves a safe TLS category emitted by the response", async () => {
    const response = new EventEmitter() as IncomingMessage;
    Object.assign(response, {
      statusCode: 200,
      headers: {},
      socket: { remoteAddress: LOOPBACK_ADDRESS },
      resume: () => undefined,
    });
    const request = new EventEmitter() as ClientRequest;
    Object.assign(request, {
      end: () => queueMicrotask(() => {
        request.emit("response", response);
        response.emit("error", Object.assign(new Error("tls detail"), {
          code: "ERR_SSL_UNSUPPORTED_PROTOCOL",
        }));
      }),
      destroy: () => request,
    });

    await expect(requestPinnedHttps(
      {
        hostname: FIXTURE_HOSTNAME,
        path: FIXTURE_ROOT_PATH,
        method: "HEAD",
        allowedPaths: FIXTURE_REQUEST_PATHS,
        signal: new AbortController().signal,
      },
      {
        lookupFactory: createLoopbackLookup,
        requestFactory: (_options, callback) => {
          request.once("response", callback);
          return request;
        },
      },
    )).rejects.toThrow("tls_handshake_failed");
  });
});

describe("pinned HTTPS transport through the worker processor", () => {
  it("persists a fixture observation under the claimed job lease", async () => {
    const requestPaths: string[] = [];
    const fixture = await startHttpsFixture((request, response) => {
      requestPaths.push(request.url ?? "");
      response.writeHead(200);
      response.end();
    });
    const job: ClaimedScanJob = {
      id: "d1d1d1d1-d1d1-41d1-81d1-d1d1d1d1d1d1",
      hostname: FIXTURE_HOSTNAME,
      profileVersion: "controls-v1",
      trigger: "requested",
      attempts: 1,
      leaseToken: "fixture-lease-token",
      leaseUntil: new Date("2026-11-04T10:01:00.000Z"),
    };
    const persistedRuns: ScanRunInput[] = [];
    const store: ScanJobStore = {
      recoverExpiredLeases: vi.fn().mockResolvedValue(0),
      claimNextScan: vi.fn().mockResolvedValue(job),
      renewScanLease: vi.fn().mockResolvedValue(true),
      failScan: vi.fn().mockResolvedValue("retrying"),
      completeScan: vi.fn(async (input) => {
        persistedRuns.push(input);
        return "fixture-run-id";
      }),
    };
    const executor = {
      execute: async (claimedJob: ClaimedScanJob, signal: AbortSignal) => {
        const startedAt = new Date();
        const response = await requestPinnedHttps(
          {
            hostname: claimedJob.hostname,
            path: FIXTURE_ROOT_PATH,
            method: "HEAD",
            allowedPaths: getCanonicalScanPaths(claimedJob.hostname),
            signal,
          },
          {
            ca: FIXTURE_CERTIFICATE,
            lookupFactory: createLoopbackLookup,
            requestFactory: (options, callback) =>
              httpsRequest({ ...options, port: fixture.port }, callback),
          },
        );
        const completedAt = new Date();
        return {
          scannerVersion: "fixture-https-transport-v1",
          startedAt,
          completedAt,
          verdict: "inconclusive" as const,
          scope: [FIXTURE_ROOT_PATH],
          checks: [
            {
              controlId: "DS-HTTP-01",
              status: "unknown" as const,
              required: true as const,
              severity: "high",
              observedAt: completedAt,
              targetPath: FIXTURE_ROOT_PATH,
              method: "HEAD",
              summary: "Fixture HTTPS transport observation.",
              limitation: "No es un resultado de dominio público.",
              evidence: {
                statusCode: response.statusCode,
                redirectedToHttps: false,
                finalScheme: response.finalScheme,
              },
            },
          ],
          metrics: {
            requestsCount: 1,
            bytesCount: 0,
            durationMs: completedAt.getTime() - startedAt.getTime(),
            pagesCount: 1,
          },
        };
      },
    };
    const processor = new ScanJobProcessor(store, executor);

    await expect(processor.processNext()).resolves.toBe("completed");

    expect(requestPaths).toEqual([FIXTURE_ROOT_PATH]);
    expect(persistedRuns).toHaveLength(1);
    expect(persistedRuns[0]).toMatchObject({
      jobId: job.id,
      leaseToken: job.leaseToken,
      hostname: job.hostname,
      verdict: "inconclusive",
      checks: [
        expect.objectContaining({
          controlId: "DS-HTTP-01",
          status: "unknown",
          evidence: {
            statusCode: 200,
            redirectedToHttps: false,
            finalScheme: "https",
          },
        }),
      ],
    });
  });
});

async function startHttpsFixture(handler: FixtureHandler) {
  const server = createHttpsServer(
    { cert: FIXTURE_CERTIFICATE, key: FIXTURE_PRIVATE_KEY },
    handler,
  );
  servers.push(server);
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, LOOPBACK_ADDRESS, resolve);
  });
  const address = server.address();
  if (address === null || typeof address === "string") {
    throw new Error("https_fixture_address_unavailable");
  }
  return { server, port: address.port };
}

function closeServer(server: ReturnType<typeof createHttpsServer>) {
  return new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
}

function createLoopbackLookup(): LookupFunction {
  return vi.fn((_hostname, options, callback) => {
    if (options.all) {
      callback(null, [{ address: LOOPBACK_ADDRESS, family: LOOPBACK_FAMILY }]);
      return;
    }
    callback(null, LOOPBACK_ADDRESS, LOOPBACK_FAMILY);
  });
}
