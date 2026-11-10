import { EventEmitter } from "node:events";
import type { ClientRequest, IncomingMessage } from "node:http";
import { TLSSocket } from "node:tls";
import { describe, expect, it, vi } from "vitest";
import {
  requestPinnedHttps,
  type HttpsRequestFactory,
} from "./pinned-https-transport.js";

const HOSTNAME = "sample.example.net";
const CSP =
  "default-src 'self'; script-src 'sha256-suebgenoyDvF0MseSMQjhvmvvc00cXYsKyXaeDanRCI='; object-src 'none'; base-uri 'self'; frame-ancestors 'none'; form-action 'self'";
const SECURITY_HEADERS = {
  "strict-transport-security": "max-age=31536000; includeSubDomains",
  "x-content-type-options": "nosniff",
  "x-frame-options": "DENY",
  "referrer-policy": "strict-origin-when-cross-origin",
  "content-security-policy": CSP,
};

function createTlsSocket(): TLSSocket {
  const socket = Object.create(TLSSocket.prototype) as TLSSocket;
  Object.defineProperties(socket, {
    authorized: { value: true },
    bytesRead: { value: 128 },
    getProtocol: { value: () => "TLSv1.3" },
  });
  return socket;
}

describe("requestPinnedHttps evidence snapshot", () => {
  it("returns TLS and derived header signals without retaining raw header values", async () => {
    const socket = createTlsSocket();
    const responseEmitter = new EventEmitter();
    Object.assign(responseEmitter, {
      statusCode: 200,
      headers: SECURITY_HEADERS,
      socket,
      resume() {
        responseEmitter.emit("data", Buffer.from("abc"));
        responseEmitter.emit("end");
        return this;
      },
    });
    const response = responseEmitter as unknown as IncomingMessage;
    const requestFactory = vi.fn((_options, callback) => {
      const request = Object.assign(new EventEmitter(), {
        end() {
          callback(response);
          return this;
        },
        destroy() {
          return this;
        },
      });
      return request as unknown as ClientRequest;
    });

    const result = await requestPinnedHttps(
      {
        hostname: HOSTNAME,
        path: "/",
        method: "GET",
        allowedPaths: ["/"],
        signal: new AbortController().signal,
      },
      {
        lookupFactory: () => vi.fn(),
        requestFactory,
      },
    );

    expect(result).toMatchObject({
      statusCode: 200,
      tlsAuthorized: true,
      tlsProtocol: "TLSv1.3",
      requestsCount: 1,
      bytesCount: 128,
      securityHeaders: {
        hsts: true,
        nosniff: true,
        frameProtection: true,
        referrerPolicy: true,
        csp: true,
      },
    });
    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain(CSP);
    expect(serialized).not.toContain("max-age=31536000");
  });

  it("returns safe zero metrics when creating the request fails", async () => {
    const requestFactory: HttpsRequestFactory = () => {
      throw new Error("private request details");
    };

    await expect(
      requestPinnedHttps(
        {
          hostname: HOSTNAME,
          path: "/",
          method: "GET",
          allowedPaths: ["/"],
          signal: new AbortController().signal,
        },
        { lookupFactory: () => vi.fn(), requestFactory },
      ),
    ).rejects.toMatchObject({
      code: "https_request_failed",
      requestsCount: 0,
      bytesCount: 0,
    });
  });
});
