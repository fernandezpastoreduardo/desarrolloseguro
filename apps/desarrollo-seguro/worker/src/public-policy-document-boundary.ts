import { normalizeHostname } from "@desarrolloseguro/core";
import type { ScanRunInput } from "@desarrolloseguro/persistence";

export type PublicPolicyDiscoveredDocument = {
  href: string;
  anchorText: string;
  kind: "privacy" | "cookies" | "terms" | "legal";
  documentRole: "audited_site_policy" | "provider_document";
  sourcePageUrl: string;
  fetchStatus: "not_fetched" | "fetched" | "unavailable" | "failed";
  sha256: string | null;
  failureCode?: PublicPolicyDocumentFailureCode;
  documentedFacts?: Array<{ factId: string; value: boolean; excerpt: string }>;
};

export type PublicPolicyDocumentFailureCode =
  | "auditor_error"
  | "budget_exhausted"
  | "cross_host_redirect"
  | "dns_failure"
  | "egress_denied"
  | "redirect_limit_exceeded"
  | "request_timeout"
  | "response_too_large"
  | "tls_failure"
  | "unsupported_content_type";

export type ScanExecutorResult = Omit<ScanRunInput, "jobId" | "leaseToken" | "hostname" | "profileVersion"> & {
  /** Ephemeral crawler output; worker cataloging consumes it before report persistence. */
  publicPolicyDiscoveredDocuments?: PublicPolicyDiscoveredDocument[];
};

const MAX_DOCUMENTS = 40;
const DOCUMENT_KEYS = ["href", "anchorText", "kind", "documentRole", "sourcePageUrl", "fetchStatus", "sha256", "failureCode", "documentedFacts"] as const;
const DOCUMENT_REQUIRED_KEYS = DOCUMENT_KEYS.slice(0, 7);
const FAILURE_CODES = new Set<PublicPolicyDocumentFailureCode>([
  "auditor_error", "budget_exhausted", "cross_host_redirect", "dns_failure", "egress_denied",
  "redirect_limit_exceeded", "request_timeout", "response_too_large", "tls_failure", "unsupported_content_type",
]);
const SENSITIVE_LABEL = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b|\b(?:sk|key|token)[-_][A-Z0-9_-]{12,}\b/iu;

export function parsePublicPolicyDiscoveredDocuments(value: unknown): PublicPolicyDiscoveredDocument[] | null {
  if (!Array.isArray(value) || value.length > MAX_DOCUMENTS) return null;
  const documents: PublicPolicyDiscoveredDocument[] = [];
  for (const candidate of value) {
    if (!isRecord(candidate) || Reflect.ownKeys(candidate).length < DOCUMENT_REQUIRED_KEYS.length ||
        Reflect.ownKeys(candidate).length > DOCUMENT_KEYS.length ||
        Reflect.ownKeys(candidate).some((key) => !DOCUMENT_KEYS.includes(String(key) as typeof DOCUMENT_KEYS[number])) ||
        typeof candidate.href !== "string" || !isCanonicalPublicHttpsUrl(candidate.href) ||
        !["audited_site_policy", "provider_document"].includes(String(candidate.documentRole)) ||
        typeof candidate.sourcePageUrl !== "string" || !isCanonicalPublicHttpsUrl(candidate.sourcePageUrl) ||
        typeof candidate.anchorText !== "string" || candidate.anchorText.length > 200 || SENSITIVE_LABEL.test(candidate.anchorText) ||
        !["privacy", "cookies", "terms", "legal"].includes(String(candidate.kind)) ||
        !["not_fetched", "fetched", "unavailable", "failed"].includes(String(candidate.fetchStatus)) ||
        candidate.sha256 !== null && (typeof candidate.sha256 !== "string" || !/^[a-f0-9]{64}$/u.test(candidate.sha256)) ||
        candidate.fetchStatus === "fetched" && typeof candidate.sha256 !== "string" ||
        candidate.fetchStatus !== "fetched" && candidate.sha256 !== null ||
        candidate.failureCode !== undefined &&
          (typeof candidate.failureCode !== "string" || !FAILURE_CODES.has(candidate.failureCode as PublicPolicyDocumentFailureCode) || candidate.fetchStatus !== "failed") ||
        candidate.documentedFacts !== undefined &&
          (candidate.documentRole !== "provider_document" || !isValidDocumentedFacts(candidate.documentedFacts, candidate.fetchStatus))) return null;
    documents.push({
      href: candidate.href,
      anchorText: candidate.anchorText,
      kind: candidate.kind as PublicPolicyDiscoveredDocument["kind"],
      documentRole: candidate.documentRole as PublicPolicyDiscoveredDocument["documentRole"],
      sourcePageUrl: candidate.sourcePageUrl,
      fetchStatus: candidate.fetchStatus as PublicPolicyDiscoveredDocument["fetchStatus"],
      sha256: candidate.sha256 as string | null,
      ...(candidate.failureCode === undefined ? {} : { failureCode: candidate.failureCode as PublicPolicyDocumentFailureCode }),
      ...(candidate.documentedFacts === undefined ? {} : { documentedFacts: candidate.documentedFacts as PublicPolicyDiscoveredDocument["documentedFacts"] }),
    });
  }
  return documents;
}

function isValidDocumentedFacts(value: unknown, fetchStatus: unknown): boolean {
  return fetchStatus === "fetched" && Array.isArray(value) && value.length <= 5 &&
    value.every((fact) => isRecord(fact) && Reflect.ownKeys(fact).length === 3 &&
      Reflect.ownKeys(fact).every((key) => ["factId", "value", "excerpt"].includes(String(key))) &&
      typeof fact.factId === "string" && /^[a-z][a-z0-9_]{0,47}$/u.test(fact.factId) &&
      typeof fact.value === "boolean" && typeof fact.excerpt === "string" &&
      fact.excerpt.length > 0 && fact.excerpt.length <= 500 && !SENSITIVE_LABEL.test(fact.excerpt));
}

export function parsePublicPolicyDiscoveredDocumentsJson(value: unknown): PublicPolicyDiscoveredDocument[] | null {
  if (typeof value !== "string" || Buffer.byteLength(value, "utf8") > 128 * 1024) return null;
  try {
    return parsePublicPolicyDiscoveredDocuments(JSON.parse(value) as unknown);
  } catch {
    return null;
  }
}

function isCanonicalPublicHttpsUrl(value: string): boolean {
  if (value.length > 2048) return false;
  try {
    const url = new URL(value);
    const hostname = normalizeHostname(url.hostname);
    const safePath = url.pathname.startsWith("/") && url.pathname.length <= 512 &&
      !hasUnsafePathCharacters(url.pathname) &&
      !/%(?:0[0-9a-f]|1[0-9a-f]|7f)/iu.test(url.pathname);
    return url.protocol === "https:" && url.username === "" && url.password === "" && url.port === "" &&
      url.search === "" && url.hash === "" && hostname === url.hostname && safePath &&
      value === `https://${hostname}${url.pathname}`;
  } catch {
    return false;
  }
}

function hasUnsafePathCharacters(path: string): boolean {
  return Array.from(path).some((character) => {
    const codePoint = character.codePointAt(0) ?? 0;
    return character === "?" || character === "#" || character === "\\" || codePoint <= 0x1f || codePoint === 0x7f;
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype;
}
