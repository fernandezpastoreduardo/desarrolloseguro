import { EventEmitter } from "node:events";
import type { ClientRequest, IncomingMessage } from "node:http";
import type { LookupAddress } from "node:dns";
import { Socket } from "node:net";
import type { RequestOptions as HttpsOptions } from "node:https";
import { TLSSocket } from "node:tls";
import { describe, expect, it, vi } from "vitest";
import type { RequestOptions as HttpOptions } from "node:http";
import { createTransportV1NetworkObserver } from "./transport-v1-network-observer.js";
import type { HttpRequestFactory } from "./pinned-http-upgrade.js";
import type { HttpsRequestFactory } from "./pinned-https-transport.js";

const HOSTNAME = "sample.example.net";
const PUBLIC_ADDRESSES: LookupAddress[] = [
  { address: "93.184.216.34", family: 4 },
];
const SECURE_CSP =
  "default-src 'self'; script-src 'sha256-suebgenoyDvF0MseSMQjhvmvvc00cXYsKyXaeDanRCI='; object-src 'none'; base-uri 'self'; frame-ancestors 'none'; form-action 'self'";

function makeTlsSocket(): TLSSocket {
  const socket = Object.create(TLSSocket.prototype) as TLSSocket;
  Object.defineProperties(socket, {
    authorized: { value: true },
    getProtocol: { value: () => "TLSv1.3" },
  });
  return socket;
}

function responseWith(
  statusCode: number,
  headers: Record<string, string>,
): IncomingMessage {
  const emitter = new EventEmitter();
  Object.assign(emitter, {
    statusCode,
    headers,
    socket: makeTlsSocket(),
    resume() {
      emitter.emit("end");
      return this;
    },
    destroy() {
      return this;
    },
  });
  return emitter as unknown as IncomingMessage;
}

function httpsFactory(): HttpsRequestFactory {
  return vi.fn((_options: HttpsOptions, callback) => {
    const request = new EventEmitter();
    Object.assign(request, {
      end() {
        callback(
          responseWith(200, {
            "strict-transport-security": "max-age=31536000",
            "x-content-type-options": "nosniff",
            "x-frame-options": "DENY",
            "referrer-policy": "strict-origin-when-cross-origin",
            "content-security-policy": SECURE_CSP,
          }),
        );
        return this;
      },
      destroy() {
        return this;
      },
    });
    return request as unknown as ClientRequest;
  });
}

function httpRedirectFactory(): HttpRequestFactory {
  return vi.fn((_options: HttpOptions, callback) => {
    const request = new EventEmitter();
    Object.assign(request, {
      end() {
        const emitter = new EventEmitter();
        Object.assign(emitter, {
          statusCode: 301,
          headers: { location: `https://${HOSTNAME}/` },
          socket: new Socket(),
          resume() {
            emitter.emit("end");
            return this;
          },
          destroy() {
            return this;
          },
        });
        callback(emitter as unknown as IncomingMessage);
        return this;
      },
      destroy() {
        return this;
      },
    });
    return request as unknown as ClientRequest;
  });
}

describe("createTransportV1NetworkObserver", () => {
  it("composes bounded probes into the profile's minimal evidence", async () => {
    const tlsFactory = httpsFactory();
    const httpFactory = httpRedirectFactory();
    const observer = createTransportV1NetworkObserver({
      dnsResolver: vi.fn().mockResolvedValue(PUBLIC_ADDRESSES),
      lookupFactory: () => vi.fn(),
      httpRequestFactory: httpFactory,
      httpsRequestFactory: tlsFactory,
    });
    const signal = new AbortController().signal;

    await expect(observer.observeDns(HOSTNAME, signal)).resolves.toEqual({
      evidence: {
        addressClass: "public",
        aRecordCount: 1,
        aaaaRecordCount: 0,
      },
      requestsCount: 0,
      bytesCount: 0,
    });
    await expect(observer.observeTls(HOSTNAME, signal)).resolves.toMatchObject({
      evidence: {
        protocol: "TLSv1.3",
        certificateValid: true,
        hostnameMatches: true,
      },
      requestsCount: 1,
      bytesCount: 0,
    });
    await expect(
      observer.observeHttp(HOSTNAME, "HEAD", signal),
    ).resolves.toMatchObject({
      evidence: {
        statusCode: 200,
        redirectedToHttps: true,
        finalScheme: "https",
      },
      requestsCount: 2,
      bytesCount: 0,
    });
    await expect(observer.observeHeaders(HOSTNAME, signal)).resolves.toMatchObject({
      evidence: {
        finalScheme: "https",
        hsts: true,
        nosniff: true,
        frameProtection: true,
        referrerPolicy: true,
        csp: true,
      },
      requestsCount: 1,
      bytesCount: 0,
    });
    expect(httpFactory).toHaveBeenCalledTimes(1);
    expect(tlsFactory).toHaveBeenCalledTimes(3);
  });

  it("does not infer HTTPS header evidence from an unauthorized TLS response", async () => {
    const factory = vi.fn((_options: HttpsOptions, callback) => {
      const socket = Object.create(TLSSocket.prototype) as TLSSocket;
      Object.defineProperties(socket, {
        authorized: { value: false },
        getProtocol: { value: () => "TLSv1.3" },
      });
      const emitter = new EventEmitter();
      Object.assign(emitter, {
        statusCode: 200,
        headers: {
          "strict-transport-security": "max-age=31536000",
          "x-content-type-options": "nosniff",
          "x-frame-options": "DENY",
          "referrer-policy": "strict-origin-when-cross-origin",
          "content-security-policy": SECURE_CSP,
        },
        socket,
        resume() {
          emitter.emit("end");
          return this;
        },
      });
      const request = new EventEmitter();
      Object.assign(request, {
        end() {
          callback(emitter as unknown as IncomingMessage);
          return this;
        },
        destroy() {
          return this;
        },
      });
      return request as unknown as ClientRequest;
    });
    const observer = createTransportV1NetworkObserver({
      lookupFactory: () => vi.fn(),
      httpsRequestFactory: factory,
    });

    await expect(
      observer.observeHeaders(HOSTNAME, new AbortController().signal),
    ).resolves.toMatchObject({ evidence: { finalScheme: "https" } });
  });

  it("keeps attempt counts for transport failures without exposing error text", async () => {
    const httpFactory: HttpRequestFactory = vi.fn(() => {
      const request = new EventEmitter();
      Object.assign(request, {
        end() {
          request.emit("error", new Error("private transport detail"));
          return this;
        },
        destroy() {
          return this;
        },
      });
      return request as unknown as ClientRequest;
    });
    const observer = createTransportV1NetworkObserver({
      lookupFactory: () => vi.fn(),
      httpRequestFactory: httpFactory,
    });

    const result = await observer.observeHttp(
      HOSTNAME,
      "GET",
      new AbortController().signal,
    );

    expect(result).toEqual({
      evidence: {},
      requestsCount: 1,
      bytesCount: 0,
    });
    expect(JSON.stringify(result)).not.toContain("private transport detail");
  });
});
