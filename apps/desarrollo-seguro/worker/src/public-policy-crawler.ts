import { normalizeHostname } from "@desarrolloseguro/core";
import type { LookupFunction } from "node:net";
import {
  extractPublicPolicyLinks,
  type PublicPolicyLink,
} from "./public-policy-link-extractor.js";
import {
  createEgressAuthorizedLookup,
  createEgressDestinationAuthorizer,
} from "./egress-destination-policy.js";
import type { PublicDnsResolver } from "./pinned-dns-lookup.js";

export const PUBLIC_POLICY_CRAWL_LIMITS = Object.freeze({
  durationMs: 120_000,
  requests: 300,
  bytes: 20 * 1024 * 1024,
  pages: 30,
  documentBytes: 64 * 1024,
  redirectsPerDocument: 3,
});

const SAFE_FAILURE_CODES = new Set<PublicPolicyFetchFailureCode>([
  "auditor_error",
  "budget_exhausted",
  "cross_host_redirect",
  "dns_failure",
  "egress_denied",
  "redirect_limit_exceeded",
  "request_timeout",
  "response_too_large",
  "tls_failure",
  "unsupported_content_type",
]);
const ACCESS_DENIED_STATUSES = new Set([401, 403, 429, 451]);
const UNAVAILABLE_STATUSES = new Set([404, 410]);
const IDENTIFIER = /^[a-z0-9][a-z0-9_-]{0,31}$/u;
const MAX_CLASSIFIED_IDS = 30;

export type PublicPolicyFetchFailureCode =
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

export type PublicPolicyDocumentResponse = {
  statusCode?: number;
  contentType: string;
  html: string;
  requestsCount: number;
  bytesCount: number;
  redirectCount: number;
  failureCode?: PublicPolicyFetchFailureCode;
};

export type PublicPolicyDocumentRequest = {
  method: "GET";
  hostname: string;
  path: string;
  signal: AbortSignal;
  timeoutMs: number;
};

export type PublicPolicyClassification = {
  /** Only normalized IDs from the locally reviewed knowledge catalog. */
  providerIds: readonly string[];
  /** Provider IDs whose purpose is stated alongside that provider in the policy. */
  providersWithPurpose: readonly string[];
  /** Only normalized purpose IDs from the locally reviewed knowledge catalog. */
  purposeIds: readonly string[];
  /** Only normalized category IDs from the locally reviewed knowledge catalog. */
  categories: readonly string[];
  /** Provider-specific purpose identifiers found in the same visible text block. */
  declaredServices?: readonly { providerId: string; purposeIds: readonly string[] }[];
  /** True only for an explicit, cataloged anti-bot or access-denied page. */
  accessDenied?: boolean;
};

export type PublicPolicyEvidence = {
  policyVersion: "public-policy-v1";
  status: "pass" | "fail" | "unknown";
  initialPageInspectable: boolean;
  initialStatusCode: number;
  reasonCode:
    | "disclosure_found"
    | "no_policy_links"
    | "disclosure_missing"
    | "access_denied"
    | "policy_page_unavailable"
    | "auditor_error"
    | "budget_exhausted";
  linksFound: number;
  pagesInspected: number;
  accessDeniedPages: number;
  unavailablePages: number;
  providers: string[];
  providersWithPurpose: string[];
  declaredServices: Array<{ providerId: string; purposeIds: string[] }>;
  purposes: string[];
  categories: string[];
  requestsCount: number;
  bytesCount: number;
};

/**
 * The adapter must use the supplied method/host/path verbatim, pinned public
 * DNS on every socket, no cookies or credentials, no Referer, and must stop
 * rather than follow a redirect to a different hostname.
 */
export type PublicPolicyFetchDocument = (
  request: PublicPolicyDocumentRequest,
) => Promise<PublicPolicyDocumentResponse>;

export type ClassifyPublicPolicyHtml = (
  html: string,
) => PublicPolicyClassification;

export type CollectPublicPolicyEvidenceInput = {
  hostname: unknown;
  html?: unknown;
  links?: readonly PublicPolicyLink[];
  initialPageInspectable: boolean;
  initialStatusCode: number;
  signal: AbortSignal;
  fetchDocument: PublicPolicyFetchDocument;
  classifyHtml: ClassifyPublicPolicyHtml;
  budget?: {
    durationMs: number;
    requests: number;
    bytes: number;
  };
  now?: () => number;
};

