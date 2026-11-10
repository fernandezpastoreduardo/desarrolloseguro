import { request as defaultHttpsRequest } from "node:https";
import type { ClientRequest, IncomingMessage } from "node:http";
import type { RequestOptions } from "node:https";
import type { LookupFunction } from "node:net";
import { TLSSocket } from "node:tls";
import {
  assessSecurityHeaders,
  getCanonicalScanPaths,
  normalizeHostname,
} from "@desarrolloseguro/core";
import type { SecurityHeaderEvidence } from "@desarrolloseguro/core";
import { createScopedPinnedLookup } from "./pinned-dns-lookup.js";
import {
  includeTransportMetrics,
  PinnedTransportError,
  safeTransportErrorCode,
} from "./pinned-transport-error.js";

const HTTPS_PORT = 443;
const MAX_REDIRECTS = 3;
const MAX_RESPONSE_BYTES = 64 * 1024;
const REQUEST_TIMEOUT_MS = 10_000;
const REDIRECT_STATUS_CODES = new Set([301, 302, 303, 307, 308]);
const BACKSLASH = "\\";

export type PinnedHttpsRequest = {
  hostname: string;
  path: string;
  method: "GET" | "HEAD";
  allowedPaths: readonly string[];
  signal: AbortSignal;
};

export type PinnedHttpsResult = {
  statusCode: number;
  finalPath: string;
  finalScheme: "https";
  redirectCount: number;
  remoteAddress: string | undefined;
  tlsAuthorized: boolean;
  tlsProtocol: "TLSv1.2" | "TLSv1.3" | undefined;
  securityHeaders: SecurityHeaderEvidence | null;
  requestsCount: number;
  bytesCount: number;
};

export type HttpsRequestFactory = (
  options: RequestOptions,
  callback: (response: IncomingMessage) => void,
) => ClientRequest;

export type PinnedHttpsDependencies = {
  ca?: string;
  lookupFactory?: (hostname: string) => LookupFunction;
  requestFactory?: HttpsRequestFactory;
};

export async function requestPinnedHttps(
  input: PinnedHttpsRequest,
  dependencies: PinnedHttpsDependencies = {},
): Promise<PinnedHttpsResult> {
  const hostname = normalizeHostname(input.hostname);
  validateRequestMethod(input.method);
  validateAllowedPaths(input.allowedPaths);
  const canonicalPaths = getCanonicalScanPaths(hostname);
  const allowedPaths = input.allowedPaths.filter((path) =>
    canonicalPaths.includes(path),
  );
  validatePath(input.path, allowedPaths, "request_path_not_allowlisted");
  if (input.signal.aborted) {
    throw new Error("request_aborted");
  }

  const lookupFactory =
    dependencies.lookupFactory ??
    ((targetHostname: string) => createScopedPinnedLookup(targetHostname));
  const requestFactory = dependencies.requestFactory ?? defaultHttpsRequest;
  const deadline = Date.now() + REQUEST_TIMEOUT_MS;
  let currentPath = input.path;
  let requestsCount = 0;
  let bytesCount = 0;

  for (let redirectCount = 0; ; redirectCount += 1) {
    const remainingMs = deadline - Date.now();
    if (remainingMs <= 0) {
      throw new PinnedTransportError("request_timeout", requestsCount, bytesCount);
    }
    let result: MakeRequestResult;
    try {
      result = await makeRequest({
        hostname,
        path: currentPath,
        method: input.method,
        signal: input.signal,
        timeoutMs: remainingMs,
        lookup: lookupFactory(hostname),
        requestFactory,
        ca: dependencies.ca,
      });
    } catch (error) {
      throw includeTransportMetrics(error, requestsCount, bytesCount, "https_request_failed");
    }
    requestsCount += 1;
    bytesCount += result.bytesCount;

    if (!REDIRECT_STATUS_CODES.has(result.statusCode)) {
      return {
        statusCode: result.statusCode,
        finalPath: currentPath,
        finalScheme: "https",
        redirectCount,
        remoteAddress: result.remoteAddress,
        tlsAuthorized: result.tlsAuthorized,
        tlsProtocol: result.tlsProtocol,
        securityHeaders: result.securityHeaders,
        requestsCount,
        bytesCount,
      };
    }

    if (redirectCount >= MAX_REDIRECTS) {
      throw new PinnedTransportError(
        "redirect_limit_exceeded",
        requestsCount,
        bytesCount,
      );
    }
    try {
      currentPath = validateRedirect(
        result.location,
        hostname,
        currentPath,
        allowedPaths,
      );
    } catch (error) {
      throw new PinnedTransportError(
        safeTransportErrorCode(error, "transport_failed"),
        requestsCount,
        bytesCount,
      );
    }
  }
}

