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
import { inspectPassivePageSignals } from "./passive-page-signals.js";
import type { PassivePageSignalInput } from "./passive-page-signals.js";
import {
  createEgressAuthorizedLookup,
  createEgressDestinationAuthorizer,
} from "./egress-destination-policy.js";
import {
  includeTransportMetrics,
  PinnedTransportError,
  safeTransportErrorCode,
} from "./pinned-transport-error.js";
import { extractPublicPolicyLinks } from "./public-policy-link-extractor.js";
import type { PublicPolicyLink } from "./public-policy-link-extractor.js";

const HTTPS_PORT = 443;
const MAX_REDIRECTS = 3;
const MAX_RESPONSE_BYTES = 64 * 1024;
const REQUEST_TIMEOUT_MS = 10_000;
const REDIRECT_STATUS_CODES = new Set([301, 302, 303, 307, 308]);
const PERMANENT_REDIRECT_STATUS_CODES = new Set([301, 308]);
const GRUMPHYA_HOSTNAMES = new Set(["grumphya.com", "www.grumphya.com"]);
const BACKSLASH = "\\";

export type PinnedHttpsRequest = {
  hostname: string;
  requestedHostname?: string;
  initialRedirect?: { statusCode: number; fromHostname: string; toHostname: string };
  allowGrumphyaAliasRedirects?: boolean;
  path: string;
  method: "GET" | "HEAD";
  allowedPaths: readonly string[];
  signal: AbortSignal;
  inspectPage?: boolean;
  capturePublicPolicyLinks?: boolean;
  tlsVersion?: "TLSv1" | "TLSv1.1" | "TLSv1.2" | "TLSv1.3";
  allowUntrustedCertificate?: boolean;
  timeoutMs?: number;
};

export type PinnedHttpsResult = {
  statusCode: number;
  finalHostname: string;
  finalPath: string;
  finalScheme: "https";
  redirectCount: number;
  remoteAddress: string | undefined;
  tlsAuthorized: boolean;
  tlsProtocol: "TLSv1" | "TLSv1.1" | "TLSv1.2" | "TLSv1.3" | undefined;
  securityHeaders: SecurityHeaderEvidence | null;
  passivePageSignals?: ReturnType<typeof inspectPassivePageSignals>;
  publicPolicyPageInspectable?: boolean;
  publicPolicyLinks?: PublicPolicyLink[];
  requestsCount: number;
  bytesCount: number;
  redirectStatusCode: number | null;
  redirectFromHostname: string | null;
  redirectToHostname: string | null;
  canonicalHostname: string | null;
};

export type HttpsRequestFactory = (
  options: RequestOptions,
  callback: (response: IncomingMessage) => void,
) => ClientRequest;

export type PinnedHttpsDependencies = {
  ca?: string;
  lookupFactory?: (hostname: string, port: number) => LookupFunction;
  requestFactory?: HttpsRequestFactory;
};