/** A lookup pinned to one discovered HTTPS policy host and its public DNS answers. */
export function createPublicPolicyPinnedLookup(
  hostnameInput: unknown,
  resolver?: PublicDnsResolver,
): LookupFunction {
  const hostname = normalizeHostname(hostnameInput);
  return createEgressAuthorizedLookup(
    hostname,
    443,
    createEgressDestinationAuthorizer(hostname, resolver),
  );
}

/**
 * Follows only policy links visible in the initial document. Raw HTML and link
 * targets are passed only to injected in-process functions and are never part
 * of the returned or persisted evidence object.
 */
export async function collectPublicPolicyEvidence(
  input: CollectPublicPolicyEvidenceInput,
): Promise<PublicPolicyEvidence> {
  const now = input.now ?? Date.now;
  const startedAt = now();
  const empty = createEvidence(0);
  if (input.signal.aborted) {
    return withInitialPage(empty, input, "unknown", "auditor_error");
  }
  if (!Number.isSafeInteger(input.initialStatusCode) || input.initialStatusCode < 100 || input.initialStatusCode > 599 ||
      typeof input.initialPageInspectable !== "boolean") {
    return withInitialPage(empty, input, "unknown", "auditor_error");
  }
  if (ACCESS_DENIED_STATUSES.has(input.initialStatusCode)) {
    const denied = withInitialPage(empty, input, "fail", "access_denied");
    denied.accessDeniedPages = 1;
    return denied;
  }
  if (UNAVAILABLE_STATUSES.has(input.initialStatusCode) || input.initialStatusCode >= 500) {
    const unavailable = withInitialPage(empty, input, "fail", "policy_page_unavailable");
    unavailable.unavailablePages = 1;
    return unavailable;
  }
  if (input.initialStatusCode < 200 || input.initialStatusCode >= 300 || !input.initialPageInspectable) {
    return withInitialPage(empty, input, "unknown", "auditor_error");
  }

  let hostname: string;
  try {
    hostname = normalizeHostname(input.hostname);
  } catch {
    return withInitialPage(empty, input, "unknown", "auditor_error");
  }

  let links: readonly PublicPolicyLink[];
  if (input.links !== undefined) {
    if (
      !Array.isArray(input.links) ||
      input.links.length > PUBLIC_POLICY_CRAWL_LIMITS.pages ||
      input.links.some((link) => !isSafeDiscoveredLink(link))
    ) {
      return withInitialPage(empty, input, "unknown", "auditor_error");
    }
    links = input.links;
  } else {
    if (
      typeof input.html !== "string" ||
      Buffer.byteLength(input.html, "utf8") > 256 * 1024
    ) return withInitialPage(empty, input, "unknown", "auditor_error");
    links = extractPublicPolicyLinks(hostname, input.html);
  }
  const evidence = createEvidence(links.length);
  if (links.length === 0) {
    return withInitialPage(evidence, input, "fail", "no_policy_links");
  }

  let budget: ReturnType<typeof getRemainingBudget>;
  try {
    budget = getRemainingBudget(input.budget);
  } catch {
    return withInitialPage(evidence, input, "unknown", "auditor_error");
  }

  const controller = new AbortController();
  const signal = AbortSignal.any([input.signal, controller.signal]);
  const categories = new Set<string>();
  const providers = new Set<string>();
  const providersWithPurpose = new Set<string>();
  const declaredServices = new Map<string, Set<string>>();
  const purposes = new Set<string>();
  let denied = 0;
  let unavailable = 0;
  let hadAuditorError = false;
  let hadBudgetExhaustion = false;

  for (const link of links) {
    if (!isSafeDiscoveredLink(link)) {
      hadAuditorError = true;
      break;
    }
    if (signal.aborted) {
      hadAuditorError = input.signal.aborted;
      hadBudgetExhaustion ||= !input.signal.aborted;
      break;
    }
    if (
      evidence.pagesInspected >= Math.min(PUBLIC_POLICY_CRAWL_LIMITS.pages, budget.pages) ||
      evidence.requestsCount >= Math.min(PUBLIC_POLICY_CRAWL_LIMITS.requests, budget.requests) ||
      evidence.bytesCount >= Math.min(PUBLIC_POLICY_CRAWL_LIMITS.bytes, budget.bytes)
    ) {
      hadBudgetExhaustion = true;
      break;
    }
    const elapsedMs = Math.max(0, now() - startedAt);
    const timeoutMs = Math.min(budget.durationMs, PUBLIC_POLICY_CRAWL_LIMITS.durationMs) - elapsedMs;
    if (timeoutMs <= 0) {
      hadBudgetExhaustion = true;
      break;
    }

    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    let response: PublicPolicyDocumentResponse;
    try {
      response = await input.fetchDocument({
        method: "GET",
        hostname: link.hostname,
        path: link.path,
        signal,
        timeoutMs,
      });
    } catch {
      if (controller.signal.aborted && !input.signal.aborted) hadBudgetExhaustion = true;
      else hadAuditorError = true;
      clearTimeout(timeout);
      break;
    }
    clearTimeout(timeout);

    if (now() - startedAt >= Math.min(budget.durationMs, PUBLIC_POLICY_CRAWL_LIMITS.durationMs)) {
      hadBudgetExhaustion = true;
      break;
    }

    if (!isValidResponse(response)) {
      hadAuditorError = true;
      break;
    }
    evidence.requestsCount += response.requestsCount;
    evidence.bytesCount += response.bytesCount;
    evidence.pagesInspected += 1;
    if (
      evidence.requestsCount > PUBLIC_POLICY_CRAWL_LIMITS.requests ||
      evidence.bytesCount > PUBLIC_POLICY_CRAWL_LIMITS.bytes ||
      evidence.pagesInspected > PUBLIC_POLICY_CRAWL_LIMITS.pages ||
      evidence.requestsCount > budget.requests ||
      evidence.bytesCount > budget.bytes
    ) {
      hadBudgetExhaustion = true;
      break;
    }
    if (response.bytesCount > PUBLIC_POLICY_CRAWL_LIMITS.documentBytes) {
      hadAuditorError = true;
      break;
    }
    if (response.redirectCount > PUBLIC_POLICY_CRAWL_LIMITS.redirectsPerDocument) {
      hadBudgetExhaustion = true;
      break;
    }
    if (response.failureCode) {
      if (
        response.failureCode === "budget_exhausted" ||
        response.failureCode === "response_too_large" ||
        response.failureCode === "redirect_limit_exceeded" ||
        response.failureCode === "request_timeout" && controller.signal.aborted && !input.signal.aborted
      ) hadBudgetExhaustion = true;
      else hadAuditorError = true;
      continue;
    }
    const statusCode = response.statusCode;
    if (statusCode === undefined) {
      hadAuditorError = true;
      continue;
    }
    if (ACCESS_DENIED_STATUSES.has(statusCode)) {
      denied += 1;
      continue;
    }
    if (UNAVAILABLE_STATUSES.has(statusCode)) {
      unavailable += 1;
      evidence.unavailablePages = unavailable;
      continue;
    }
    if (statusCode < 200 || statusCode >= 300) {
      unavailable += 1;
      evidence.unavailablePages = unavailable;
      continue;
    }
    if (
      response.contentType.split(";", 1)[0]?.trim().toLowerCase() !== "text/html" ||
      Buffer.byteLength(response.html, "utf8") > PUBLIC_POLICY_CRAWL_LIMITS.documentBytes
    ) {
      hadAuditorError = true;
      continue;
    }

    try {
      const classification = input.classifyHtml(response.html);
      if (classification.accessDenied === true) denied += 1;
      mergeClassification(classification, providers, providersWithPurpose, purposes, categories, declaredServices);
    } catch {
      hadAuditorError = true;
    }
  }

  evidence.accessDeniedPages = denied;
  evidence.unavailablePages = unavailable;
  evidence.providers = [...providers].sort(compareIdentifiers);
  evidence.providersWithPurpose = [...providersWithPurpose].sort(compareIdentifiers);
  evidence.declaredServices = [...declaredServices].map(([providerId, purposeIds]) => ({
    providerId,
    purposeIds: [...purposeIds].sort(compareIdentifiers),
  })).sort((left, right) => compareIdentifiers(left.providerId, right.providerId)).slice(0, MAX_CLASSIFIED_IDS);
  evidence.purposes = [...purposes].sort(compareIdentifiers);
  evidence.categories = [...categories].sort(compareIdentifiers);
  if (links.length >= PUBLIC_POLICY_CRAWL_LIMITS.pages &&
      evidence.pagesInspected >= PUBLIC_POLICY_CRAWL_LIMITS.pages) {
    hadBudgetExhaustion = true;
  }

  if (denied > 0) return withInitialPage(evidence, input, "fail", "access_denied");
  if (unavailable > 0) return withInitialPage(evidence, input, "fail", "policy_page_unavailable");
  if (hadBudgetExhaustion) return withInitialPage(evidence, input, "unknown", "budget_exhausted");
  if (hadAuditorError || signal.aborted) return withInitialPage(evidence, input, "unknown", "auditor_error");
  if (
    providers.size > 0 &&
    providersWithPurpose.size === providers.size &&
    purposes.size > 0
  ) {
    return withInitialPage(evidence, input, "pass", "disclosure_found");
  }
  return withInitialPage(evidence, input, "fail", "disclosure_missing");
}

