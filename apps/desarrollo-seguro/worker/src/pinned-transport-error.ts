export type PinnedTransportErrorCode =
  | "dns_resolution_failed"
  | "connection_failed"
  | "broker_failed"
  | "request_aborted"
  | "request_timeout"
  | "response_size_limit_exceeded"
  | "https_request_failed"
  | "http_request_failed"
  | "invalid_http_response"
  | "redirect_limit_exceeded"
  | "redirect_origin_not_allowlisted"
  | "redirect_path_not_allowlisted"
  | "tls_certificate_invalid"
  | "tls_handshake_failed"
  | "transport_failed";

export class PinnedTransportError extends Error {
  constructor(
    readonly code: PinnedTransportErrorCode,
    readonly requestsCount: number,
    readonly bytesCount: number,
  ) {
    super(code);
    this.name = "PinnedTransportError";
  }
}

const ERROR_CODES = new Set<PinnedTransportErrorCode>([
  "dns_resolution_failed",
  "connection_failed",
  "broker_failed",
  "request_aborted",
  "request_timeout",
  "response_size_limit_exceeded",
  "https_request_failed",
  "http_request_failed",
  "invalid_http_response",
  "redirect_limit_exceeded",
  "redirect_origin_not_allowlisted",
  "redirect_path_not_allowlisted",
  "tls_certificate_invalid",
  "tls_handshake_failed",
  "transport_failed",
]);

const CERTIFICATE_ERROR_CODES = new Set([
  "CERT_HAS_EXPIRED",
  "CERT_NOT_YET_VALID",
  "CERT_REVOKED",
  "CERT_UNTRUSTED",
  "DEPTH_ZERO_SELF_SIGNED_CERT",
  "ERR_TLS_CERT_ALTNAME_INVALID",
  "SELF_SIGNED_CERT_IN_CHAIN",
  "UNABLE_TO_GET_ISSUER_CERT",
  "UNABLE_TO_GET_ISSUER_CERT_LOCALLY",
  "UNABLE_TO_VERIFY_LEAF_SIGNATURE",
]);

export function safeTransportErrorCode(
  error: unknown,
  fallbackCode: PinnedTransportErrorCode,
): PinnedTransportErrorCode {
  if (error instanceof PinnedTransportError) return error.code;
  if (typeof error === "string" && ERROR_CODES.has(error as PinnedTransportErrorCode)) {
    return error as PinnedTransportErrorCode;
  }
  if (error instanceof Error) {
    const code = getErrorCode(error);
    if (code === "EHOSTUNREACH" || code === "ENOTFOUND" || code === "EAI_AGAIN") {
      return "dns_resolution_failed";
    }
    if (["ECONNREFUSED", "ECONNRESET", "ETIMEDOUT", "EHOSTUNREACH"].includes(code ?? "")) {
      return "connection_failed";
    }
    if (code && CERTIFICATE_ERROR_CODES.has(code)) return "tls_certificate_invalid";
    if (code?.startsWith("ERR_SSL_") || code?.startsWith("ERR_TLS_")) {
      return "tls_handshake_failed";
    }
  }
  if (
    error instanceof Error &&
    ERROR_CODES.has(error.message as PinnedTransportErrorCode)
  ) {
    return error.message as PinnedTransportErrorCode;
  }
  return fallbackCode;
}

function getErrorCode(error: Error): string | undefined {
  if (!("code" in error)) return undefined;
  const code: unknown = error.code;
  return typeof code === "string" ? code : undefined;
}

export function includeTransportMetrics(
  error: unknown,
  priorRequestsCount: number,
  priorBytesCount: number,
  fallbackCode: PinnedTransportErrorCode,
): PinnedTransportError {
  const transportError = error instanceof PinnedTransportError ? error : null;
  return new PinnedTransportError(
    safeTransportErrorCode(error, fallbackCode),
    priorRequestsCount + (transportError?.requestsCount ?? 0),
    priorBytesCount + (transportError?.bytesCount ?? 0),
  );
}
