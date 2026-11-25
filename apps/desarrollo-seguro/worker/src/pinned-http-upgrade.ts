import { request as defaultHttpRequest } from "node:http";
import type { ClientRequest, IncomingMessage, RequestOptions } from "node:http";
import type { LookupFunction } from "node:net";
import {
  getCanonicalScanPaths,
  normalizeHostname,
} from "@desarrolloseguro/core";
import {
  createEgressAuthorizedLookup,
  createEgressDestinationAuthorizer,
} from "./egress-destination-policy.js";
import {
  requestPinnedHttps,
  type HttpsRequestFactory,
} from "./pinned-https-transport.js";
import {
  includeTransportMetrics,
  PinnedTransportError,
  safeTransportErrorCode,
} from "./pinned-transport-error.js";

const HTTP_PORT = 80;
const REQUEST_TIMEOUT_MS = 10_000;
const MAX_RESPONSE_BYTES = 64 * 1024;
const REDIRECT_STATUS_CODES = new Set([301, 302, 303, 307, 308]);

export type PinnedHttpUpgradeRequest = {
  hostname: string;
  path: string;
  method: "GET" | "HEAD";
  allowedPaths: readonly string[];
  signal: AbortSignal;
};

export type PinnedHttpUpgradeResult = {
  statusCode: number;
  finalPath: string;
  finalScheme: "http" | "https";
  redirectedToHttps: boolean;
  tlsAuthorized?: boolean;
  tlsProtocol?: "TLSv1" | "TLSv1.1" | "TLSv1.2" | "TLSv1.3";
  requestsCount: number;
  bytesCount: number;
  grumphyaRedirectEvidence?: {
    requestedHostname: string;
    finalHostname: string;
    redirectStatusCode: number | null;
    redirectFromHostname: string | null;
    redirectToHostname: string | null;
    canonicalHostname: string | null;
  };
};

export type HttpRequestFactory = (
  options: RequestOptions,
  callback: (response: IncomingMessage) => void,
) => ClientRequest;

export type PinnedHttpUpgradeDependencies = {
  lookupFactory?: (hostname: string, port: number) => LookupFunction;
  requestFactory?: HttpRequestFactory;
  httpsRequestFactory?: HttpsRequestFactory;
  httpsCa?: string;
};

