import type { ClientRequest, IncomingMessage } from "node:http";
import type { LookupAddress } from "node:dns";
import type { LookupFunction } from "node:net";
import { PassThrough } from "node:stream";
import type { RequestOptions } from "node:https";
import { describe, expect, it } from "vitest";
import type { HttpsRequestFactory } from "./pinned-https-transport.js";
import {
  createPublicPolicyHttpsFetcher,
} from "./public-policy-https-fetcher.js";
import { PUBLIC_POLICY_CRAWL_LIMITS } from "./public-policy-crawler.js";
import type { PublicPolicyDocumentRequest } from "./public-policy-crawler.js";

const HOSTNAME = "privacy.vendor.example.com";
const PUBLIC_IPV4: LookupAddress = { address: "93.184.216.34", family: 4 };
const PATH = "/privacy";
const HTML = "<html><body>Public privacy policy</body></html>";

type ResponsePlan = {
  statusCode: number;
  headers?: Record<string, string>;
  body?: string | Buffer;
};

function createRequestFactory(
  plans: readonly ResponsePlan[],
  captured: RequestOptions[] = [],
): HttpsRequestFactory {
  const remaining = [...plans];
  return ((options, callback) => {
    captured.push(options);
    const request = new PassThrough();
    const plan = remaining.shift();
    if (plan) {
      queueMicrotask(() => {
        const response = new PassThrough();
        Object.assign(response, {
          statusCode: plan.statusCode,
          headers: plan.headers ?? { "content-type": "text/html; charset=utf-8" },
          socket: { bytesRead: 0 },
        });
        callback(response as unknown as IncomingMessage);
        if (plan.body !== undefined) response.end(plan.body);
        else response.end();
      });
    }
    return request as unknown as ClientRequest;
  }) as HttpsRequestFactory;
}

function makeRequest(overrides: Partial<PublicPolicyDocumentRequest> = {}): PublicPolicyDocumentRequest {
  return {
    method: "GET",
    hostname: HOSTNAME,
    path: PATH,
    signal: new AbortController().signal,
    timeoutMs: 1_000,
    ...overrides,
  };
}

