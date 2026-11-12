export type PublicEvidenceValue = string | number | boolean;

const PUBLIC_EVIDENCE_FIELDS: Readonly<Record<string, readonly string[]>> = {
  "DS-DNS-01": ["addressClass", "aRecordCount", "aaaaRecordCount"],
  "DS-TLS-01": ["protocol", "certificateValid", "hostnameMatches"],
  "DS-TLS-02": ["tls10Accepted", "tls11Accepted", "tls12Accepted", "tls13Accepted", "tls10ProbeError", "tls11ProbeError", "tls12ProbeError", "tls13ProbeError"],
  "DS-HTTP-01": ["statusCode", "redirectedToHttps", "finalScheme"],
  "DS-HDR-01": ["finalScheme", "hsts", "nosniff", "frameProtection", "referrerPolicy", "csp"],
  "DS-PRIV-05": ["inspected", "cookieCount", "insecureCookieCount", "catalogMatchCount", "consentPromptDetected"],
  "DS-PRIV-06": ["inspected", "thirdPartyResourceReferences", "knownTrackingResourceReferences"],
  "DS-QUAL-02": ["inspected", "responseTimeMs", "responseBytes"],
};

export const TLS_PROBE_ERROR_CODES = [
  "dns_resolution_failed", "connection_failed", "broker_failed", "request_aborted",
  "request_timeout", "response_size_limit_exceeded", "https_request_failed",
  "http_request_failed", "invalid_http_response", "redirect_limit_exceeded",
  "redirect_origin_not_allowlisted", "redirect_path_not_allowlisted",
  "tls_certificate_invalid", "tls_handshake_failed", "transport_failed",
] as const;
const PUBLIC_EVIDENCE_ENUMS: Readonly<Record<string, readonly string[]>> = {
  addressClass: ["public", "private", "reserved", "unresolved"],
  protocol: ["TLSv1.2", "TLSv1.3"],
  finalScheme: ["http", "https"],
  tls10ProbeError: TLS_PROBE_ERROR_CODES,
  tls11ProbeError: TLS_PROBE_ERROR_CODES,
  tls12ProbeError: TLS_PROBE_ERROR_CODES,
  tls13ProbeError: TLS_PROBE_ERROR_CODES,
};
const PUBLIC_EVIDENCE_BOOLEANS = new Set([
  "certificateValid", "hostnameMatches", "tls10Accepted", "tls11Accepted",
  "tls12Accepted", "tls13Accepted", "redirectedToHttps", "hsts", "nosniff",
  "frameProtection", "referrerPolicy", "csp", "inspected", "consentPromptDetected",
]);

export function projectPublicEvidence(
  controlId: string,
  evidence: unknown,
): Record<string, PublicEvidenceValue> {
  if (!isRecord(evidence)) return {};
  const projected: Record<string, PublicEvidenceValue> = {};
  for (const key of PUBLIC_EVIDENCE_FIELDS[controlId] ?? []) {
    const value = evidence[key];
    if (typeof value === "boolean" && PUBLIC_EVIDENCE_BOOLEANS.has(key)) {
      projected[key] = value;
      continue;
    }
    if (typeof value !== "number" || !Number.isSafeInteger(value)) {
      if (typeof value === "string" && PUBLIC_EVIDENCE_ENUMS[key]?.includes(value)) {
        projected[key] = value;
      }
      continue;
    }
    if (key === "statusCode" && value >= 100 && value <= 599) {
      projected[key] = value;
    } else if (key !== "statusCode" && value >= 0 && value <= 1_000_000) {
      projected[key] = value;
    }
  }
  return projected;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