export async function requestPinnedHttps(
  input: PinnedHttpsRequest,
  dependencies: PinnedHttpsDependencies = {},
): Promise<PinnedHttpsResult> {
  const hostname = normalizeHostname(input.hostname);
  const requestedHostname = normalizeHostname(input.requestedHostname ?? hostname);
  if (input.initialRedirect && (
    !REDIRECT_STATUS_CODES.has(input.initialRedirect.statusCode) ||
    input.initialRedirect.fromHostname !== requestedHostname ||
    input.initialRedirect.toHostname !== hostname ||
    !GRUMPHYA_HOSTNAMES.has(requestedHostname) ||
    !GRUMPHYA_HOSTNAMES.has(hostname)
  )) throw new Error("invalid_scan_redirect_context");
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
    ((targetHostname: string, port: number) =>
      createEgressAuthorizedLookup(
        targetHostname,
        port,
        createEgressDestinationAuthorizer(targetHostname),
      ));
  const requestFactory = dependencies.requestFactory ?? defaultHttpsRequest;
  const timeoutMs = input.timeoutMs ?? REQUEST_TIMEOUT_MS;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > REQUEST_TIMEOUT_MS) {
    throw new PinnedTransportError("request_timeout", 0, 0);
  }
  const deadline = Date.now() + timeoutMs;
  let currentPath = input.path;
  let currentHostname = hostname;
  const seenTargets = new Set([`${requestedHostname}${input.path}`, `${hostname}${input.path}`]);
  const redirectHops: Array<{ statusCode: number; from: string; to: string }> = input.initialRedirect
    ? [{ statusCode: input.initialRedirect.statusCode, from: input.initialRedirect.fromHostname, to: input.initialRedirect.toHostname }]
    : [];
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
        hostname: currentHostname,
        path: currentPath,
        method: input.method,
        signal: input.signal,
        timeoutMs: remainingMs,
        lookup: lookupFactory(currentHostname, HTTPS_PORT),
        requestFactory,
        ca: dependencies.ca,
        inspectPage: input.inspectPage === true,
        capturePublicPolicyLinks: input.capturePublicPolicyLinks === true,
        tlsVersion: input.tlsVersion,
        allowUntrustedCertificate: input.allowUntrustedCertificate === true,
      });
    } catch (error) {
      throw includeTransportMetrics(error, requestsCount, bytesCount, "https_request_failed");
    }
    requestsCount += 1;
    bytesCount += result.bytesCount;

    const isCrossHostnameRedirect = REDIRECT_STATUS_CODES.has(result.statusCode) &&
      isCrossHostnameLocation(result.location, currentHostname, currentPath);
    if (
      !REDIRECT_STATUS_CODES.has(result.statusCode) ||
      (isCrossHostnameRedirect && input.allowGrumphyaAliasRedirects !== true)
    ) {
      return {
        statusCode: result.statusCode,
        finalHostname: currentHostname,
        finalPath: currentPath,
        finalScheme: "https",
        redirectCount,
        remoteAddress: result.remoteAddress,
        tlsAuthorized: result.tlsAuthorized,
        tlsProtocol: result.tlsProtocol,
        securityHeaders: result.securityHeaders,
        ...(result.passivePageSignals
          ? { passivePageSignals: result.passivePageSignals }
          : {}),
        ...(result.publicPolicyPageInspectable === undefined
          ? {}
          : { publicPolicyPageInspectable: result.publicPolicyPageInspectable }),
        ...(result.publicPolicyLinks === undefined
          ? {}
          : { publicPolicyLinks: result.publicPolicyLinks }),
        requestsCount,
        bytesCount,
        redirectStatusCode: getGrumphyaHostnameChange(redirectHops)?.statusCode ?? null,
        redirectFromHostname: getGrumphyaHostnameChange(redirectHops)?.from ?? null,
        redirectToHostname: getGrumphyaHostnameChange(redirectHops)?.to ?? null,
        canonicalHostname: getCanonicalHostname(requestedHostname, currentHostname, redirectHops),
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
      const target = validateRedirect(
        result.location,
        currentHostname,
        currentPath,
        allowedPaths,
        hostname,
        input.allowGrumphyaAliasRedirects === true,
      );
      const targetKey = `${target.hostname}${target.path}`;
      if (seenTargets.has(targetKey)) {
        throw new Error("redirect_loop_detected");
      }
      seenTargets.add(targetKey);
      redirectHops.push({ statusCode: result.statusCode, from: currentHostname, to: target.hostname });
      currentHostname = target.hostname;
      currentPath = target.path;
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
  inspectPage: boolean;
  capturePublicPolicyLinks: boolean;
  tlsVersion: PinnedHttpsRequest["tlsVersion"];
  allowUntrustedCertificate: boolean;
};

type MakeRequestResult = {
  statusCode: number;
  location: string | undefined;
  remoteAddress: string | undefined;
  tlsAuthorized: boolean;
  tlsProtocol: "TLSv1" | "TLSv1.1" | "TLSv1.2" | "TLSv1.3" | undefined;
  securityHeaders: SecurityHeaderEvidence | null;
  bytesCount: number;
  passivePageSignals?: ReturnType<typeof inspectPassivePageSignals>;
  publicPolicyPageInspectable?: boolean;
  publicPolicyLinks?: PublicPolicyLink[];
};

function makeRequest(input: MakeRequestInput): Promise<MakeRequestResult> {
  return new Promise((resolve, reject) => {
    let settled = false;
    let receivedBytes = 0;
    const responseTimeStartedAt = Date.now();
    let htmlChunks: Buffer[] = [];
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
      rejectUnauthorized: !input.allowUntrustedCertificate,
      ...(input.tlsVersion
        ? {
            minVersion: input.tlsVersion,
            maxVersion: input.tlsVersion,
            ...(input.tlsVersion === "TLSv1" || input.tlsVersion === "TLSv1.1"
              ? { ciphers: "DEFAULT:@SECLEVEL=0" }
              : {}),
          }
        : {}),
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
        const contentType = getSingleHeader(response, "content-type") ?? "";
        const isHtml = /^text\/html(?:\s*;|$)/iu.test(contentType);
        const setCookieHeaders = getSetCookieHeaders(response);
        response.on("data", (chunk: Buffer | string) => {
          receivedBytes += Buffer.byteLength(chunk);
          if ((input.inspectPage || input.capturePublicPolicyLinks) && input.method === "GET" && isHtml) {
            htmlChunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
          }
          const responseByteLimit = input.capturePublicPolicyLinks ? 256 * 1024 : MAX_RESPONSE_BYTES;
          if (receivedBytes > responseByteLimit) {
            response.destroy();
            request?.destroy();
            finishWithError("response_size_limit_exceeded");
          }
        });
        response.once("error", (error) => finishWithError(sanitizeRequestError(error)));
        response.once("end", () => {
          if (settled) return;
          settled = true;
          if (timeoutHolder.timer !== undefined) {
            clearTimeout(timeoutHolder.timer);
          }
          input.signal.removeEventListener("abort", abortRequest);
          let passivePageSignals: ReturnType<typeof inspectPassivePageSignals> | undefined;
          let publicPolicyPageInspectable: boolean | undefined;
          let publicPolicyLinks: PublicPolicyLink[] | undefined;
          if ((input.inspectPage || input.capturePublicPolicyLinks) && input.method === "GET") {
            const html = Buffer.concat(htmlChunks).toString("utf8");
            if (input.inspectPage) {
              const pageInput: PassivePageSignalInput = {
                hostname: input.hostname,
                html,
                setCookieHeaders,
                responseTimeMs: Math.max(0, Date.now() - responseTimeStartedAt),
                responseBytes: receivedBytes,
                complete: true,
              };
              passivePageSignals = inspectPassivePageSignals(pageInput);
            }
            if (input.capturePublicPolicyLinks) {
              publicPolicyPageInspectable = isHtml;
              publicPolicyLinks = isHtml
                ? extractPublicPolicyLinks(input.hostname, html)
                : [];
            }
            htmlChunks = [];
          }
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
            ...(passivePageSignals ? { passivePageSignals } : {}),
            ...(publicPolicyPageInspectable === undefined
              ? {}
              : { publicPolicyPageInspectable }),
            ...(publicPolicyLinks === undefined ? {} : { publicPolicyLinks }),
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
): "TLSv1" | "TLSv1.1" | "TLSv1.2" | "TLSv1.3" | undefined {
  if (!(socket instanceof TLSSocket)) return undefined;
  const protocol = socket.getProtocol();
  if (
    protocol === "TLSv1" || protocol === "TLSv1.1" ||
    protocol === "TLSv1.2" || protocol === "TLSv1.3"
  ) return protocol;
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
  requestedHostname: string,
  allowGrumphyaAliasRedirects: boolean,
): { hostname: string; path: string } {
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
    !isAllowedRedirectHostname(requestedHostname, target.hostname, allowGrumphyaAliasRedirects) ||
    (target.port !== "" && target.port !== String(HTTPS_PORT)) ||
    target.username !== "" ||
    target.password !== "" ||
    target.hash !== ""
  ) {
    throw new Error("redirect_origin_not_allowlisted");
  }
  const path = `${target.pathname}${target.search}`;
  validatePath(path, allowedPaths, "redirect_path_not_allowlisted");
  return { hostname: target.hostname, path };
}

function isAllowedRedirectHostname(
  requestedHostname: string,
  targetHostname: string,
  allowGrumphyaAliasRedirects: boolean,
): boolean {
  return targetHostname === requestedHostname ||
    (allowGrumphyaAliasRedirects && GRUMPHYA_HOSTNAMES.has(requestedHostname) && GRUMPHYA_HOSTNAMES.has(targetHostname));
}

function isCrossHostnameLocation(location: string | undefined, hostname: string, currentPath: string): boolean {
  if (!location || location.length > 2_048) return false;
  try {
    return new URL(location, `https://${hostname}${currentPath}`).hostname !== hostname;
  } catch {
    return false;
  }
}

export function getCanonicalHostname(
  requestedHostname: string,
  finalHostname: string,
  hops: readonly { statusCode: number; from: string; to: string }[],
): string | null {
  if (!GRUMPHYA_HOSTNAMES.has(requestedHostname) || !GRUMPHYA_HOSTNAMES.has(finalHostname)) return null;
  if (requestedHostname === finalHostname || hops.length === 0) return null;
  let expectedFrom = requestedHostname;
  for (const hop of hops) {
    if (!REDIRECT_STATUS_CODES.has(hop.statusCode) || hop.from !== expectedFrom) return null;
    expectedFrom = hop.to;
  }
  if (expectedFrom !== finalHostname) return null;
  const hostnameChanges = hops.filter((hop) => hop.from !== hop.to);
  if (hostnameChanges.length === 0 || hostnameChanges.some((hop) =>
    !PERMANENT_REDIRECT_STATUS_CODES.has(hop.statusCode) ||
    !GRUMPHYA_HOSTNAMES.has(hop.from) ||
    !GRUMPHYA_HOSTNAMES.has(hop.to),
  )) return null;
  return hostnameChanges.at(-1)?.to === finalHostname ? finalHostname : null;
}

function getGrumphyaHostnameChange(
  hops: readonly { statusCode: number; from: string; to: string }[],
): { statusCode: number; from: string; to: string } | null {
  const changes = hops.filter((hop) => hop.from !== hop.to);
  if (changes.length !== 1 || changes.some((hop) =>
    !GRUMPHYA_HOSTNAMES.has(hop.from) || !GRUMPHYA_HOSTNAMES.has(hop.to),
  )) return null;
  return changes[0] ?? null;
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

function getSetCookieHeaders(response: IncomingMessage): string[] {
  const value = response.headers["set-cookie"];
  if (typeof value === "string") return [value];
  if (Array.isArray(value)) return value.filter((entry): entry is string => typeof entry === "string");
  return [];
}

function sanitizeRequestError(error: Error): string {
  return safeTransportErrorCode(error, "https_request_failed");
}