export async function requestPinnedHttpUpgrade(
  input: PinnedHttpUpgradeRequest,
  dependencies: PinnedHttpUpgradeDependencies = {},
): Promise<PinnedHttpUpgradeResult> {
  const hostname = normalizeHostname(input.hostname);
  validateMethod(input.method);
  const allowedPaths = getCanonicalScanPaths(hostname).filter((path) =>
    input.allowedPaths.includes(path),
  );
  validatePath(input.path, allowedPaths);
  if (input.signal.aborted) throw new Error("request_aborted");

  const deadline = Date.now() + REQUEST_TIMEOUT_MS;
  const scopedSignal = createScopedSignal(input.signal, deadline);
  try {
    const lookupFactory =
      dependencies.lookupFactory ??
    ((targetHostname: string, port: number) =>
      createEgressAuthorizedLookup(
        targetHostname,
        port,
        createEgressDestinationAuthorizer(targetHostname),
      ));
    const httpResult = await makeHttpRequest({
      hostname,
      path: input.path,
      method: input.method,
      signal: scopedSignal.signal,
      timeoutMs: Math.max(1, deadline - Date.now()),
      lookup: lookupFactory(hostname, HTTP_PORT),
      requestFactory: dependencies.requestFactory ?? defaultHttpRequest,
    });
    const upgradedTarget = validateUpgradeLocation(
      httpResult.location,
      hostname,
      input.path,
      allowedPaths,
      httpResult.statusCode,
    );
    if (upgradedTarget === undefined) {
      return {
        statusCode: httpResult.statusCode,
        finalPath: input.path,
        finalScheme: "http",
        redirectedToHttps: false,
        requestsCount: httpResult.requestsCount,
        bytesCount: httpResult.bytesCount,
      };
    }

    const remainingMs = deadline - Date.now();
    if (remainingMs <= 0) {
      throw new PinnedTransportError(
        "request_timeout",
        httpResult.requestsCount,
        httpResult.bytesCount,
      );
    }
    let httpsResult: Awaited<ReturnType<typeof requestPinnedHttps>>;
    try {
      httpsResult = await requestPinnedHttps(
        {
          hostname: upgradedTarget.hostname,
          requestedHostname: hostname,
          allowCanonicalWwwRedirects: true,
          ...(upgradedTarget.hostname !== hostname ? {
            initialRedirect: {
              statusCode: httpResult.statusCode,
              fromHostname: hostname,
              toHostname: upgradedTarget.hostname,
            },
          } : {}),
          path: upgradedTarget.path,
          method: input.method,
          allowedPaths,
          signal: scopedSignal.signal,
        },
        {
          ca: dependencies.httpsCa,
          lookupFactory,
          requestFactory: dependencies.httpsRequestFactory,
        },
      );
    } catch (error) {
      throw includeTransportMetrics(
        error,
        httpResult.requestsCount,
        httpResult.bytesCount,
        "https_request_failed",
      );
    }
    return {
      statusCode: httpsResult.statusCode,
      finalPath: httpsResult.finalPath,
      finalScheme: "https",
      redirectedToHttps: true,
      tlsAuthorized: httpsResult.tlsAuthorized,
      tlsProtocol: httpsResult.tlsProtocol,
      requestsCount: httpResult.requestsCount + httpsResult.requestsCount,
      bytesCount: httpResult.bytesCount + httpsResult.bytesCount,
      ...(httpsResult.redirectFromHostname && (hostname === "grumphya.com" || hostname === "www.grumphya.com") ? {
        grumphyaRedirectEvidence: {
          requestedHostname: hostname,
          finalHostname: httpsResult.finalHostname,
          redirectStatusCode: httpsResult.redirectStatusCode,
          redirectFromHostname: httpsResult.redirectFromHostname,
          redirectToHostname: httpsResult.redirectToHostname,
          canonicalHostname: httpsResult.canonicalHostname,
        },
      } : {}),
    };
  } finally {
    scopedSignal.dispose();
  }
}

type HttpResult = {
  statusCode: number;
  location: string | undefined;
  requestsCount: number;
  bytesCount: number;
};

type MakeHttpRequestInput = {
  hostname: string;
  path: string;
  method: "GET" | "HEAD";
  signal: AbortSignal;
  timeoutMs: number;
  lookup: LookupFunction;
  requestFactory: HttpRequestFactory;
};

