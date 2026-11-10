import { EventEmitter } from "node:events";
import type { ClientRequest, IncomingMessage } from "node:http";
import { Socket } from "node:net";
import { describe, expect, it, vi } from "vitest";
import type { LookupFunction } from "node:net";
import {
  requestPinnedHttpUpgrade,
  type HttpRequestFactory,
} from "./pinned-http-upgrade.js";
import type { HttpsRequestFactory } from "./pinned-https-transport.js";

const HOSTNAME = "scan-fixture.example.net";
const PATHS = ["/"];

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
  return { lookupFactory: () => lookup, lookup };
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
    const { lookupFactory } = createLookupFactory();

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
    expect(httpsOptions).toEqual([{ port: 443, path: "/" }]);
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
});
