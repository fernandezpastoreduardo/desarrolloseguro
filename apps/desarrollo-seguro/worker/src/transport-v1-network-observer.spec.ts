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

  it("follows only discovered policy links and returns bounded classification evidence", async () => {
    const policyBody = "Google Analytics se utiliza para analítica y medición de audiencia.";
    const fetchPolicy = vi.fn().mockResolvedValue({
      statusCode: 200,
      contentType: "text/html; charset=utf-8",
      html: `<p>${policyBody}</p>`,
      requestsCount: 1,
      bytesCount: Buffer.byteLength(policyBody),
      redirectCount: 0,
    });
    const observer = createTransportV1NetworkObserver({
      lookupFactory: () => vi.fn(),
      httpsRequestFactory: httpsFactory(
        { "content-type": "text/html; charset=utf-8" },
        '<a href="/politica-de-privacidad?campaign=secret#tracking">Privacidad</a>',
      ),
      inspectPublicPolicies: true,
      publicPolicyFetchDocument: fetchPolicy,
    });

    const result = await observer.observeHeaders(HOSTNAME, new AbortController().signal);

    expect(fetchPolicy).toHaveBeenCalledWith(expect.objectContaining({
      method: "GET",
      hostname: HOSTNAME,
      path: "/politica-de-privacidad",
    }));
    expect(result.evidence).toMatchObject({
      publicPolicyLinksFound: 1,
      publicPolicyPagesInspected: 1,
      publicPolicyProviderMentions: 1,
      publicPolicyProvidersMissingPurpose: 0,
      publicPolicyCategories: "analytics",
      publicPolicyAuditorError: false,
      publicPolicyBudgetExhausted: false,
    });
    expect(JSON.stringify(result)).not.toContain(policyBody);
    expect(JSON.stringify(result)).not.toContain("campaign=secret");
    expect(JSON.stringify(result)).not.toContain("tracking");
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
