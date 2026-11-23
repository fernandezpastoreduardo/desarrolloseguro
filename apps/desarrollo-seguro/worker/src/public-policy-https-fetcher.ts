import { request as defaultHttpsRequest } from "node:https";
import type { ClientRequest, IncomingMessage } from "node:http";
import type { RequestOptions } from "node:https";
import { normalizeHostname } from "@desarrolloseguro/core";
import type { HttpsRequestFactory } from "./pinned-https-transport.js";
import {
  createPublicPolicyPinnedLookup,
  PUBLIC_POLICY_CRAWL_LIMITS,
  type PublicPolicyDocumentRequest,
  type PublicPolicyDocumentResponse,
  type PublicPolicyFetchDocument,
  type PublicPolicyFetchFailureCode,
} from "./public-policy-crawler.js";
import type { PublicDnsResolver } from "./pinned-dns-lookup.js";
import { safeTransportErrorCode } from "./pinned-transport-error.js";

const HTTPS_PORT = 443;
const REQUEST_TIMEOUT_MS = 10_000;
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);
const PRIVATE_HOST_SUFFIXES = [
  ".localhost", ".local", ".internal", ".test", ".invalid", ".example",
  ".home.arpa", ".onion", ".lan", ".home", ".corp", ".intranet", ".private",
];

export type PublicPolicyHttpsFetcherDependencies = {
  dnsResolver?: PublicDnsResolver;
  requestFactory?: HttpsRequestFactory;
};

type RawHttpsResponse = {
  statusCode?: number;
  contentType: string;
  location: string | undefined;
  html: string;
  bytesCount: number;
  failureCode?: PublicPolicyFetchFailureCode;
};

/** Creates a read-only HTTPS fetcher for URLs extracted from the initial page. */
export function createPublicPolicyHttpsFetcher(
  dependencies: PublicPolicyHttpsFetcherDependencies = {},
): PublicPolicyFetchDocument {
  const requestFactory = dependencies.requestFactory ?? defaultHttpsRequest;
  return async (request) => fetchPublicPolicyDocument(request, requestFactory, dependencies.dnsResolver);
}

async function fetchPublicPolicyDocument(
  request: PublicPolicyDocumentRequest,
  requestFactory: HttpsRequestFactory,
  dnsResolver?: PublicDnsResolver,
): Promise<PublicPolicyDocumentResponse> {
  const validatedRequest = validateRequest(request);
  if (!validatedRequest) return { contentType: "", html: "", requestsCount: 0, bytesCount: 0, redirectCount: 0, failureCode: "auditor_error" };

  const controller = new AbortController();
  const signal = AbortSignal.any([validatedRequest.signal, controller.signal]);
  const timeoutMs = Math.min(validatedRequest.timeoutMs, REQUEST_TIMEOUT_MS);
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const seenPaths = new Set([validatedRequest.path]);
  let path = validatedRequest.path;
  let requestsCount = 0;
  let bytesCount = 0;
  let redirectCount = 0;

  try {
    for (;;) {
      if (signal.aborted) {
        return createFailure("request_timeout", requestsCount, bytesCount, redirectCount);
      }
      const response = await requestOne({
        hostname: validatedRequest.hostname,
        path,
        signal,
        timeoutMs,
        requestFactory,
        lookup: createPublicPolicyPinnedLookup(validatedRequest.hostname, dnsResolver),
      });
      requestsCount += 1;
      bytesCount += response.bytesCount;
      if (response.failureCode) {
        return createFailure(response.failureCode, requestsCount, bytesCount, redirectCount, response.statusCode, response.contentType);
      }
      if (response.statusCode === undefined) {
        return createFailure("auditor_error", requestsCount, bytesCount, redirectCount);
      }

      if (!REDIRECT_STATUSES.has(response.statusCode)) {
        if (response.statusCode >= 200 && response.statusCode < 300 &&
            response.contentType.split(";", 1)[0]?.trim().toLowerCase() !== "text/html") {
          return createFailure("unsupported_content_type", requestsCount, bytesCount, redirectCount, response.statusCode, response.contentType);
        }
        return {
          statusCode: response.statusCode,
          contentType: response.contentType,
          html: response.html,
          requestsCount,
          bytesCount,
          redirectCount,
        };
      }

      const targetPath = getSameHostRedirectPath(
        response.location,
        validatedRequest.hostname,
        path,
      );
      if (!targetPath) {
        return createFailure("cross_host_redirect", requestsCount, bytesCount, redirectCount, response.statusCode);
      }
      if (redirectCount >= PUBLIC_POLICY_CRAWL_LIMITS.redirectsPerDocument || seenPaths.has(targetPath)) {
        return createFailure("redirect_limit_exceeded", requestsCount, bytesCount, redirectCount, response.statusCode);
      }
      redirectCount += 1;
      seenPaths.add(targetPath);
      path = targetPath;
    }
  } catch (error) {
    return createFailure(mapTransportFailure(error), requestsCount, bytesCount, redirectCount);
  } finally {
    clearTimeout(timer);
  }
}