function mergeClassification(
  input: PublicPolicyClassification,
  providers: Set<string>,
  providersWithPurpose: Set<string>,
  purposes: Set<string>,
  categories: Set<string>,
  declaredServices: Map<string, Set<string>>,
): void {
  if (input.accessDenied !== undefined && typeof input.accessDenied !== "boolean") {
    throw new Error("public_policy_classification_invalid");
  }
  const documentProviders = normalizeIdentifiers(input.providerIds);
  const documentProvidersWithPurpose = normalizeIdentifiers(input.providersWithPurpose);
  if (documentProvidersWithPurpose.some((provider) => !documentProviders.includes(provider))) {
    throw new Error("public_policy_classification_invalid");
  }
  for (const provider of documentProviders) providers.add(provider);
  for (const provider of documentProvidersWithPurpose) providersWithPurpose.add(provider);
  for (const purpose of normalizeIdentifiers(input.purposeIds)) purposes.add(purpose);
  for (const category of normalizeIdentifiers(input.categories)) categories.add(category);
  for (const item of input.declaredServices ?? []) {
    if (typeof item.providerId !== "string" || !IDENTIFIER.test(item.providerId)) {
      throw new Error("public_policy_classification_invalid");
    }
    const providerPurposes = declaredServices.get(item.providerId) ?? new Set<string>();
    for (const purpose of normalizeIdentifiers(item.purposeIds)) providerPurposes.add(purpose);
    declaredServices.set(item.providerId, providerPurposes);
  }
  if (
    providers.size > MAX_CLASSIFIED_IDS ||
    providersWithPurpose.size > MAX_CLASSIFIED_IDS ||
    purposes.size > MAX_CLASSIFIED_IDS ||
    categories.size > MAX_CLASSIFIED_IDS ||
    declaredServices.size > MAX_CLASSIFIED_IDS ||
    [...declaredServices.values()].some((values) => values.size > MAX_CLASSIFIED_IDS)
  ) throw new Error("public_policy_classification_invalid");
}