describe("createPublicPolicyHttpsFetcher", () => {
  it("uses a pinned HTTPS GET without cookies, credentials, or a referrer", async () => {
    const captured: RequestOptions[] = [];
    const fetchDocument = createPublicPolicyHttpsFetcher({
      dnsResolver: async () => [PUBLIC_IPV4],
      requestFactory: createRequestFactory([{ statusCode: 200, body: HTML }], captured),
    });

    const response = await fetchDocument(makeRequest());

    expect(response).toMatchObject({ statusCode: 200, contentType: "text/html; charset=utf-8", html: HTML, requestsCount: 1, redirectCount: 0 });
    expect(captured).toHaveLength(1);
    expect(captured[0]).toMatchObject({
      hostname: HOSTNAME,
      port: 443,
      protocol: "https:",
      path: PATH,
      method: "GET",
      servername: HOSTNAME,
      rejectUnauthorized: true,
      agent: false,
    });
    expect(captured[0]?.lookup).toEqual(expect.any(Function));
    expect(captured[0]?.headers).toEqual({
      host: HOSTNAME,
      accept: "text/html",
      "accept-encoding": "identity",
      connection: "close",
    });
  });

  it("follows at most three same-host redirects and counts the requests", async () => {
    const captured: RequestOptions[] = [];
    const fetchDocument = createPublicPolicyHttpsFetcher({
      dnsResolver: async () => [PUBLIC_IPV4],
      requestFactory: createRequestFactory([
        { statusCode: 302, headers: { location: "/privacy-next" } },
        { statusCode: 200, body: HTML },
      ], captured),
    });

    const response = await fetchDocument(makeRequest());

    expect(response).toMatchObject({ statusCode: 200, requestsCount: 2, redirectCount: 1, html: HTML });
    expect(captured.map(({ path }) => path)).toEqual(["/privacy", "/privacy-next"]);
  });

  it("rejects cross-host redirects without making a request to the new host", async () => {
    const captured: RequestOptions[] = [];
    const fetchDocument = createPublicPolicyHttpsFetcher({
      dnsResolver: async () => [PUBLIC_IPV4],
      requestFactory: createRequestFactory([
        { statusCode: 302, headers: { location: "https://other.example.com/privacy" } },
      ], captured),
    });

    const response = await fetchDocument(makeRequest());

    expect(response).toMatchObject({ failureCode: "cross_host_redirect", requestsCount: 1, redirectCount: 0 });
    expect(captured).toHaveLength(1);
  });

  it("stops after three same-host redirects and does not follow a fourth", async () => {
    const captured: RequestOptions[] = [];
    const fetchDocument = createPublicPolicyHttpsFetcher({
      dnsResolver: async () => [PUBLIC_IPV4],
      requestFactory: createRequestFactory([
        { statusCode: 302, headers: { location: "/privacy-1" } },
        { statusCode: 302, headers: { location: "/privacy-2" } },
        { statusCode: 302, headers: { location: "/privacy-3" } },
        { statusCode: 302, headers: { location: "/privacy-4" } },
      ], captured),
    });

    const response = await fetchDocument(makeRequest());

    expect(response).toMatchObject({ failureCode: "redirect_limit_exceeded", requestsCount: 4, redirectCount: 3 });
    expect(captured).toHaveLength(4);
  });

  it.each([403, 451])("returns HTTP %s as an explicit denial without reading its body", async (statusCode) => {
    const fetchDocument = createPublicPolicyHttpsFetcher({
      dnsResolver: async () => [PUBLIC_IPV4],
      requestFactory: createRequestFactory([{ statusCode, body: "blocked response" }]),
    });

    const response = await fetchDocument(makeRequest());

    expect(response).toMatchObject({ statusCode, html: "", requestsCount: 1 });
    expect(response).not.toHaveProperty("location", expect.any(String));
  });

  it("returns an auditor timeout and never exposes request errors", async () => {
    const requestFactory = ((options: RequestOptions) => {
      void options;
      return new PassThrough() as unknown as ClientRequest;
    }) as HttpsRequestFactory;
    const fetchDocument = createPublicPolicyHttpsFetcher({
      dnsResolver: async () => [PUBLIC_IPV4],
      requestFactory,
    });

    const response = await fetchDocument(makeRequest({ timeoutMs: 5 }));

    expect(response).toMatchObject({ failureCode: "request_timeout", requestsCount: 1, html: "" });
    expect(JSON.stringify(response)).not.toContain("ETIMEDOUT");
    expect(JSON.stringify(response)).not.toContain(HOSTNAME);
  });

  it("stops and discards an oversized document", async () => {
    const fetchDocument = createPublicPolicyHttpsFetcher({
      dnsResolver: async () => [PUBLIC_IPV4],
      requestFactory: createRequestFactory([
        { statusCode: 200, body: Buffer.alloc(PUBLIC_POLICY_CRAWL_LIMITS.documentBytes + 1, 0x61) },
      ]),
    });

    const response = await fetchDocument(makeRequest());

    expect(response).toMatchObject({ failureCode: "response_too_large", requestsCount: 1, html: "" });
    expect(JSON.stringify(response)).not.toContain("a".repeat(128));
  });

  it("rejects a private hostname before the request factory runs", async () => {
    let requestStarted = false;
    const requestFactory = ((options: RequestOptions) => {
      void options;
      requestStarted = true;
      return new PassThrough() as unknown as ClientRequest;
    }) as HttpsRequestFactory;
    const fetchDocument = createPublicPolicyHttpsFetcher({ requestFactory });

    const response = await fetchDocument(makeRequest({ hostname: "service.internal" }));

    expect(response).toMatchObject({ failureCode: "auditor_error", requestsCount: 0 });
    expect(requestStarted).toBe(false);
  });

  it("pins each connection to public DNS answers and rejects a private answer", async () => {
    const captured: RequestOptions[] = [];
    const fetchDocument = createPublicPolicyHttpsFetcher({
      dnsResolver: async () => [{ address: "10.0.0.2", family: 4 }],
      requestFactory: createRequestFactory([{ statusCode: 200, body: HTML }], captured),
    });

    const response = await fetchDocument(makeRequest());
    const lookup = captured[0]?.lookup as LookupFunction | undefined;
    expect(lookup).toBeDefined();
    await expect(runLookup(lookup as LookupFunction, HOSTNAME)).resolves.toMatchObject({
      error: { code: "EHOSTUNREACH" },
      address: "",
    });
    expect(response.statusCode).toBe(200);
  });
});

function runLookup(lookup: LookupFunction, hostname: string) {
  return new Promise<{ error: NodeJS.ErrnoException | null; address: string | LookupAddress[] }>((resolve) => {
    lookup(hostname, { all: false, family: 4 }, (error, address) => resolve({ error, address }));
  });
}