function requestOne(input: {
  hostname: string;
  path: string;
  signal: AbortSignal;
  timeoutMs: number;
  requestFactory: HttpsRequestFactory;
  lookup: RequestOptions["lookup"];
}): Promise<RawHttpsResponse> {
  return new Promise((resolve) => {
    let settled = false;
    let receivedBodyBytes = 0;
    let htmlChunks: Buffer[] = [];
    let request: ClientRequest | undefined;
    let latestResponseBytes = 0;
    let responseStatus: number | undefined;
    let responseContentType = "";
    const finish = (result: RawHttpsResponse) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      input.signal.removeEventListener("abort", onAbort);
      resolve(result);
    };
    const fail = (error: unknown) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      input.signal.removeEventListener("abort", onAbort);
      resolve({
        ...(responseStatus === undefined ? {} : { statusCode: responseStatus }),
        contentType: responseContentType,
        location: undefined,
        html: "",
        bytesCount: latestResponseBytes,
        failureCode: mapTransportFailure(error) ?? "auditor_error",
      });
    };
    const timer = setTimeout(() => {
      request?.destroy();
      fail(new Error("request_timeout"));
    }, input.timeoutMs);
    const onAbort = () => {
      request?.destroy();
      fail(new Error("request_aborted"));
    };

    const options: RequestOptions = {
      hostname: input.hostname,
      port: HTTPS_PORT,
      protocol: "https:",
      path: input.path,
      method: "GET",
      servername: input.hostname,
      rejectUnauthorized: true,
      agent: false,
      lookup: input.lookup,
      headers: {
        host: input.hostname,
        accept: "text/html",
        "accept-encoding": "identity",
        connection: "close",
      },
    };

    try {
      request = input.requestFactory(options, (response) => {
        const statusCode = response.statusCode;
        if (statusCode === undefined) {
          response.destroy();
          fail(new Error("invalid_http_response"));
          return;
        }
        responseStatus = statusCode;
        responseContentType = readSingleHeader(response, "content-type") ?? "";
        const location = readSingleHeader(response, "location");
        const shouldReadHtml = statusCode >= 200 && statusCode < 300 &&
          /^text\/html(?:\s*;|$)/iu.test(responseContentType);

        if (!shouldReadHtml) {
          const raw = response as IncomingMessage;
          const bytesCount = countSocketBytes(raw, receivedBodyBytes);
          response.destroy();
          finish({ statusCode, contentType: responseContentType, location, html: "", bytesCount });
          return;
        }

        response.on("data", (chunk: Buffer | string) => {
          const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
          receivedBodyBytes += buffer.byteLength;
          latestResponseBytes = countSocketBytes(response, receivedBodyBytes);
          if (receivedBodyBytes > PUBLIC_POLICY_CRAWL_LIMITS.documentBytes) {
            response.destroy();
            request?.destroy();
            const bytesCount = countSocketBytes(response, receivedBodyBytes);
            finish({ contentType: responseContentType, location, html: "", bytesCount, failureCode: "response_too_large" });
            return;
          }
          htmlChunks.push(buffer);
        });
        response.once("error", fail);
        response.once("end", () => {
          if (settled || responseStatus === undefined) return;
          const bytesCount = countSocketBytes(response, receivedBodyBytes);
          const html = Buffer.concat(htmlChunks).toString("utf8");
          htmlChunks = [];
          finish({ statusCode: responseStatus, contentType: responseContentType, location, html, bytesCount });
        });
        response.resume();
      });
    } catch {
      fail(new Error("https_request_failed"));
      return;
    }
    if (!request) {
      fail(new Error("https_request_failed"));
      return;
    }
    request.once("error", fail);
    input.signal.addEventListener("abort", onAbort, { once: true });
    if (input.signal.aborted) {
      onAbort();
      return;
    }
    try {
      request.end();
    } catch {
      fail(new Error("https_request_failed"));
    }
  });
}

