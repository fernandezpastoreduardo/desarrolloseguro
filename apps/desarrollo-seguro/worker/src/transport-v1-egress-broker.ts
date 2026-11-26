import { normalizeHostname } from "@desarrolloseguro/core";
import type {
  TransportV1Evidence,
  TransportV1ObservationSource,
  TransportV1ProbeResult,
} from "./transport-v1-executor.js";
import type { PinnedTransportErrorCode } from "./pinned-transport-error.js";
import { getTransportBudget } from "./transport-budget.js";
import {
  MAX_TRANSPORT_EVIDENCE_FIELDS,
  MAX_TRANSPORT_PUBLIC_POLICY_DECLARATIONS_CHARS,
  MAX_TRANSPORT_PUBLIC_POLICY_DOCUMENTS_CHARS,
} from "./transport-v1-evidence-contract.js";

const MAX_BROKER_OPERATIONS = 5;
const MAX_CONCURRENT_BROKER_OPERATIONS = 2;
const PROBE_OPERATIONS = ["dns", "tls", "http-head", "http-get", "headers"] as const;
const FORBIDDEN_EVIDENCE_KEYS = new Set(["__proto__", "constructor", "prototype"]);
const SAFE_PROBE_ERROR_CODES = new Set<PinnedTransportErrorCode>([
  "dns_resolution_failed", "connection_failed", "broker_failed",
  "request_aborted", "request_timeout", "response_size_limit_exceeded",
  "https_request_failed", "http_request_failed", "invalid_http_response",
  "redirect_limit_exceeded", "redirect_origin_not_allowlisted",
  "redirect_path_not_allowlisted", "tls_certificate_invalid",
  "tls_handshake_failed", "transport_failed",
]);

export type TransportV1ProbeOperation = (typeof PROBE_OPERATIONS)[number];

export type TransportV1BrokerRequest = {
  protocolVersion: 1;
  requestId: string;
  hostname: string;
  operation: TransportV1ProbeOperation;
  targetPath: string;
};

export type TransportV1BrokerResponse = {
  protocolVersion: 1;
  requestId: string;
  result: TransportV1ProbeResult;
};

export type TransportV1EgressBroker = (
  request: unknown,
  signal: AbortSignal,
) => Promise<TransportV1BrokerResponse>;

/**
 * Applies a per-job, operation-level contract around the network observer.
 * It is an application policy boundary, not a firewall or process boundary.
 */
export function createTransportV1EgressBroker(
  jobHostnameInput: unknown,
  source: TransportV1ObservationSource,
  profileVersion = "transport-v1",
  targetPath = "/",
): TransportV1EgressBroker {
  const jobHostname = normalizeHostname(jobHostnameInput);
  const budget = getTransportBudget(profileVersion);
  const startedOperations = new Set<TransportV1ProbeOperation>();
  const usedRequestIds = new Set<string>();
  let activeOperations = 0;
  let totalRequests = 0;
  let totalBytes = 0;
  let budgetExceeded = false;

  return async (input, signal) => {
    const request = parseBrokerRequest(input, jobHostname);
    if (
      request.targetPath !== targetPath ||
      startedOperations.size >= MAX_BROKER_OPERATIONS ||
      startedOperations.has(request.operation) ||
      usedRequestIds.has(request.requestId) ||
      activeOperations >= MAX_CONCURRENT_BROKER_OPERATIONS ||
      budgetExceeded
    ) {
      throw createBrokerRequestError();
    }

    startedOperations.add(request.operation);
    usedRequestIds.add(request.requestId);
    activeOperations += 1;
    try {
      const result = await observeOperation(
        source,
        request.operation,
        jobHostname,
        signal,
        request.targetPath === "/" && profileVersion !== "domain-v5" ? undefined : request.targetPath,
      );
      if (signal.aborted) {
        return createBrokerResponse(request.requestId, emptyProbeResult());
      }
      const validatedResult = validateProbeResult(result, budget);
      totalRequests += validatedResult.requestsCount;
      totalBytes += validatedResult.bytesCount;
      if (
        totalRequests > budget.maxRequests ||
        totalBytes > budget.maxBytes
      ) {
        budgetExceeded = true;
        return createBrokerResponse(request.requestId, emptyProbeResult());
      }
      return createBrokerResponse(request.requestId, validatedResult);
    } catch {
      return createBrokerResponse(request.requestId, {
        ...emptyProbeResult(),
        errorCode: "broker_failed",
      });
    } finally {
      activeOperations -= 1;
    }
  };
}

function parseBrokerRequest(
  input: unknown,
  jobHostname: string,
): TransportV1BrokerRequest {
  if (
    typeof input !== "object" ||
    input === null ||
    Array.isArray(input) ||
    Object.getPrototypeOf(input) !== Object.prototype
  ) {
    throw createBrokerRequestError();
  }

  const candidate = input as Record<string, unknown>;
  if (
    Reflect.ownKeys(candidate).length !== (Object.hasOwn(candidate, "targetPath") ? 5 : 4) ||
    !Object.hasOwn(candidate, "protocolVersion") ||
    !Object.hasOwn(candidate, "requestId") ||
    !Object.hasOwn(candidate, "hostname") ||
    !Object.hasOwn(candidate, "operation") ||
    candidate.protocolVersion !== 1 ||
    typeof candidate.requestId !== "string" ||
    !/^[0-9a-f-]{36}$/iu.test(candidate.requestId) ||
    typeof candidate.operation !== "string" ||
    !isProbeOperation(candidate.operation) ||
    (Object.hasOwn(candidate, "targetPath") && !isSafeTargetPath(candidate.targetPath))
  ) {
    throw createBrokerRequestError();
  }

  let hostname: string;
  try {
    hostname = normalizeHostname(candidate.hostname);
  } catch {
    throw createBrokerRequestError();
  }
  if (hostname !== jobHostname) {
    throw createBrokerRequestError();
  }

  return {
    protocolVersion: 1,
    requestId: candidate.requestId,
    hostname,
    operation: candidate.operation,
    targetPath: typeof candidate.targetPath === "string" ? candidate.targetPath : "/",
  };
}