function isSafeDiscoveredLink(link: unknown): link is PublicPolicyLink {
  try {
    if (typeof link !== "object" || link === null || Array.isArray(link) ||
        Object.getPrototypeOf(link) !== Object.prototype ||
        Reflect.ownKeys(link).length !== 3 ||
        !Object.hasOwn(link, "hostname") || !Object.hasOwn(link, "path") ||
        !Object.hasOwn(link, "kind")) return false;
    const candidate = link as Record<string, unknown>;
    const hostname = normalizeHostname(candidate.hostname);
    return hostname === candidate.hostname &&
      typeof candidate.path === "string" &&
      candidate.path.startsWith("/") &&
      candidate.path.length <= 512 &&
      !containsUnsafePathCharacter(candidate.path) &&
      typeof candidate.kind === "string" &&
      ["privacy", "cookies", "terms", "legal"].includes(candidate.kind);
  } catch {
    return false;
  }
}

function compareIdentifiers(left: string, right: string): number {
  return left.localeCompare(right, "en");
}

function containsUnsafePathCharacter(path: string): boolean {
  return Array.from(path).some((character) => {
    const codePoint = character.codePointAt(0) ?? 0;
    return character === "?" || character === "#" || character === "\\" ||
      codePoint <= 0x1f || codePoint === 0x7f;
  });
}

