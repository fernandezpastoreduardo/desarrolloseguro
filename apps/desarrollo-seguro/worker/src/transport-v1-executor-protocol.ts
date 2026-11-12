import { normalizeHostname, SCAN_FAILURE_CODES, type ScanFailureCode } from "@desarrolloseguro/core";
import type { ScanCheck, ScanRunInput } from "@desarrolloseguro/persistence";
import type { ScanProfileVersion } from "./transport-v1-executor.js";

export const TRANSPORT_V1_EXECUTOR_PROTOCOL_VERSION = 1;
export const MAX_EXECUTOR_REQUEST_BYTES = 4 * 1024;
export const MAX_EXECUTOR_RESPONSE_BYTES = 256 * 1024;
export const MAX_TRANSPORT_REQUESTS_PER_SCAN = 24;
export const MAX_TRANSPORT_BYTES_PER_SCAN = 2 * 1024 * 1024;
const MAX_TRANSPORT_DURATION_MS = 35_000;

export type TransportV1ExecutorRequest = {
  protocolVersion: 1;
  requestId: string;
  hostname: string;
  profileVersion: ScanProfileVersion;
};

export type TransportV1ExecutorResponse =
  | {
      protocolVersion: 1;
      requestId: string;
      result: Omit<
        ScanRunInput,
        "jobId" | "leaseToken" | "hostname" | "profileVersion"
      >;
    }
  | {
      protocolVersion: 1;
      requestId: string;
      errorCode: "request_invalid" | ScanFailureCode;
    };

export function parseTransportV1ExecutorRequest(
  value: unknown,
): TransportV1ExecutorRequest {
  if (
    !isRecord(value) ||
    Reflect.ownKeys(value).length !== 4 ||
    !Object.hasOwn(value, "protocolVersion") ||
    !Object.hasOwn(value, "requestId") ||
    !Object.hasOwn(value, "hostname") ||
    !Object.hasOwn(value, "profileVersion") ||
    value.protocolVersion !== 1
  ) {
    throw new Error("executor_request_invalid");
  }
  if (
    typeof value.requestId !== "string" ||
    !/^[0-9a-f-]{36}$/iu.test(value.requestId) ||
    !isScanProfileVersion(value.profileVersion)
  ) {
    throw new Error("executor_request_invalid");
  }
  let hostname: string;
  try {
    hostname = normalizeHostname(value.hostname);
  } catch {
    throw new Error("executor_request_invalid");
  }
  return {
    protocolVersion: 1,
    requestId: value.requestId,
    hostname,
    profileVersion: value.profileVersion,
  };
}

export function parseTransportV1ExecutorResponse(
  value: unknown,
  expectedRequestId: string,
  profileVersion: ScanProfileVersion = "transport-v1",
): TransportV1ExecutorResponse {
  if (
    !isRecord(value) ||
    value.protocolVersion !== TRANSPORT_V1_EXECUTOR_PROTOCOL_VERSION ||
    value.requestId !== expectedRequestId
  ) {
    throw new Error("executor_response_invalid");
  }
  if (
    value.errorCode === "request_invalid" ||
    isScanFailureCode(value.errorCode)
  ) {
    return {
      protocolVersion: 1,
      requestId: expectedRequestId,
      errorCode: value.errorCode,
    };
  }
  return {
    protocolVersion: 1,
    requestId: expectedRequestId,
    result: parseExecutorResult(value.result, profileVersion),
  };
}

function isScanFailureCode(value: unknown): value is ScanFailureCode {
  return typeof value === "string" && SCAN_FAILURE_CODES.includes(value as ScanFailureCode);
}

function parseExecutorResult(
  value: unknown,
  profileVersion: ScanProfileVersion,
): Omit<ScanRunInput, "jobId" | "leaseToken" | "hostname" | "profileVersion"> {
  if (!isRecord(value)) throw new Error("executor_result_invalid");
  const startedAt = parseDate(value.startedAt);
  const completedAt = parseDate(value.completedAt);
  if (
    typeof value.scannerVersion !== "string" ||
    value.scannerVersion !== getScannerVersion(profileVersion) ||
    !isVerdict(value.verdict) ||
    !Array.isArray(value.scope) ||
    value.scope.length !== 1 ||
    value.scope[0] !== "/" ||
    !Array.isArray(value.checks) ||
    value.checks.length !== getExpectedCheckCount(profileVersion) ||
    !isRecord(value.metrics)
  ) {
    throw new Error("executor_result_invalid");
  }
  if (completedAt.getTime() < startedAt.getTime()) {
    throw new Error("executor_result_invalid");
  }
  return {
    scannerVersion: value.scannerVersion,
    startedAt,
    completedAt,
    verdict: value.verdict,
    scope: value.scope,
    checks: value.checks.map(parseCheck),
    metrics: {
      requestsCount: parseCount(value.metrics.requestsCount, MAX_TRANSPORT_REQUESTS_PER_SCAN),
      bytesCount: parseCount(value.metrics.bytesCount, MAX_TRANSPORT_BYTES_PER_SCAN),
      durationMs: parseCount(value.metrics.durationMs, MAX_TRANSPORT_DURATION_MS),
      pagesCount: parseCount(value.metrics.pagesCount, 0),
    },
  };
}

function isScanProfileVersion(value: unknown): value is ScanProfileVersion {
  return value === "transport-v1" || value === "domain-v1";
}

function getScannerVersion(profileVersion: ScanProfileVersion): string {
  return profileVersion === "domain-v1"
    ? "domain-v1-network-adapter-1"
    : "transport-v1-network-adapter-1";
}

function getExpectedCheckCount(profileVersion: ScanProfileVersion): number {
  return profileVersion === "domain-v1" ? 6 : 5;
}

function parseCheck(value: unknown): ScanCheck {
  if (
    !isRecord(value) ||
    typeof value.controlId !== "string" ||
    !isCheckStatus(value.status) ||
    value.required !== true ||
    typeof value.severity !== "string" ||
    typeof value.targetPath !== "string" ||
    typeof value.method !== "string" ||
    typeof value.summary !== "string" ||
    typeof value.limitation !== "string" ||
    !isRecord(value.evidence)
  ) {
    throw new Error("executor_result_invalid");
  }
  return {
    controlId: value.controlId,
    status: value.status,
    required: true,
    severity: value.severity,
    observedAt: parseDate(value.observedAt),
    targetPath: value.targetPath,
    method: value.method,
    summary: value.summary,
    limitation: value.limitation,
    evidence: value.evidence,
  };
}

function parseDate(value: unknown): Date {
  if (typeof value !== "string") throw new Error("executor_result_invalid");
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) throw new Error("executor_result_invalid");
  return date;
}

function parseCount(value: unknown, maximum: number): number {
  if (
    typeof value !== "number" ||
    !Number.isSafeInteger(value) ||
    value < 0 ||
    value > maximum
  ) {
    throw new Error("executor_result_invalid");
  }
  return value;
}

function isVerdict(value: unknown): value is ScanRunInput["verdict"] {
  return value === "pass" || value === "fail" || value === "inconclusive";
}

function isCheckStatus(value: unknown): value is ScanCheck["status"] {
  return value === "pass" || value === "fail" || value === "unknown" || value === "not_applicable";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype
  );
}