async function observeOperation(
  source: TransportV1ObservationSource,
  operation: TransportV1ProbeOperation,
  hostname: string,
  signal: AbortSignal,
  targetPath?: string,
): Promise<TransportV1ProbeResult> {
  switch (operation) {
    case "dns":
      return targetPath === undefined ? source.observeDns(hostname, signal) : source.observeDns(hostname, signal, targetPath);
    case "tls":
      return targetPath === undefined ? source.observeTls(hostname, signal) : source.observeTls(hostname, signal, targetPath);
    case "http-head":
      return targetPath === undefined ? source.observeHttp(hostname, "HEAD", signal) : source.observeHttp(hostname, "HEAD", signal, targetPath);
    case "http-get":
      return targetPath === undefined ? source.observeHttp(hostname, "GET", signal) : source.observeHttp(hostname, "GET", signal, targetPath);
    case "headers":
      return targetPath === undefined ? source.observeHeaders(hostname, signal) : source.observeHeaders(hostname, signal, targetPath);
  }
}

function isSafeTargetPath(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= 2_048 &&
    value.startsWith("/") && !value.startsWith("//") && !hasUnsafeTargetPathCharacters(value);
}

function hasUnsafeTargetPathCharacters(value: string): boolean {
  return [...value].some((character) => {
    const code = character.codePointAt(0) ?? 0;
    return character === "#" || character === "\\" || code < 0x20 || code === 0x7f;
  });
}

function validateProbeResult(
  input: unknown,
  budget: ReturnType<typeof getTransportBudget>,
): TransportV1ProbeResult {
  if (
    typeof input !== "object" ||
    input === null ||
    Array.isArray(input) ||
    Object.getPrototypeOf(input) !== Object.prototype
  ) {
    throw createBrokerRequestError();
  }

  const candidate = input as Record<string, unknown>;
  if (
    (Reflect.ownKeys(candidate).length !== 3 && Reflect.ownKeys(candidate).length !== 4) ||
    !Object.hasOwn(candidate, "evidence") ||
    !Object.hasOwn(candidate, "requestsCount") ||
    !Object.hasOwn(candidate, "bytesCount") ||
    !Number.isSafeInteger(candidate.requestsCount) ||
    (candidate.requestsCount as number) < 0 ||
    (candidate.requestsCount as number) > budget.maxRequests ||
    !Number.isSafeInteger(candidate.bytesCount) ||
    (candidate.bytesCount as number) < 0 ||
    (candidate.bytesCount as number) > budget.maxBytes ||
    (Object.hasOwn(candidate, "errorCode") &&
      (typeof candidate.errorCode !== "string" ||
        !SAFE_PROBE_ERROR_CODES.has(candidate.errorCode as PinnedTransportErrorCode)))
  ) {
    throw createBrokerRequestError();
  }

  return {
    evidence: validateEvidence(candidate.evidence),
    requestsCount: candidate.requestsCount as number,
    bytesCount: candidate.bytesCount as number,
    ...(Object.hasOwn(candidate, "errorCode")
      ? { errorCode: candidate.errorCode as PinnedTransportErrorCode }
      : {}),
  };
}

function validateEvidence(input: unknown): TransportV1Evidence {
  if (
    typeof input !== "object" ||
    input === null ||
    Array.isArray(input) ||
    Object.getPrototypeOf(input) !== Object.prototype
  ) {
    throw createBrokerRequestError();
  }
  const candidate = input as Record<string, unknown>;
  if (Reflect.ownKeys(candidate).length > MAX_TRANSPORT_EVIDENCE_FIELDS) {
    throw createBrokerRequestError();
  }

  const evidence: TransportV1Evidence = {};
  for (const [key, value] of Object.entries(candidate)) {
    if (
      key.length > 64 ||
      FORBIDDEN_EVIDENCE_KEYS.has(key) ||
      (typeof value !== "boolean" &&
        (typeof value !== "number" || !Number.isFinite(value)) &&
        typeof value !== "string") ||
      (typeof value === "string" &&
        value.length > (key === "publicPolicyDeclaredServices" ? MAX_TRANSPORT_PUBLIC_POLICY_DECLARATIONS_CHARS
          : key === "publicPolicyDiscoveredDocuments" ? MAX_TRANSPORT_PUBLIC_POLICY_DOCUMENTS_CHARS
            : 256))
    ) {
      throw createBrokerRequestError();
    }
    evidence[key] = value;
  }
  return evidence;
}

function isProbeOperation(value: string): value is TransportV1ProbeOperation {
  return PROBE_OPERATIONS.some((operation) => operation === value);
}

function createBrokerResponse(
  requestId: string,
  result: TransportV1ProbeResult,
): TransportV1BrokerResponse {
  return { protocolVersion: 1, requestId, result };
}

function emptyProbeResult(): TransportV1ProbeResult {
  return { evidence: {}, requestsCount: 0, bytesCount: 0 };
}

function createBrokerRequestError(): Error {
  return new Error("egress_broker_request_invalid");
}
