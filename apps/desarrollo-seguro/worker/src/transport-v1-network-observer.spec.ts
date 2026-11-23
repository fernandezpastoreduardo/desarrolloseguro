import { EventEmitter } from "node:events";
import type { ClientRequest, IncomingMessage } from "node:http";
import type { LookupAddress } from "node:dns";
import { Socket } from "node:net";
import type { LookupFunction } from "node:net";
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

function makeTlsSocket(protocol: string = "TLSv1.3"): TLSSocket {
  const socket = Object.create(TLSSocket.prototype) as TLSSocket;
  Object.defineProperties(socket, {
    authorized: { value: true },
    getProtocol: { value: () => protocol },
  });
  return socket;
}

function responseWith(
  statusCode: number,
  headers: Record<string, string>,
  body = "",
  protocol = "TLSv1.3",
): IncomingMessage {
  const emitter = new EventEmitter();
  Object.assign(emitter, {
    statusCode,
    headers,
    socket: makeTlsSocket(protocol),
    resume() {
      if (body) emitter.emit("data", Buffer.from(body));
      emitter.emit("end");
      return this;
    },
    destroy() {
      return this;
    },
  });
  return emitter as unknown as IncomingMessage;
}

function httpsFactory(
  responseHeaders: Record<string, string> = {},
  responseBody = "",
): HttpsRequestFactory {
  return vi.fn((_options: HttpsOptions, callback) => {
    const request = new EventEmitter();
    Object.assign(request, {
      end() {
        const tlsProtocol = _options.maxVersion ?? "TLSv1.3";
        callback(
          responseWith(200, {
            "strict-transport-security": "max-age=31536000",
            "x-content-type-options": "nosniff",
            "x-frame-options": "DENY",
            "referrer-policy": "strict-origin-when-cross-origin",
            "content-security-policy": SECURE_CSP,
            ...responseHeaders,
          }, responseBody, String(tlsProtocol)),
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

  it("measures each supported TLS version with a version-pinned read-only probe", async () => {
    const requestFactory = httpsFactory();
    const observer = createTransportV1NetworkObserver({
      dnsResolver: vi.fn().mockResolvedValue(PUBLIC_ADDRESSES),
      lookupFactory: () => vi.fn(),
      httpsRequestFactory: requestFactory,
      probeTlsVersions: true,
    });

    await expect(observer.observeTls(HOSTNAME, new AbortController().signal)).resolves.toMatchObject({
      evidence: {
        protocol: "TLSv1.3",
        certificateValid: true,
        hostnameMatches: true,
        tls10Accepted: true,
        tls11Accepted: true,
        tls12Accepted: true,
        tls13Accepted: true,
      },
      requestsCount: 5,
    });
    expect(requestFactory).toHaveBeenCalledTimes(5);
    for (const [options] of vi.mocked(requestFactory).mock.calls.slice(1)) {
      expect(options.minVersion).toBe(options.maxVersion);
      expect(options.rejectUnauthorized).toBe(false);
      expect(options.path).toBe("/");
      expect(options.method).toBe("HEAD");
    }
  });

  it("keeps safe per-version failure categories when a TLS probe cannot connect", async () => {
    const requestFactory: HttpsRequestFactory = vi.fn((options, callback) => {
      const request = new EventEmitter();
      Object.assign(request, {
        end() {
          if (options.maxVersion) {
            const error = Object.assign(new Error("private socket detail"), { code: "ECONNRESET" });
            request.emit("error", error);
          } else {
            callback(responseWith(200, {}, "", "TLSv1.3"));
          }
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
      httpsRequestFactory: requestFactory,
      probeTlsVersions: true,
    });

    const result = await observer.observeTls(HOSTNAME, new AbortController().signal);

    expect(result.evidence).toMatchObject({
      tls10ProbeError: "connection_failed",
      tls11ProbeError: "connection_failed",
      tls12ProbeError: "connection_failed",
      tls13ProbeError: "connection_failed",
    });
    expect(JSON.stringify(result)).not.toContain("private socket detail");
  });

  it("records a rejected legacy TLS version as an explicit negative", async () => {
    const requestFactory: HttpsRequestFactory = vi.fn((options, callback) => {
      const request = new EventEmitter();
      Object.assign(request, {
        end() {
          if (options.maxVersion === "TLSv1" || options.maxVersion === "TLSv1.1") {
            request.emit("error", Object.assign(new Error("private protocol details"), { code: "EPROTO" }));
          } else {
            callback(responseWith(200, {}, "", String(options.maxVersion ?? "TLSv1.3")));
          }
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
      httpsRequestFactory: requestFactory,
      probeTlsVersions: true,
    });

    await expect(observer.observeTls(HOSTNAME, new AbortController().signal)).resolves.toMatchObject({
      evidence: {
        tls10Accepted: false,
        tls11Accepted: false,
        tls12Accepted: true,
        tls13Accepted: true,
      },
    });
  });

  it("runs the version matrix sequentially to stay within the network concurrency budget", async () => {
    let activeRequests = 0;
    let peakActiveRequests = 0;
    const requestFactory: HttpsRequestFactory = vi.fn((options, callback) => {
      const request = new EventEmitter();
      Object.assign(request, {
        end() {
          activeRequests += 1;
          peakActiveRequests = Math.max(peakActiveRequests, activeRequests);
          setTimeout(() => {
            callback(responseWith(200, {}, "", String(options.maxVersion ?? "TLSv1.3")));
            activeRequests -= 1;
          }, 5);
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
      httpsRequestFactory: requestFactory,
      probeTlsVersions: true,
    });

    const result = await observer.observeTls(HOSTNAME, new AbortController().signal);

    expect(peakActiveRequests).toBe(1);
    expect(result.evidence).toMatchObject({
      tls10Accepted: true,
      tls11Accepted: true,
      tls12Accepted: true,
      tls13Accepted: true,
    });
  });

  it("passes only aggregate cookie signals across the broker evidence boundary", async () => {
    const observer = createTransportV1NetworkObserver({
      lookupFactory: () => vi.fn(),
      httpsRequestFactory: httpsFactory(
        {
          "content-type": "text/html; charset=utf-8",
          "set-cookie": "_ga=secret-cookie-value; Path=/; SameSite=Lax",
        },
        "<button>Rechazar</button>",
      ),
      inspectPage: true,
    });

    const result = await observer.observeHeaders(
      HOSTNAME,
      new AbortController().signal,
    );

    expect(result.evidence).toMatchObject({
      inspected: true,
      cookieCount: 1,
      insecureCookieCount: 1,
      catalogMatchCount: 1,
      consentPromptDetected: true,
    });
    expect(JSON.stringify(result)).not.toContain("secret-cookie-value");
    expect(JSON.stringify(result)).not.toContain("_ga");
  });

  it("follows bounded public policy links and returns only aggregate text evidence", async () => {
    const requested: string[] = [];
    const pages = new Map<string, { statusCode: number; body: string }>([
      [`${HOSTNAME}/`, {
        statusCode: 200,
        body: '<a href="/politica-de-privacidad?campaign=secret#vendors">Política de privacidad</a><a href="https://vendor.example.com/privacy?token=private">Privacy policy</a>',
      }],
      [`${HOSTNAME}/politica-de-privacidad`, {
        statusCode: 200,
        body: "<p>Destinatarios y finalidades del tratamiento.</p>",
      }],
      ["vendor.example.com/privacy", {
        statusCode: 200,
        body: "<p>Recipients and purposes of processing.</p>",
      }],
    ]);
    const requestFactory: HttpsRequestFactory = vi.fn((options, callback) => {
      const request = new EventEmitter();
      Object.assign(request, {
        end() {
          const key = `${String(options.hostname)}${String(options.path)}`;
          requested.push(key);
          const page = pages.get(key) ?? { statusCode: 404, body: "Not found" };
          callback(responseWith(page.statusCode, { "content-type": "text/html; charset=utf-8" }, page.body));
          return this;
        },
        destroy() { return this; },
      });
      return request as unknown as ClientRequest;
    });
    const observer = createTransportV1NetworkObserver({
      inspectPage: true,
      lookupFactory: () => vi.fn(),
      httpsRequestFactory: requestFactory,
    });

    const result = await observer.observeHeaders(HOSTNAME, new AbortController().signal);

    expect(result.evidence).toMatchObject({
      privacyPolicyLinksFound: 2,
      policyLinksFound: 2,
      sitePrivacyPolicyFetched: true,
      policyPagesFetched: 2,
      policyPagesDenied: 0,
      policyPagesMissing: 0,
      policyRecipientsMentioned: true,
      policyPurposesMentioned: true,
      policyTextBlocked: false,
      policyProbeFailed: false,
      policyLanguageCatalogVersion: expect.any(String),
    });
    expect(requested).toEqual([
      `${HOSTNAME}/`,
      `${HOSTNAME}/politica-de-privacidad`,
      "vendor.example.com/privacy",
    ]);
    const publicResult = JSON.stringify(result);
    expect(publicResult).not.toContain("vendor.example.com");
    expect(publicResult).not.toContain("politica-de-privacidad");
    expect(publicResult).not.toContain("campaign=secret");
    expect(publicResult).not.toContain("token=private");
    expect(publicResult).not.toContain("Destinatarios");
    expect(publicResult).not.toContain("Recipients and purposes of processing.");
  });

  it.each([403, 429])("records explicit HTTP %s policy denial without treating it as a probe error", async (statusCode) => {
    const requestFactory: HttpsRequestFactory = vi.fn((options, callback) => {
      const request = new EventEmitter();
      Object.assign(request, {
        end() {
          const isRoot = options.path === "/";
          callback(responseWith(isRoot ? 200 : statusCode,
            isRoot ? { "content-type": "text/html" } : {},
            isRoot ? '<a href="https://vendor.example.com/privacy">Privacy policy</a>' : "Access denied"));
          return this;
        },
        destroy() { return this; },
      });
      return request as unknown as ClientRequest;
    });
    const observer = createTransportV1NetworkObserver({ inspectPage: true, lookupFactory: () => vi.fn(), httpsRequestFactory: requestFactory });

    const result = await observer.observeHeaders(HOSTNAME, new AbortController().signal);

    expect(result.evidence).toMatchObject({
      policyLinksFound: 1,
      policyPagesDenied: 1,
      policyPagesMissing: 0,
      policyTextBlocked: true,
      policyProbeFailed: false,
    });
  });

  it("distinguishes definitive missing policy pages from transient server failures", async () => {
    const requestFactory: HttpsRequestFactory = vi.fn((options, callback) => {
      const request = new EventEmitter();
      Object.assign(request, {
        end() {
          const isRoot = options.path === "/";
          callback(responseWith(isRoot ? 200 : options.path === "/privacy" ? 404 : 503,
            isRoot ? { "content-type": "text/html" } : {},
            isRoot ? '<a href="/privacy">Privacy policy</a><a href="/legal">Legal notice</a>' : ""));
          return this;
        },
        destroy() { return this; },
      });
      return request as unknown as ClientRequest;
    });
    const observer = createTransportV1NetworkObserver({ inspectPage: true, lookupFactory: () => vi.fn(), httpsRequestFactory: requestFactory });

    const result = await observer.observeHeaders(HOSTNAME, new AbortController().signal);

    expect(result.evidence).toMatchObject({
      privacyPolicyLinksFound: 1,
      policyLinksFound: 2,
      policyPagesMissing: 1,
      policyProbeFailed: true,
    });
  });

  it("does not follow a policy redirect to another host", async () => {
    const requested: string[] = [];
    const requestFactory: HttpsRequestFactory = vi.fn((options, callback) => {
      const request = new EventEmitter();
      Object.assign(request, {
        end() {
          requested.push(`${String(options.hostname)}${String(options.path)}`);
          const isRoot = options.path === "/";
          callback(responseWith(isRoot ? 200 : 302,
            isRoot ? { "content-type": "text/html" } : { location: "https://attacker.example/privacy" },
            isRoot ? '<a href="https://vendor.example.com/privacy">Privacy policy</a>' : ""));
          return this;
        },
        destroy() { return this; },
      });
      return request as unknown as ClientRequest;
    });
    const observer = createTransportV1NetworkObserver({ inspectPage: true, lookupFactory: () => vi.fn(), httpsRequestFactory: requestFactory });

    const result = await observer.observeHeaders(HOSTNAME, new AbortController().signal);

    expect(result.evidence).toMatchObject({ policyProbeFailed: true, policyPagesDenied: 0 });
    expect(requested).toEqual([`${HOSTNAME}/`, "vendor.example.com/privacy"]);
    expect(JSON.stringify(result)).not.toContain("attacker.example");
  });

  it("rejects a discovered host resolving to a private address before any request is sent", async () => {
    const successfulLookups: string[] = [];
    const requestFactory: HttpsRequestFactory = vi.fn((options, callback) => {
      const request = new EventEmitter();
      Object.assign(request, {
        end() {
          const hostname = String(options.hostname);
          const lookup = options.lookup as LookupFunction | undefined;
          if (!lookup) throw new Error("missing lookup");
          lookup(hostname, { all: false }, (error) => {
            if (error) {
              request.emit("error", error);
              return;
            }
            successfulLookups.push(hostname);
            const isRoot = options.path === "/";
            callback(responseWith(200,
              isRoot ? { "content-type": "text/html" } : { "content-type": "text/html" },
              isRoot ? '<a href="https://private.example.net/privacy">Privacy policy</a>' : "Recipients purposes"));
          });
          return this;
        },
        destroy() { return this; },
      });
      return request as unknown as ClientRequest;
    });
    const observer = createTransportV1NetworkObserver({
      inspectPage: true,
      httpsRequestFactory: requestFactory,
      dnsResolver: vi.fn(async (hostname: string) => hostname === HOSTNAME
        ? PUBLIC_ADDRESSES
        : [{ address: "192.168.1.7", family: 4 }]),
    });

    const result = await observer.observeHeaders(HOSTNAME, new AbortController().signal);

    expect(successfulLookups).toEqual([HOSTNAME]);
    expect(result.evidence).toMatchObject({ policyProbeFailed: true, policyPagesFetched: 0 });
    expect(JSON.stringify(result)).not.toContain("192.168.1.7");
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
      errorCode: "http_request_failed",
    });
    expect(JSON.stringify(result)).not.toContain("private transport detail");
  });

  it("categorizes DNS failures without returning resolver details", async () => {
    const observer = createTransportV1NetworkObserver({
      dnsResolver: vi.fn().mockRejectedValue(new Error("private resolver detail")),
    });

    const result = await observer.observeDns(
      HOSTNAME,
      new AbortController().signal,
    );

    expect(result).toMatchObject({
      evidence: {},
      errorCode: "dns_resolution_failed",
    });
    expect(JSON.stringify(result)).not.toContain("private resolver detail");
  });
});