function getRemainingBudget(input: CollectPublicPolicyEvidenceInput["budget"]): {
  durationMs: number;
  requests: number;
  bytes: number;
  pages: number;
} {
  if (input === undefined) {
    return {
      durationMs: PUBLIC_POLICY_CRAWL_LIMITS.durationMs,
      requests: PUBLIC_POLICY_CRAWL_LIMITS.requests,
      bytes: PUBLIC_POLICY_CRAWL_LIMITS.bytes,
      pages: PUBLIC_POLICY_CRAWL_LIMITS.pages,
    };
  }
  if (
    !Number.isSafeInteger(input.durationMs) || input.durationMs < 0 ||
    !Number.isSafeInteger(input.requests) || input.requests < 0 ||
    !Number.isSafeInteger(input.bytes) || input.bytes < 0
  ) throw new Error("public_policy_budget_invalid");
  return {
    durationMs: Math.min(input.durationMs, PUBLIC_POLICY_CRAWL_LIMITS.durationMs),
    requests: Math.min(input.requests, PUBLIC_POLICY_CRAWL_LIMITS.requests),
    bytes: Math.min(input.bytes, PUBLIC_POLICY_CRAWL_LIMITS.bytes),
    pages: PUBLIC_POLICY_CRAWL_LIMITS.pages,
  };
}

function normalizeIdentifiers(input: unknown): string[] {
  if (!Array.isArray(input) || input.length > MAX_CLASSIFIED_IDS) {
    throw new Error("public_policy_classification_invalid");
  }
  const values = new Set<string>();
  for (const value of input) {
    if (typeof value !== "string" || !IDENTIFIER.test(value)) {
      throw new Error("public_policy_classification_invalid");
    }
    values.add(value);
  }
  return [...values];
}

function isValidResponse(input: unknown): input is PublicPolicyDocumentResponse {
  if (typeof input !== "object" || input === null || Array.isArray(input)) return false;
  const candidate = input as Record<string, unknown>;
  const allowedKeys = new Set([
    "statusCode", "contentType", "html", "requestsCount", "bytesCount", "redirectCount", "failureCode",
  ]);
  if (Object.keys(candidate).some((key) => !allowedKeys.has(key))) return false;
  const validStatusCode = Number.isSafeInteger(candidate.statusCode) &&
    (candidate.statusCode as number) >= 100 && (candidate.statusCode as number) <= 599;
  const validFailureCode = typeof candidate.failureCode === "string" &&
    SAFE_FAILURE_CODES.has(candidate.failureCode as PublicPolicyFetchFailureCode);
  return (validStatusCode || candidate.statusCode === undefined && validFailureCode) &&
    typeof candidate.contentType === "string" && candidate.contentType.length <= 128 &&
    typeof candidate.html === "string" &&
    isBoundedCount(candidate.requestsCount, PUBLIC_POLICY_CRAWL_LIMITS.requests) &&
    isBoundedCount(candidate.bytesCount, PUBLIC_POLICY_CRAWL_LIMITS.bytes) &&
    isBoundedCount(candidate.redirectCount, PUBLIC_POLICY_CRAWL_LIMITS.redirectsPerDocument + 1) &&
    (candidate.failureCode === undefined || validFailureCode);
}

function isBoundedCount(value: unknown, maximum: number): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 0 && (value as number) <= maximum;
}

function createEvidence(linksFound: number): PublicPolicyEvidence {
  return {
    policyVersion: "public-policy-v1",
    status: "unknown",
    initialPageInspectable: false,
    initialStatusCode: 0,
    reasonCode: "auditor_error",
    linksFound,
    pagesInspected: 0,
    accessDeniedPages: 0,
    unavailablePages: 0,
    providers: [],
    providersWithPurpose: [],
    purposes: [],
    categories: [],
    declaredServices: [],
    requestsCount: 0,
    bytesCount: 0,
  };
}

function withReason(
  evidence: PublicPolicyEvidence,
  status: PublicPolicyEvidence["status"],
  reasonCode: PublicPolicyEvidence["reasonCode"],
): PublicPolicyEvidence {
  return { ...evidence, status, reasonCode };
}

function withInitialPage(
  evidence: PublicPolicyEvidence,
  input: CollectPublicPolicyEvidenceInput,
  status: PublicPolicyEvidence["status"],
  reasonCode: PublicPolicyEvidence["reasonCode"],
): PublicPolicyEvidence {
  return {
    ...withReason(evidence, status, reasonCode),
    initialPageInspectable: input.initialPageInspectable === true,
    initialStatusCode: Number.isSafeInteger(input.initialStatusCode) ? input.initialStatusCode : 0,
  };
}
