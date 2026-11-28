import { EventEmitter } from "node:events";
import { createRequire } from "node:module";
import type { ClientRequest, IncomingMessage } from "node:http";
import {
  createServer as createHttpServer,
  request as defaultHttpRequest,
} from "node:http";
import {
  request as defaultHttpsRequest,
  createServer as createHttpsServer,
} from "node:https";
import { Socket } from "node:net";
import type { Server as NetServer } from "node:net";
import { describe, expect, it, vi } from "vitest";
import type { LookupFunction } from "node:net";
import {
  requestPinnedHttpUpgrade,
  validateUpgradeLocation,
  type HttpRequestFactory,
} from "./pinned-http-upgrade.js";
import type { HttpsRequestFactory } from "./pinned-https-transport.js";

const HOSTNAME = "scan-fixture.example.net";
const PATHS = ["/"];
const LOOPBACK_ADDRESS = "127.0.0.1";
const { createEphemeralHttpsFixture } = createRequire(import.meta.url)(
  "../test/fixtures/https-fixture.cjs",
) as { createEphemeralHttpsFixture: () => { certificate: string; privateKey: string } };
const { certificate: FIXTURE_CERTIFICATE, privateKey: FIXTURE_PRIVATE_KEY } =
  createEphemeralHttpsFixture();

describe("validateUpgradeLocation", () => {
  it("accepts only the exact www alias pair and preserves the observed response status", () => {
    expect(validateUpgradeLocation("https://grumphya.com/", "www.grumphya.com", "/", ["/"], 301))
      .toEqual({ hostname: "grumphya.com", path: "/" });
    expect(validateUpgradeLocation("https://www.grumphya.com/", "grumphya.com", "/", ["/"], 308))
      .toEqual({ hostname: "www.grumphya.com", path: "/" });
    expect(validateUpgradeLocation("https://outside.example/", "www.grumphya.com", "/", ["/"], 301))
      .toBeUndefined();
  });

  it("accepts an exact www alias as the HTTPS target for any scanned hostname", () => {
    expect(validateUpgradeLocation(`https://www.${HOSTNAME}/`, HOSTNAME, "/", ["/"], 301))
      .toEqual({ hostname: `www.${HOSTNAME}`, path: "/" });
    expect(validateUpgradeLocation("https://www.outside.example/", HOSTNAME, "/", ["/"], 301))
      .toBeUndefined();
  });
});

function createResponse(
  statusCode: number,
  location?: string,
  socketBytesRead = 0,
): IncomingMessage {
  const response = new EventEmitter();
  const socket = new Socket();
  Object.defineProperty(socket, "bytesRead", { value: socketBytesRead });
  Object.assign(response, {
    statusCode,
    headers: location ? { location } : {},
    socket,
    resume() {
      response.emit("end");
      return this;
    },
    destroy() {
      return this;
    },
  });
  return response as unknown as IncomingMessage;
}

function createRequestFactory(
  statusCode: number,
  location?: string,
  socketBytesRead = 0,
): HttpRequestFactory {
  return vi.fn((_options, callback) => {
    const request = Object.assign(new EventEmitter(), {
      end() {
          callback(createResponse(statusCode, location, socketBytesRead));
        return this;
      },
      destroy() {
        return this;
      },
    });
    return request as unknown as ClientRequest;
  });
}

function createLookupFactory() {
  const lookup = vi.fn<LookupFunction>();
  const lookupRequests: Array<[string, number]> = [];
  const lookupFactory = vi.fn((hostname: string, port: number) => {
    lookupRequests.push([hostname, port]);
    return lookup;
  });
  return { lookupFactory, lookup, lookupRequests };
}