type MakeRequestInput = {
  hostname: string;
  path: string;
  method: "GET" | "HEAD";
  signal: AbortSignal;
  timeoutMs: number;
  lookup: LookupFunction;
  requestFactory: HttpsRequestFactory;
  ca: string | undefined;
};

type MakeRequestResult = {
  statusCode: number;
  location: string | undefined;
  remoteAddress: string | undefined;
  tlsAuthorized: boolean;
  tlsProtocol: "TLSv1.2" | "TLSv1.3" | undefined;
  securityHeaders: SecurityHeaderEvidence | null;
  bytesCount: number;
};

function makeRequest(input: MakeRequestInput): Promise<MakeRequestResult> {
  return new Promise((resolve, reject) => {
    let settled = false;
    let receivedBytes = 0;
    let requestStarted = false;
    let request: ClientRequest | undefined;
    const timeoutHolder: { timer?: NodeJS.Timeout } = {};
    const finishWithError = (error: unknown) => {
      if (settled) return;
      settled = true;
      if (timeoutHolder.timer !== undefined) clearTimeout(timeoutHolder.timer);
      input.signal.removeEventListener("abort", abortRequest);
      reject(
        new PinnedTransportError(
          safeTransportErrorCode(error, "https_request_failed"),
          requestStarted ? 1 : 0,
          getReceivedBytesCount(request?.socket, receivedBytes),
        ),
      );
    };
    const abortRequest = () => {
      request?.destroy();
      finishWithError("request_aborted");
    };
    const options: RequestOptions = {
      hostname: input.hostname,
      port: HTTPS_PORT,
      protocol: "https:",
      path: input.path,
      method: input.method,
      servername: input.hostname,
      rejectUnauthorized: true,
      agent: false,
      lookup: input.lookup,
      ca: input.ca,
      headers: {
        host: input.hostname,
        accept: "*/*",
        "accept-encoding": "identity",
        connection: "close",
      },
    };

    try {
      request = input.requestFactory(options, (response) => {
        const socket = response.socket;
        const remoteAddress = socket.remoteAddress;
        const statusCode = response.statusCode;
        if (statusCode === undefined) {
          response.resume();
          finishWithError("invalid_http_response");
          return;
        }
        response.on("data", (chunk: Buffer | string) => {
          receivedBytes += Buffer.byteLength(chunk);
          if (receivedBytes > MAX_RESPONSE_BYTES) {
            response.destroy();
            request?.destroy();
            finishWithError("response_size_limit_exceeded");
          }
        });
        response.once("error", () => finishWithError("https_request_failed"));
        response.once("end", () => {
          if (settled) return;
          settled = true;
          if (timeoutHolder.timer !== undefined) {
            clearTimeout(timeoutHolder.timer);
          }
          input.signal.removeEventListener("abort", abortRequest);
          resolve({
            statusCode,
            location: getSingleHeader(response, "location"),
            remoteAddress,
            tlsAuthorized: socket instanceof TLSSocket && socket.authorized,
            tlsProtocol: getTlsProtocol(socket),
            securityHeaders: assessSecurityHeaders(
              response.headers,
              "https",
            ).evidence,
            bytesCount: getReceivedBytesCount(socket, receivedBytes),
          });
        });
        response.resume();
      });
    } catch {
      finishWithError("https_request_failed");
      return;
    }
    if (!request) {
      finishWithError("https_request_failed");
      return;
    }

    input.signal.addEventListener("abort", abortRequest, { once: true });
    timeoutHolder.timer = setTimeout(() => {
      request.destroy();
      finishWithError("request_timeout");
    }, input.timeoutMs);
    request.once("error", (error) =>
      finishWithError(sanitizeRequestError(error)),
    );
    if (input.signal.aborted) {
      abortRequest();
      return;
    }
    requestStarted = true;
    try {
      request.end();
    } catch {
      finishWithError("https_request_failed");
    }
  });
}