function makeHttpRequest(input: MakeHttpRequestInput): Promise<HttpResult> {
  return new Promise((resolve, reject) => {
    let settled = false;
    let receivedBytes = 0;
    let responseSocket: IncomingMessage["socket"] | undefined;
    let requestStarted = false;
    let request: ClientRequest | undefined;
    const timerHolder: { timer?: NodeJS.Timeout } = {};
    const finish = (error?: Error, result?: HttpResult) => {
      if (settled) return;
      settled = true;
      if (timerHolder.timer !== undefined) clearTimeout(timerHolder.timer);
      input.signal.removeEventListener("abort", abortRequest);
      if (error) {
        reject(
          new PinnedTransportError(
            safeTransportErrorCode(error, "http_request_failed"),
            requestStarted ? 1 : 0,
            getReceivedBytesCount(responseSocket ?? request?.socket, receivedBytes),
          ),
        );
      }
      else if (result) resolve(result);
      else reject(new Error("http_request_failed"));
    };
    const abortRequest = () => {
      request?.destroy();
      finish(new Error("request_aborted"));
    };
    const options: RequestOptions = {
      hostname: input.hostname,
      port: HTTP_PORT,
      protocol: "http:",
      path: input.path,
      method: input.method,
      agent: false,
      lookup: input.lookup,
      headers: {
        host: input.hostname,
        accept: "*/*",
        "accept-encoding": "identity",
        connection: "close",
      },
    };

    timerHolder.timer = setTimeout(() => {
      request?.destroy();
      finish(new Error("request_timeout"));
    }, input.timeoutMs);
    input.signal.addEventListener("abort", abortRequest, { once: true });
    if (input.signal.aborted) {
      abortRequest();
      return;
    }
    try {
      request = input.requestFactory(options, (response) => {
        responseSocket = response.socket;
        const statusCode = response.statusCode;
        if (statusCode === undefined) {
          response.resume();
          finish(new Error("invalid_http_response"));
          return;
        }
        const location = getSingleHeader(response, "location");
        response.on("data", (chunk: Buffer | string) => {
          receivedBytes += Buffer.byteLength(chunk);
          if (receivedBytes > MAX_RESPONSE_BYTES) {
            response.destroy();
            request?.destroy();
            finish(new Error("response_size_limit_exceeded"));
          }
        });
        response.once("error", () => finish(new Error("http_request_failed")));
        response.once("end", () =>
          finish(undefined, {
            statusCode,
            location,
            requestsCount: 1,
            bytesCount: getReceivedBytesCount(responseSocket, receivedBytes),
          }),
        );
        response.resume();
      });
    } catch {
      finish(new Error("http_request_failed"));
      return;
    }
    if (settled) return;
    const activeRequest = request;
    if (!activeRequest) {
      finish(new Error("http_request_failed"));
      return;
    }

    activeRequest.once("error", () => finish(new Error("http_request_failed")));
    if (input.signal.aborted) {
      abortRequest();
      return;
    }
    requestStarted = true;
    try {
      activeRequest.end();
    } catch {
      finish(new Error("http_request_failed"));
    }
  });
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

export function validateUpgradeLocation(
  location: string | undefined,
  hostname: string,
  currentPath: string,
  allowedPaths: readonly string[],
  statusCode: number,
): { hostname: string; path: string } | undefined {
  if (!REDIRECT_STATUS_CODES.has(statusCode) || !location || location.length > 2_048) {
    return undefined;
  }
  let target: URL;
  try {
    target = new URL(location, `http://${hostname}${currentPath}`);
  } catch {
    return undefined;
  }
  if (
    target.protocol !== "https:" ||
    (target.hostname !== hostname && !isWwwAliasPair(hostname, target.hostname)) ||
    (target.port !== "" && target.port !== "443") ||
    target.username !== "" ||
    target.password !== "" ||
    target.hash !== ""
  ) {
    return undefined;
  }
  const path = `${target.pathname}${target.search}`;
  return allowedPaths.includes(path) ? { hostname: target.hostname, path } : undefined;
}

function isWwwAliasPair(fromHostname: string, toHostname: string): boolean {
  return fromHostname !== toHostname &&
    (fromHostname === `www.${toHostname}` || toHostname === `www.${fromHostname}`);
}

function validatePath(path: string, allowedPaths: readonly string[]): void {
  if (!allowedPaths.includes(path)) throw new Error("request_path_not_allowlisted");
}

function validateMethod(method: string): void {
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

function createScopedSignal(parent: AbortSignal, deadline: number) {
  const controller = new AbortController();
  const abortFromParent = () => controller.abort();
  parent.addEventListener("abort", abortFromParent, { once: true });
  const timeout = setTimeout(() => controller.abort(), Math.max(1, deadline - Date.now()));
  if (parent.aborted) controller.abort();
  return {
    signal: controller.signal,
    dispose: () => {
      clearTimeout(timeout);
      parent.removeEventListener("abort", abortFromParent);
    },
  };
}
