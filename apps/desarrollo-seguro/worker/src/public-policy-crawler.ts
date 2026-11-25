import { createHash } from "node:crypto";
import { normalizeHostname } from "@desarrolloseguro/core";
import type { ProviderLegalDataOrigin, ProviderStatement } from "@desarrolloseguro/core";
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
import type { PublicPolicyDiscoveredDocument } from "./public-policy-document-boundary.js";
import {
  classifyProviderDocumentHtml,
  MAX_POLICY_TEXT_BYTES,
} from "./public-policy-classifier.js";

export const PUBLIC_POLICY_CRAWL_LIMITS = Object.freeze({
  durationMs: 120_000,
  requests: 300,
  bytes: 20 * 1024 * 1024,
  pages: 30,
  documentBytes: 1_024 * 1024,
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
const MAX_SITE_STATEMENTS = 30;
const MAX_SITE_EXCERPT_LENGTH = 500;
const SITE_SOURCE_VERSION = "public-policy-source-v1";
const MAX_SITE_STATEMENT_BYTES = 20 * 1024;
const MAX_DISCOVERED_DOCUMENT_LINKS = 40;

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
  /** Source text excerpt and explicit site-side facts; crawler adds document provenance. */
  siteStatements?: readonly {
    providerId: string;
    factId: string;
    value: boolean;
    basis: "explicit_claim";
    excerpt: string;
  }[];
  /** Literal site declarations; crawler attaches a source receipt to every claim. */
  legalContextClaims?: readonly (
    | { kind: "data_origin"; value: ProviderLegalDataOrigin; excerpt: string }
    | { kind: "audited_entity_is_controller" | "aepd_jurisdiction_is_established"; excerpt: string }
  )[];
  documentTitle?: string;
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
  declaredServices: Array<{
    providerId: string;
    purposeIds: string[];
    siteStatements?: ProviderStatement[];
    legalEvidenceContext?: import("@desarrolloseguro/core").ProviderLegalEvidenceContext;
  }>;
  /** Explicit legal/documentation links found in fetched public-policy HTML. */
  discoveredDocuments: PublicPolicyDiscoveredDocument[];
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
  captureAt?: () => Date;
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
  const evidence = createEvidence(links.filter(({ documentRole }) => documentRole !== "provider_document").length);
  const discoveredDocuments: PublicPolicyDiscoveredDocument[] = [];
  const seenDiscoveredDocuments = new Set<string>();
  const targetReceipts = new Map<string, Pick<PublicPolicyDiscoveredDocument, "fetchStatus" | "sha256" | "failureCode" | "documentedFacts">>();
  for (const link of links) {
    addDiscoveredDocument(discoveredDocuments, seenDiscoveredDocuments, {
      ...link,
      href: link.href ?? publicUrl(link),
      anchorText: link.anchorText ?? "",
      documentRole: link.documentRole ?? "audited_site_policy",
    }, `https://${hostname}/`);
  }
  evidence.discoveredDocuments = discoveredDocuments;
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
  const declaredServices = new Map<string, { purposes: Set<string>; siteStatements: ProviderStatement[] }>();
  const legalContext: {
    dataOrigin?: import("@desarrolloseguro/core").ProviderLegalEvidenceContext["dataOrigin"];
    dataOriginConflict?: boolean;
    controllerEvidence?: import("@desarrolloseguro/core").ProviderEvidenceSource[];
    jurisdictionEvidence?: import("@desarrolloseguro/core").ProviderEvidenceSource[];
  } = {};
  const purposes = new Set<string>();
  let denied = 0;
  let unavailable = 0;
  let hadAuditorError = false;
  let hadBudgetExhaustion = false;
  let fetchAttempts = 0;

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
      fetchAttempts >= Math.min(PUBLIC_POLICY_CRAWL_LIMITS.pages, budget.pages) ||
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
    fetchAttempts += 1;
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
      targetReceipts.set(publicUrl(link), { fetchStatus: "failed", sha256: null, failureCode: "auditor_error" });
      if (controller.signal.aborted && !input.signal.aborted) hadBudgetExhaustion = true;
      else hadAuditorError = true;
      clearTimeout(timeout);
      break;
    }
    clearTimeout(timeout);

    if (now() - startedAt >= Math.min(budget.durationMs, PUBLIC_POLICY_CRAWL_LIMITS.durationMs)) {
      targetReceipts.set(publicUrl(link), { fetchStatus: "failed", sha256: null, failureCode: "budget_exhausted" });
      hadBudgetExhaustion = true;
      break;
    }

    if (!isValidResponse(response)) {
      targetReceipts.set(publicUrl(link), { fetchStatus: "failed", sha256: null, failureCode: "auditor_error" });
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
      targetReceipts.set(publicUrl(link), { fetchStatus: "failed", sha256: null, failureCode: "budget_exhausted" });
      hadBudgetExhaustion = true;
      break;
    }
    if (response.bytesCount > PUBLIC_POLICY_CRAWL_LIMITS.documentBytes) {
      targetReceipts.set(publicUrl(link), { fetchStatus: "failed", sha256: null, failureCode: "response_too_large" });
      hadAuditorError = true;
      break;
    }
    if (response.redirectCount > PUBLIC_POLICY_CRAWL_LIMITS.redirectsPerDocument) {
      targetReceipts.set(publicUrl(link), { fetchStatus: "failed", sha256: null, failureCode: "redirect_limit_exceeded" });
      hadBudgetExhaustion = true;
      break;
    }
    if (response.failureCode) {
      targetReceipts.set(publicUrl(link), { fetchStatus: "failed", sha256: null, failureCode: response.failureCode });
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
      targetReceipts.set(publicUrl(link), { fetchStatus: "failed", sha256: null, failureCode: "auditor_error" });
      hadAuditorError = true;
      continue;
    }
    if (ACCESS_DENIED_STATUSES.has(statusCode)) {
      targetReceipts.set(publicUrl(link), { fetchStatus: "unavailable", sha256: null });
      denied += 1;
      continue;
    }
    if (UNAVAILABLE_STATUSES.has(statusCode)) {
      targetReceipts.set(publicUrl(link), { fetchStatus: "unavailable", sha256: null });
      unavailable += 1;
      evidence.unavailablePages = unavailable;
      continue;
    }
    if (statusCode < 200 || statusCode >= 300) {
      targetReceipts.set(publicUrl(link), { fetchStatus: "unavailable", sha256: null });
      unavailable += 1;
      evidence.unavailablePages = unavailable;
      continue;
    }
    if (
      response.contentType.split(";", 1)[0]?.trim().toLowerCase() !== "text/html" ||
      Buffer.byteLength(response.html, "utf8") > PUBLIC_POLICY_CRAWL_LIMITS.documentBytes
    ) {
      targetReceipts.set(publicUrl(link), {
        fetchStatus: "failed", sha256: null,
        failureCode: response.contentType.split(";", 1)[0]?.trim().toLowerCase() !== "text/html"
          ? "unsupported_content_type"
          : "response_too_large",
      });
      hadAuditorError = true;
      continue;
    }

    targetReceipts.set(publicUrl(link), {
      fetchStatus: "fetched",
      sha256: createHash("sha256").update(response.html, "utf8").digest("hex"),
    });
    if (link.documentRole !== "provider_document") {
      for (const discovered of extractPublicPolicyLinks(link.hostname, response.html, link.path)) {
        addDiscoveredDocument(
          discoveredDocuments,
          seenDiscoveredDocuments,
          discovered,
          publicUrl(link),
        );
      }

      try {
        const classification = input.classifyHtml(response.html);
        if (classification.accessDenied === true) denied += 1;
        mergeClassification(classification, providers, providersWithPurpose, purposes, categories, declaredServices);
        const capturedAt = input.captureAt?.() ?? new Date();
        mergeSiteStatements(classification, link, capturedAt, declaredServices);
        mergeLegalContextClaims(classification, link, capturedAt, legalContext);
      } catch {
        hadAuditorError = true;
      }
    }
  }

  for (const document of discoveredDocuments) {
    if (targetReceipts.has(document.href)) continue;
    if (signal.aborted || fetchAttempts >= Math.min(PUBLIC_POLICY_CRAWL_LIMITS.pages, budget.pages) ||
        evidence.requestsCount >= Math.min(PUBLIC_POLICY_CRAWL_LIMITS.requests, budget.requests) ||
        evidence.bytesCount >= Math.min(PUBLIC_POLICY_CRAWL_LIMITS.bytes, budget.bytes)) break;
    const elapsedMs = Math.max(0, now() - startedAt);
    const timeoutMs = Math.min(budget.durationMs, PUBLIC_POLICY_CRAWL_LIMITS.durationMs) - elapsedMs;
    if (timeoutMs <= 0) break;
    const url = new URL(document.href);
    fetchAttempts += 1;
    const outcome = await fetchExplicitDocumentReceipt({
      fetchDocument: input.fetchDocument,
      hostname: url.hostname,
      path: url.pathname,
      documentRole: document.documentRole,
      signal,
      timeoutMs,
    });
    evidence.requestsCount += outcome.requestsCount;
    evidence.bytesCount += outcome.bytesCount;
    targetReceipts.set(document.href, outcome.receipt);
    if (evidence.requestsCount > PUBLIC_POLICY_CRAWL_LIMITS.requests || evidence.requestsCount > budget.requests ||
        evidence.bytesCount > PUBLIC_POLICY_CRAWL_LIMITS.bytes || evidence.bytesCount > budget.bytes) break;
  }

  evidence.accessDeniedPages = denied;
  evidence.discoveredDocuments = discoveredDocuments.map((document) => {
    const receipt = targetReceipts.get(document.href);
    return receipt ? { ...document, ...receipt } : document;
  });
  evidence.unavailablePages = unavailable;
  evidence.providers = [...providers].sort(compareIdentifiers);
  evidence.providersWithPurpose = [...providersWithPurpose].sort(compareIdentifiers);
  evidence.declaredServices = [...declaredServices].map(([providerId, service]) => ({
    providerId,
    purposeIds: [...service.purposes].sort(compareIdentifiers),
    ...(service.siteStatements.length > 0 ? { siteStatements: service.siteStatements } : {}),
      ...(legalContext.dataOrigin || legalContext.controllerEvidence || legalContext.jurisdictionEvidence ? {
      legalEvidenceContext: {
        ...(legalContext.dataOrigin ? { dataOrigin: legalContext.dataOrigin } : {}),
        ...(legalContext.controllerEvidence ? { auditedEntityIsController: { evidence: legalContext.controllerEvidence } } : {}),
        ...(legalContext.jurisdictionEvidence ? { aepdJurisdictionIsEstablished: { evidence: legalContext.jurisdictionEvidence } } : {}),
      },
    } : {}),
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
  declaredServices: Map<string, { purposes: Set<string>; siteStatements: ProviderStatement[] }>,
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
    const providerService = declaredServices.get(item.providerId) ?? { purposes: new Set<string>(), siteStatements: [] };
    for (const purpose of normalizeIdentifiers(item.purposeIds)) providerService.purposes.add(purpose);
    declaredServices.set(item.providerId, providerService);
  }
  if (
    providers.size > MAX_CLASSIFIED_IDS ||
    providersWithPurpose.size > MAX_CLASSIFIED_IDS ||
    purposes.size > MAX_CLASSIFIED_IDS ||
    categories.size > MAX_CLASSIFIED_IDS ||
    declaredServices.size > MAX_CLASSIFIED_IDS ||
    [...declaredServices.values()].some(({ purposes }) => purposes.size > MAX_CLASSIFIED_IDS)
  ) throw new Error("public_policy_classification_invalid");
}

function mergeSiteStatements(
  classification: PublicPolicyClassification,
  link: PublicPolicyLink,
  capturedAt: Date,
  declaredServices: Map<string, { purposes: Set<string>; siteStatements: ProviderStatement[] }>,
): void {
  const statements = classification.siteStatements ?? [];
  if (!Array.isArray(statements) || statements.length > MAX_SITE_STATEMENTS ||
      !Number.isFinite(capturedAt.getTime())) throw new Error("public_policy_classification_invalid");
  const documentTitle = sanitizeDocumentTitle(classification.documentTitle, link.kind);
  const source = {
    sourceId: createPolicySourceId(link),
    version: SITE_SOURCE_VERSION,
    title: documentTitle,
    url: `https://${link.hostname}${link.path}`,
    capturedAt: capturedAt.toISOString(),
    documentKind: link.kind,
    sourceKind: "audited_site" as const,
  };
  for (const candidate of statements) {
    if (typeof candidate !== "object" || candidate === null ||
        !IDENTIFIER.test(candidate.providerId) || !FACT_IDENTIFIER.test(candidate.factId) ||
        typeof candidate.value !== "boolean" || candidate.basis !== "explicit_claim" ||
        typeof candidate.excerpt !== "string" || candidate.excerpt.length === 0 ||
        candidate.excerpt.length > MAX_SITE_EXCERPT_LENGTH || containsSensitiveExcerpt(candidate.excerpt)) {
      throw new Error("public_policy_classification_invalid");
    }
    const providerService = declaredServices.get(candidate.providerId) ?? { purposes: new Set<string>(), siteStatements: [] };
    const statementCount = [...declaredServices.values()].reduce((total, service) => total + service.siteStatements.length, 0);
    if (statementCount >= MAX_SITE_STATEMENTS || providerService.siteStatements.length >= MAX_SITE_STATEMENTS) continue;
    const statement: ProviderStatement = {
      factId: candidate.factId,
      value: candidate.value,
      basis: candidate.basis,
      source: { ...source, excerpt: candidate.excerpt },
    };
    providerService.siteStatements.push(statement);
    declaredServices.set(candidate.providerId, providerService);
    const serializedEvidence = [...declaredServices.entries()].map(([providerId, service]) => ({
      providerId,
      purposeIds: [...service.purposes],
      ...(service.siteStatements.length ? { siteStatements: service.siteStatements } : {}),
    }));
    if (Buffer.byteLength(JSON.stringify(serializedEvidence), "utf8") > MAX_SITE_STATEMENT_BYTES) {
      providerService.siteStatements.pop();
      if (providerService.siteStatements.length === 0 && providerService.purposes.size === 0) {
        declaredServices.delete(candidate.providerId);
      }
    }
  }
}

function mergeLegalContextClaims(
  classification: PublicPolicyClassification,
  link: PublicPolicyLink,
  capturedAt: Date,
  context: {
    dataOrigin?: import("@desarrolloseguro/core").ProviderLegalEvidenceContext["dataOrigin"];
    dataOriginConflict?: boolean;
    controllerEvidence?: import("@desarrolloseguro/core").ProviderEvidenceSource[];
    jurisdictionEvidence?: import("@desarrolloseguro/core").ProviderEvidenceSource[];
  },
): void {
  const claims = classification.legalContextClaims ?? [];
  if (!Array.isArray(claims) || claims.length > MAX_SITE_STATEMENTS || !Number.isFinite(capturedAt.getTime())) {
    throw new Error("public_policy_classification_invalid");
  }
  const title = sanitizeDocumentTitle(classification.documentTitle, link.kind);
  const baseSource = {
    sourceId: createPolicySourceId(link),
    version: SITE_SOURCE_VERSION,
    title,
    url: `https://${link.hostname}${link.path}`,
    capturedAt: capturedAt.toISOString(),
    documentKind: link.kind,
    sourceKind: "audited_site" as const,
  };
  for (const claim of claims) {
    if (typeof claim !== "object" || claim === null || Array.isArray(claim) ||
        Object.getPrototypeOf(claim) !== Object.prototype || typeof claim.excerpt !== "string" ||
        claim.excerpt.length === 0 || claim.excerpt.length > MAX_SITE_EXCERPT_LENGTH || containsSensitiveExcerpt(claim.excerpt)) {
      throw new Error("public_policy_classification_invalid");
    }
    const keys = Reflect.ownKeys(claim).map(String);
    const expectedKeys = claim.kind === "data_origin" ? ["kind", "value", "excerpt"] : ["kind", "excerpt"];
    if (keys.length !== expectedKeys.length || expectedKeys.some((key) => !Object.hasOwn(claim, key)) ||
        keys.some((key) => !expectedKeys.includes(key))) throw new Error("public_policy_classification_invalid");
    const evidence = { ...baseSource, excerpt: claim.excerpt };
    if (claim.kind === "data_origin" &&
        (claim.value === "obtained_from_subject" || claim.value === "not_obtained_from_subject")) {
      if (context.dataOriginConflict) continue;
      if (context.dataOrigin && context.dataOrigin.value !== claim.value) {
        delete context.dataOrigin;
        context.dataOriginConflict = true;
        continue;
      }
      const sources = [...(context.dataOrigin?.evidence ?? [])];
      if (sources.length < 5) sources.push(evidence);
      context.dataOrigin = { value: claim.value, evidence: sources };
    } else if (claim.kind === "audited_entity_is_controller") {
      const sources = context.controllerEvidence ?? (context.controllerEvidence = []);
      if (sources.length < 5) sources.push(evidence);
    } else if (claim.kind === "aepd_jurisdiction_is_established") {
      const sources = context.jurisdictionEvidence ?? (context.jurisdictionEvidence = []);
      if (sources.length < 5) sources.push(evidence);
    } else {
      throw new Error("public_policy_classification_invalid");
    }
  }
}

const FACT_IDENTIFIER = /^[a-z][a-z0-9_]{0,47}$/u;

function createPolicySourceId(link: PublicPolicyLink): string {
  const url = `https://${link.hostname}${link.path}`;
  const digest = createHash("sha256").update(url).digest("hex").slice(0, 32);
  return `policy-${digest}`;
}

function sanitizeDocumentTitle(value: unknown, kind: PublicPolicyLink["kind"]): string {
  const fallback: Record<PublicPolicyLink["kind"], string> = {
    privacy: "Información de privacidad",
    cookies: "Información sobre cookies",
    terms: "Términos y condiciones",
    legal: "Aviso legal",
  };
  if (typeof value !== "string") return fallback[kind];
  const title = value.replace(/\s+/gu, " ").trim().slice(0, 200);
  return title && !containsSensitiveExcerpt(title) ? title : fallback[kind];
}

function containsSensitiveExcerpt(value: string): boolean {
  return /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b|\b(?:sk|key|token)[-_][A-Z0-9_-]{12,}\b/iu.test(value);
}

function isSafeDiscoveredLink(link: unknown): link is PublicPolicyLink {
  try {
    if (typeof link !== "object" || link === null || Array.isArray(link) ||
        Object.getPrototypeOf(link) !== Object.prototype ||
        Reflect.ownKeys(link).some((key) => !["hostname", "path", "kind", "href", "anchorText", "documentRole"].includes(String(key))) ||
        Reflect.ownKeys(link).length < 3 || Reflect.ownKeys(link).length > 6 ||
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
      ["privacy", "cookies", "terms", "legal"].includes(candidate.kind) &&
      (candidate.documentRole === undefined || candidate.documentRole === "audited_site_policy" || candidate.documentRole === "provider_document") &&
      (candidate.href === undefined || candidate.href === `https://${hostname}${candidate.path}`) &&
      (candidate.anchorText === undefined || typeof candidate.anchorText === "string" && candidate.anchorText.length <= 200);
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
    discoveredDocuments: [],
    requestsCount: 0,
    bytesCount: 0,
  };
}

function publicUrl(link: Pick<PublicPolicyLink, "hostname" | "path">): string {
  return `https://${link.hostname}${link.path}`;
}

function addDiscoveredDocument(
  documents: PublicPolicyDiscoveredDocument[],
  seen: Set<string>,
  link: PublicPolicyLink,
  sourcePageUrl: string,
): void {
  const href = link.href ?? publicUrl(link);
  const key = `${sourcePageUrl}\n${href}`;
  if (seen.has(key) || documents.length >= MAX_DISCOVERED_DOCUMENT_LINKS) return;
  seen.add(key);
  documents.push({
    href,
    anchorText: (link.anchorText ?? "").replace(/\s+/gu, " ").trim().slice(0, 200),
    kind: link.kind,
    documentRole: link.documentRole ?? "audited_site_policy",
    sourcePageUrl,
    fetchStatus: "not_fetched",
    sha256: null,
  });
}

async function fetchExplicitDocumentReceipt(input: {
  fetchDocument: PublicPolicyFetchDocument;
  hostname: string;
  path: string;
  documentRole: PublicPolicyLink["documentRole"];
  signal: AbortSignal;
  timeoutMs: number;
}): Promise<{
  receipt: Pick<PublicPolicyDiscoveredDocument, "fetchStatus" | "sha256" | "failureCode" | "documentedFacts">;
  requestsCount: number;
  bytesCount: number;
}> {
  const requestController = new AbortController();
  const requestSignal = AbortSignal.any([input.signal, requestController.signal]);
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    requestController.abort();
  }, input.timeoutMs);
  let response: PublicPolicyDocumentResponse;
  try {
    response = await input.fetchDocument({
      method: "GET",
      hostname: input.hostname,
      path: input.path,
      signal: requestSignal,
      timeoutMs: input.timeoutMs,
    });
  } catch {
    clearTimeout(timer);
    return {
      receipt: { fetchStatus: "failed", sha256: null, failureCode: timedOut ? "budget_exhausted" : "auditor_error" },
      requestsCount: 0,
      bytesCount: 0,
    };
  }
  clearTimeout(timer);

  if (!isValidResponse(response)) {
    return { receipt: { fetchStatus: "failed", sha256: null, failureCode: "auditor_error" }, requestsCount: 0, bytesCount: 0 };
  }
  const counts = { requestsCount: response.requestsCount, bytesCount: response.bytesCount };
  if (response.failureCode) {
    return {
      receipt: { fetchStatus: "failed", sha256: null, failureCode: response.failureCode },
      ...counts,
    };
  }
  if (response.statusCode === undefined) {
    return { receipt: { fetchStatus: "failed", sha256: null, failureCode: "auditor_error" }, ...counts };
  }
  if (response.redirectCount > PUBLIC_POLICY_CRAWL_LIMITS.redirectsPerDocument) {
    return { receipt: { fetchStatus: "failed", sha256: null, failureCode: "redirect_limit_exceeded" }, ...counts };
  }
  if (response.statusCode < 200 || response.statusCode >= 300) {
    return { receipt: { fetchStatus: "unavailable", sha256: null }, ...counts };
  }
  if (response.contentType.split(";", 1)[0]?.trim().toLowerCase() !== "text/html") {
    return { receipt: { fetchStatus: "failed", sha256: null, failureCode: "unsupported_content_type" }, ...counts };
  }
  if (response.bytesCount > PUBLIC_POLICY_CRAWL_LIMITS.documentBytes ||
      Buffer.byteLength(response.html, "utf8") > PUBLIC_POLICY_CRAWL_LIMITS.documentBytes) {
    return { receipt: { fetchStatus: "failed", sha256: null, failureCode: "response_too_large" }, ...counts };
  }
  let documentedFacts: ReturnType<typeof classifyProviderDocumentHtml> = [];
  if (input.documentRole === "provider_document") {
    if (Buffer.byteLength(response.html, "utf8") > MAX_POLICY_TEXT_BYTES) {
      return {
        receipt: { fetchStatus: "failed", sha256: null, failureCode: "response_too_large" },
        ...counts,
      };
    }
    try {
      documentedFacts = classifyProviderDocumentHtml(response.html);
    } catch {
      return {
        receipt: { fetchStatus: "failed", sha256: null, failureCode: "auditor_error" },
        ...counts,
      };
    }
  }
  return {
    receipt: {
      fetchStatus: "fetched",
      sha256: createHash("sha256").update(response.html, "utf8").digest("hex"),
      ...(documentedFacts.length > 0 ? { documentedFacts } : {}),
    },
    ...counts,
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