function getTlsProtocol(
  socket: IncomingMessage["socket"],
): "TLSv1.2" | "TLSv1.3" | undefined {
  if (!(socket instanceof TLSSocket)) return undefined;
  const protocol = socket.getProtocol();
  if (protocol === "TLSv1.2" || protocol === "TLSv1.3") return protocol;
  return undefined;
}

function getReceivedBytesCount(
  socket: { bytesRead: number } | null | undefined,
  bodyBytes: number,
): number {
  if (!socket || !Number.isSafeInteger(socket.bytesRead) || socket.bytesRead < 0) {
    return bodyBytes;
  }
  return Math.max(bodyBytes, socket.bytesRead);
}

function validateRedirect(
  location: string | undefined,
  hostname: string,
  currentPath: string,
  allowedPaths: readonly string[],
): string {
  if (location === undefined || location.length > 2_048) {
    throw new Error("redirect_origin_not_allowlisted");
  }
  let target: URL;
  try {
    target = new URL(location, `https://${hostname}${currentPath}`);
  } catch {
    throw new Error("redirect_origin_not_allowlisted");
  }
  if (
    target.protocol !== "https:" ||
    target.hostname !== hostname ||
    (target.port !== "" && target.port !== String(HTTPS_PORT)) ||
    target.username !== "" ||
    target.password !== "" ||
    target.hash !== ""
  ) {
    throw new Error("redirect_origin_not_allowlisted");
  }
  const path = `${target.pathname}${target.search}`;
  validatePath(path, allowedPaths, "redirect_path_not_allowlisted");
  return path;
}

function validatePath(
  path: string,
  allowedPaths: readonly string[],
  errorCode: string,
): void {
  if (
    typeof path !== "string" ||
    hasUnsafePathCharacters(path) ||
    path.includes("#") ||
    path.includes("?") ||
    !allowedPaths.includes(path)
  ) {
    throw new Error(errorCode);
  }
}

function hasUnsafePathCharacters(path: string): boolean {
  if (path.includes(BACKSLASH)) return true;
  return [...path].some((character) => {
    const code = character.codePointAt(0) ?? 0;
    return code < 0x20 || code === 0x7f;
  });
}

function validateAllowedPaths(allowedPaths: readonly string[]): void {
  if (
    !Array.isArray(allowedPaths) ||
    allowedPaths.length === 0 ||
    allowedPaths.some((path) => typeof path !== "string")
  ) {
    throw new Error("invalid_scan_scope");
  }
}

function validateRequestMethod(method: string): void {
  if (method !== "GET" && method !== "HEAD") {
    throw new Error("invalid_request_method");
  }
}

function getSingleHeader(
  response: IncomingMessage,
  name: string,
): string | undefined {
  const value = response.headers[name];
  if (typeof value === "string") return value;
  if (Array.isArray(value) && value.length === 1) return value[0];
  return undefined;
}

function sanitizeRequestError(error: Error): string {
  return safeTransportErrorCode(error, "https_request_failed");
}