function validateRequest(input: PublicPolicyDocumentRequest): PublicPolicyDocumentRequest | null {
  if (typeof input !== "object" || input === null || Array.isArray(input) ||
      Object.getPrototypeOf(input) !== Object.prototype || Reflect.ownKeys(input).length !== 5 ||
      !Object.hasOwn(input, "method") || !Object.hasOwn(input, "hostname") ||
      !Object.hasOwn(input, "path") || !Object.hasOwn(input, "signal") ||
      !Object.hasOwn(input, "timeoutMs") || input.method !== "GET" ||
      !(input.signal instanceof AbortSignal) || !Number.isSafeInteger(input.timeoutMs) || input.timeoutMs < 1) {
    return null;
  }
  let hostname: string;
  try {
    hostname = normalizeHostname(input.hostname);
  } catch {
    return null;
  }
  if (
    hostname !== input.hostname || isPrivateHostname(hostname) ||
    typeof input.path !== "string" || !isSafePath(input.path)
  ) return null;
  return { method: "GET", hostname, path: input.path, signal: input.signal, timeoutMs: input.timeoutMs };
}

function getSameHostRedirectPath(
  location: string | undefined,
  hostname: string,
  currentPath: string,
): string | null {
  if (!location || location.length > 2_048 || containsUnsafeCharacter(location)) return null;
  let target: URL;
  try {
    target = new URL(location, `https://${hostname}${currentPath}`);
  } catch {
    return null;
  }
  let targetHostname: string;
  try {
    targetHostname = normalizeHostname(target.hostname);
  } catch {
    return null;
  }
  if (
    target.protocol !== "https:" || targetHostname !== hostname || target.port !== "" ||
    target.username !== "" || target.password !== "" || target.search !== "" || target.hash !== ""
  ) return null;
  const path = target.pathname;
  return isSafePath(path) ? path : null;
}

function isSafePath(path: string): boolean {
  return path.startsWith("/") && path.length <= 512 &&
    !containsUnsafeCharacter(path) &&
    !/%(?:0[0-9a-f]|1[0-9a-f]|7f)/iu.test(path);
}

function containsUnsafeCharacter(value: string): boolean {
  return Array.from(value).some((character) => {
    const code = character.codePointAt(0) ?? 0;
    return character === "\\" || code <= 0x1f || code === 0x7f;
  });
}

function isPrivateHostname(hostname: string): boolean {
  return PRIVATE_HOST_SUFFIXES.some((suffix) => hostname.endsWith(suffix));
}

function readSingleHeader(response: IncomingMessage, name: string): string | undefined {
  const value = response.headers[name];
  if (typeof value !== "string" || value.length > 2_048) return undefined;
  return value;
}

function countSocketBytes(response: IncomingMessage, bodyBytes: number): number {
  const socketBytes = response.socket?.bytesRead;
  return typeof socketBytes === "number" && Number.isSafeInteger(socketBytes) && socketBytes >= 0
    ? Math.max(socketBytes, bodyBytes)
    : bodyBytes;
}

function mapTransportFailure(error: unknown): PublicPolicyFetchFailureCode {
  const code = safeTransportErrorCode(error, "transport_failed");
  if (code === "request_timeout" || code === "request_aborted") return "request_timeout";
  if (code === "response_size_limit_exceeded") return "response_too_large";
  if (code === "dns_resolution_failed") return "dns_failure";
  if (code === "tls_certificate_invalid" || code === "tls_handshake_failed") return "tls_failure";
  return "auditor_error";
}

function createFailure(
  failureCode: NonNullable<PublicPolicyDocumentResponse["failureCode"]>,
  requestsCount: number,
  bytesCount: number,
  redirectCount: number,
  statusCode?: number,
  contentType = "",
): PublicPolicyDocumentResponse {
  return {
    ...(statusCode === undefined ? {} : { statusCode }),
    contentType,
    html: "",
    requestsCount,
    bytesCount,
    redirectCount,
    failureCode,
  };
}