describe("requestPinnedHttpUpgrade", () => {
  it("follows only a same-host HTTPS redirect on the default port and same path", async () => {
    const httpFactory = createRequestFactory(
      301,
      `https://${HOSTNAME}/`,
    );
    const httpsOptions: Array<{ port: number | undefined; path: string | undefined }> = [];
    const httpsFactory: HttpsRequestFactory = vi.fn((options, callback) => {
      httpsOptions.push({ port: options.port, path: options.path });
      const request = Object.assign(new EventEmitter(), {
        end() {
          callback(createResponse(200));
          return this;
        },
        destroy() {
          return this;
        },
      });
      return request as unknown as ClientRequest;
    });
    const { lookupFactory, lookupRequests } = createLookupFactory();

    const result = await requestPinnedHttpUpgrade(
      {
        hostname: HOSTNAME,
        path: "/",
        method: "GET",
        allowedPaths: PATHS,
        signal: new AbortController().signal,
      },
      { requestFactory: httpFactory, httpsRequestFactory: httpsFactory, lookupFactory },
    );

    expect(result).toMatchObject({
      statusCode: 200,
      finalPath: "/",
      finalScheme: "https",
      redirectedToHttps: true,
      tlsAuthorized: false,
    });
    expect(httpFactory).toHaveBeenCalledWith(
      expect.objectContaining({ protocol: "http:", port: 80, hostname: HOSTNAME }),
      expect.any(Function),
    );
    expect(lookupRequests).toEqual([[HOSTNAME, 80], [HOSTNAME, 443]]);
    expect(httpsOptions).toEqual([{ port: 443, path: "/" }]);
  });

  it("follows HTTP to HTTPS when the target is the exact www alias", async () => {
    const httpFactory = createRequestFactory(301, `https://www.${HOSTNAME}/`);
    const httpsTargets: Array<{ host: string | undefined; port: number | undefined }> = [];
    const httpsFactory: HttpsRequestFactory = vi.fn((options, callback) => {
      httpsTargets.push({ host: options.hostname, port: options.port });
      const request = Object.assign(new EventEmitter(), {
        end() {
          callback(createResponse(200));
          return this;
        },
        destroy() {
          return this;
        },
      });
      return request as unknown as ClientRequest;
    });
    const { lookupFactory, lookupRequests } = createLookupFactory();

    const result = await requestPinnedHttpUpgrade(
      {
        hostname: HOSTNAME,
        path: "/",
        method: "GET",
        allowedPaths: PATHS,
        signal: new AbortController().signal,
      },
      { requestFactory: httpFactory, httpsRequestFactory: httpsFactory, lookupFactory },
    );

    expect(result).toMatchObject({
      statusCode: 200,
      finalScheme: "https",
      redirectedToHttps: true,
      hostnameRedirectEvidence: {
        requestedHostname: HOSTNAME,
        finalHostname: `www.${HOSTNAME}`,
        redirectStatusCode: 301,
        redirectFromHostname: HOSTNAME,
        redirectToHostname: `www.${HOSTNAME}`,
        canonicalHostname: `www.${HOSTNAME}`,
      },
    });
    expect(httpsTargets).toEqual([{ host: `www.${HOSTNAME}`, port: 443 }]);
    expect(lookupRequests).toEqual([[HOSTNAME, 80], [`www.${HOSTNAME}`, 443]]);
  });

  it.each([
    `https://other.example.org/`,
    `http://${HOSTNAME}/`,
    `https://${HOSTNAME}:8443/`,
    `https://${HOSTNAME}/admin`,
  ])("does not follow unsafe redirect %s", async (location) => {
    const httpFactory = createRequestFactory(302, location);
    const httpsFactory = vi.fn();
    const { lookupFactory } = createLookupFactory();

    const result = await requestPinnedHttpUpgrade(
      {
        hostname: HOSTNAME,
        path: "/",
        method: "HEAD",
        allowedPaths: PATHS,
        signal: new AbortController().signal,
      },
      {
        requestFactory: httpFactory,
        httpsRequestFactory: httpsFactory,
        lookupFactory,
      },
    );

    expect(result).toMatchObject({
      statusCode: 302,
      finalScheme: "http",
      redirectedToHttps: false,
    });
    expect(httpsFactory).not.toHaveBeenCalled();
  });

  it("rejects a path outside the allowed scope before creating a request", async () => {
    const httpFactory = vi.fn();
    const { lookupFactory } = createLookupFactory();

    await expect(
      requestPinnedHttpUpgrade(
        {
          hostname: HOSTNAME,
          path: "/admin",
          method: "GET",
          allowedPaths: PATHS,
          signal: new AbortController().signal,
        },
        { requestFactory: httpFactory, lookupFactory },
      ),
    ).rejects.toThrow("request_path_not_allowlisted");
    expect(httpFactory).not.toHaveBeenCalled();
  });

  it("counts received socket bytes and the attempted request", async () => {
    const requestFactory = createRequestFactory(200, undefined, 128);
    const { lookupFactory } = createLookupFactory();

    const result = await requestPinnedHttpUpgrade(
      {
        hostname: HOSTNAME,
        path: "/",
        method: "GET",
        allowedPaths: PATHS,
        signal: new AbortController().signal,
      },
      { requestFactory, lookupFactory },
    );

    expect(result.requestsCount).toBe(1);
    expect(result.bytesCount).toBe(128);
  });

  it("follows a real local HTTP redirect over a verified HTTPS socket", async () => {
    const observedHttp: Array<{ host: string | null | undefined; port: number | undefined }> = [];
    const observedHttps: Array<{ host: string | null | undefined; port: number | undefined }> = [];
    const secureHostnames: string[] = [];
    const httpServer = createHttpServer((_request, response) => {
      response.writeHead(301, { location: `https://${HOSTNAME}/` });
      response.end();
    });
    const httpsServer = createHttpsServer(
      { cert: FIXTURE_CERTIFICATE, key: FIXTURE_PRIVATE_KEY },
      (_request, response) => {
        response.writeHead(200, { "content-type": "text/plain" });
        response.end("local fixture");
      },
    );
    try {
      await listen(httpServer);
      await listen(httpsServer);
      const httpAddress = httpServer.address();
      const httpsAddress = httpsServer.address();
      if (
        httpAddress === null || typeof httpAddress === "string" ||
        httpsAddress === null || typeof httpsAddress === "string"
      ) {
        throw new Error("fixture_server_address_unavailable");
      }
      httpsServer.on("secureConnection", (socket) => {
        if (socket.servername) secureHostnames.push(socket.servername);
      });
      const lookupFactory = () =>
        ((_hostname, options, callback) => {
          if (options.all) {
            callback(null, [{ address: LOOPBACK_ADDRESS, family: 4 }]);
            return;
          }
          callback(null, LOOPBACK_ADDRESS, 4);
        }) as LookupFunction;
      const requestFactory: HttpRequestFactory = (options, callback) => {
        observedHttp.push({
          host: options.hostname,
          port: typeof options.port === "number" ? options.port : undefined,
        });
        return defaultHttpRequest({ ...options, port: httpAddress.port }, callback);
      };
      const httpsRequestFactory: HttpsRequestFactory = (options, callback) => {
        observedHttps.push({
          host: options.hostname,
          port: typeof options.port === "number" ? options.port : undefined,
        });
        return defaultHttpsRequest(
          { ...options, port: httpsAddress.port },
          callback,
        );
      };

      const result = await requestPinnedHttpUpgrade(
        {
          hostname: HOSTNAME,
          path: "/",
          method: "GET",
          allowedPaths: PATHS,
          signal: new AbortController().signal,
        },
        {
          httpsCa: FIXTURE_CERTIFICATE,
          lookupFactory,
          requestFactory,
          httpsRequestFactory,
        },
      );

      expect(result).toMatchObject({
        statusCode: 200,
        finalScheme: "https",
        redirectedToHttps: true,
        tlsAuthorized: true,
      });
      expect(observedHttp).toEqual([{ host: HOSTNAME, port: 80 }]);
      expect(observedHttps).toEqual([{ host: HOSTNAME, port: 443 }]);
      expect(secureHostnames).toEqual([HOSTNAME]);
      expect(result.requestsCount).toBe(2);
      expect(result.bytesCount).toBeGreaterThan(0);
    } finally {
      await Promise.all([closeServer(httpServer), closeServer(httpsServer)]);
    }
  });
});

function listen(server: NetServer) {
  return new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, LOOPBACK_ADDRESS, resolve);
  });
}

function closeServer(server: NetServer) {
  if (!server.listening) return Promise.resolve();
  return new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
}
