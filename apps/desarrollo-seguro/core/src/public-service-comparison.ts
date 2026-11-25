import { PUBLIC_SERVICE_PROVIDER_INFO } from "./public-service-catalog.js";
import {
  isProviderStatement,
  isProviderLegalEvidenceContext,
  parseProviderDocumentationContradiction,
  type ProviderDocumentationContradiction,
  type ProviderLegalEvidenceContext,
  type ProviderStatement,
} from "./provider-documentation-contradictions.js";

export const PUBLIC_SERVICE_COMPARISON_VERSION = "public-service-comparison-v1" as const;
export const PUBLIC_SERVICE_MAX_ITEMS = 30;
export const PUBLIC_SERVICE_COMPARISON_MAX_BYTES = 65_536;
const PROVIDER_ID = /^[a-z0-9][a-z0-9_-]{0,31}$/u;
const PURPOSE_ID = /^[a-z0-9][a-z0-9_-]{0,31}$/u;

export type PublicServiceItem = {
  providerId: string;
  observation: "observed" | "declared" | "observed_and_declared";
  observedDomains: string[];
  declaredPurposes: string[];
};

export type PublicServiceDeclarationEvidence = {
  providerId: string;
  purposes: string[];
  siteStatements?: ProviderStatement[];
  legalEvidenceContext?: ProviderLegalEvidenceContext;
};

/** Strict parser used at the runtime coordinator protocol boundary. */
export function parsePublicServiceDeclarations(value: unknown): PublicServiceDeclarationEvidence[] | null {
  if (!Array.isArray(value) || value.length > PUBLIC_SERVICE_MAX_ITEMS) return null;
  let statementCount = 0;
  const output: PublicServiceDeclarationEvidence[] = [];
  const providers = new Set<string>();
  for (const row of value) {
    if (!isRecord(row) || !["providerId", "purposes", "siteStatements", "legalEvidenceContext"]
      .every((key) => ["siteStatements", "legalEvidenceContext"].includes(key) && !Object.hasOwn(row, key) || Object.hasOwn(row, key)) ||
      Reflect.ownKeys(row).length !== 2 + Number(Object.hasOwn(row, "siteStatements")) + Number(Object.hasOwn(row, "legalEvidenceContext")) ||
      typeof row.providerId !== "string" || !/^[a-z0-9][a-z0-9_-]{0,31}$/u.test(row.providerId) ||
      providers.has(row.providerId) || !Array.isArray(row.purposes) || row.purposes.length > 8 ||
      !row.purposes.every((purpose) => typeof purpose === "string" && /^[a-z0-9][a-z0-9_-]{0,31}$/u.test(purpose)) ||
      new Set(row.purposes).size !== row.purposes.length) return null;
    providers.add(row.providerId);
    const statements: ProviderStatement[] = [];
    if (Object.hasOwn(row, "siteStatements")) {
      if (!Array.isArray(row.siteStatements) || row.siteStatements.length > 30 ||
          !row.siteStatements.every(isProviderStatement)) return null;
      statementCount += row.siteStatements.length;
      if (statementCount > 30) return null;
      statements.push(...row.siteStatements);
    }
    if (Object.hasOwn(row, "legalEvidenceContext") && !isProviderLegalEvidenceContext(row.legalEvidenceContext)) return null;
    output.push({
      providerId: row.providerId,
      purposes: [...row.purposes] as string[],
      ...(Object.hasOwn(row, "siteStatements") ? { siteStatements: statements } : {}),
      ...(Object.hasOwn(row, "legalEvidenceContext")
        ? { legalEvidenceContext: row.legalEvidenceContext as ProviderLegalEvidenceContext }
        : {}),
    });
  }
  return output;
}

export type PublicServiceComparison = {
  policyVersion: typeof PUBLIC_SERVICE_COMPARISON_VERSION;
  status: "pass" | "fail" | "unknown";
  reasonCode: "services_disclosed" | "observed_service_undisclosed" | "provider_documentation_contradiction" | "public_policy_missing" | "auditor_error";
  items: PublicServiceItem[];
  providerDocumentation?: ProviderDocumentationContradiction[];
};

/** Builds a small, privacy-safe service list from reviewed identifiers only. */
export function assessPublicServiceComparison(input: {
  observed: readonly { providerId: string; domain: string }[];
  declared: readonly { providerId: string; purposes: readonly string[] }[];
  policyStatus: "pass" | "fail" | "unknown";
  auditorError?: boolean;
  providerDocumentation?: readonly ProviderDocumentationContradiction[];
}): PublicServiceComparison {
  const observed = new Map<string, Set<string>>();
  for (const row of input.observed.slice(0, PUBLIC_SERVICE_MAX_ITEMS)) {
    if (!isProviderId(row.providerId) || !isSafeHostname(row.domain)) continue;
    const domains = observed.get(row.providerId) ?? new Set<string>();
    domains.add(row.domain.toLowerCase());
    observed.set(row.providerId, domains);
  }
  const declared = new Map<string, Set<string>>();
  for (const row of input.declared.slice(0, PUBLIC_SERVICE_MAX_ITEMS)) {
    if (!isProviderId(row.providerId)) continue;
    const purposes = declared.get(row.providerId) ?? new Set<string>();
    for (const purpose of row.purposes) if (isPurposeId(purpose)) purposes.add(purpose);
    declared.set(row.providerId, purposes);
  }
  const ids = [...new Set([...observed.keys(), ...declared.keys()])]
    .sort(compareIdentifiers)
    .slice(0, PUBLIC_SERVICE_MAX_ITEMS);
  const items: PublicServiceItem[] = ids.map((providerId) => {
    const domains = [...(observed.get(providerId) ?? [])].sort(compareIdentifiers).slice(0, 8);
    const purposes = [...(declared.get(providerId) ?? [])].sort(compareIdentifiers).slice(0, 8);
    const isObserved = domains.length > 0;
    const isDeclared = declared.has(providerId) && purposes.length > 0;
    return {
      providerId,
      observation: isObserved && isDeclared ? "observed_and_declared" : isObserved ? "observed" : "declared",
      observedDomains: domains,
      declaredPurposes: purposes,
    };
  });
  const missing = items.some((item) => item.observation === "observed");
  const policyMissing = input.policyStatus === "fail";
  const hasContradiction = input.providerDocumentation?.some(({ status }) => status === "contradiction_confirmed") ?? false;
  if (input.auditorError || input.policyStatus === "unknown") return {
    policyVersion: PUBLIC_SERVICE_COMPARISON_VERSION,
    status: "unknown",
    reasonCode: "auditor_error",
    items,
  };
  return {
    policyVersion: PUBLIC_SERVICE_COMPARISON_VERSION,
    status: missing || hasContradiction || policyMissing ? "fail" : "pass",
    reasonCode: missing ? "observed_service_undisclosed"
      : hasContradiction ? "provider_documentation_contradiction"
        : policyMissing ? "public_policy_missing" : "services_disclosed",
    items,
    ...(input.providerDocumentation?.length ? { providerDocumentation: [...input.providerDocumentation] } : {}),
  };
}

export function parsePublicServiceComparison(value: unknown): PublicServiceComparison | null {
  if (!isRecord(value) || !isWithinPublicServiceComparisonSize(value) ||
      !["policyVersion", "status", "reasonCode", "items"].every((key) => Object.hasOwn(value, key)) ||
      Object.keys(value).some((key) => !["policyVersion", "status", "reasonCode", "items", "providerDocumentation"].includes(key)) ||
      value.policyVersion !== PUBLIC_SERVICE_COMPARISON_VERSION ||
      !["pass", "fail", "unknown"].includes(String(value.status)) ||
      !["services_disclosed", "observed_service_undisclosed", "provider_documentation_contradiction", "public_policy_missing", "auditor_error"].includes(String(value.reasonCode)) ||
      !Array.isArray(value.items) || value.items.length > PUBLIC_SERVICE_MAX_ITEMS) return null;
  const items: PublicServiceItem[] = [];
  const seen = new Set<string>();
  for (const item of value.items) {
    if (!isRecord(item) || !exactKeys(item, ["providerId", "observation", "observedDomains", "declaredPurposes"]) ||
        !isProviderIdentifier(item.providerId) || seen.has(item.providerId) ||
        !["observed", "declared", "observed_and_declared"].includes(String(item.observation)) ||
        !stringList(item.observedDomains, 8, isSafeHostname) || !stringList(item.declaredPurposes, 8, isPurposeId)) return null;
    seen.add(item.providerId);
    const expected = item.observedDomains.length > 0 && item.declaredPurposes.length > 0
      ? "observed_and_declared"
      : item.observedDomains.length > 0 ? "observed" : "declared";
    if (item.observation !== expected) return null;
    items.push({
      providerId: item.providerId,
      observation: expected,
      observedDomains: [...item.observedDomains].map((domain) => domain.toLowerCase()),
      declaredPurposes: [...item.declaredPurposes],
    });
  }
  const status = value.status;
  const reasonCode = value.reasonCode;
  const providerDocumentation = value.providerDocumentation === undefined ? []
    : Array.isArray(value.providerDocumentation) && value.providerDocumentation.length <= PUBLIC_SERVICE_MAX_ITEMS
      ? value.providerDocumentation.map(parseProviderDocumentationContradiction)
      : null;
  if (!providerDocumentation || providerDocumentation.some((item) => item === null)) return null;
  const confirmedContradiction = providerDocumentation.some((item) => item?.status === "contradiction_confirmed");
  if ((reasonCode === "auditor_error") !== (status === "unknown") ||
      reasonCode === "observed_service_undisclosed" && (status !== "fail" || !items.some(({ observation }) => observation === "observed")) ||
      reasonCode === "provider_documentation_contradiction" && (status !== "fail" || !confirmedContradiction) ||
      reasonCode === "public_policy_missing" && (status !== "fail" || items.some(({ observation }) => observation === "observed")) ||
      reasonCode === "services_disclosed" && (status !== "pass" || items.some(({ observation }) => observation === "observed") || confirmedContradiction)) return null;
  return {
    policyVersion: PUBLIC_SERVICE_COMPARISON_VERSION,
    status: status as PublicServiceComparison["status"],
    reasonCode: reasonCode as PublicServiceComparison["reasonCode"],
    items,
    ...(providerDocumentation.length ? { providerDocumentation: providerDocumentation as ProviderDocumentationContradiction[] } : {}),
  };
}

function isWithinPublicServiceComparisonSize(value: Record<string, unknown>): boolean {
  try {
    const serialized = JSON.stringify(value);
    return serialized !== undefined && new TextEncoder().encode(serialized).byteLength <= PUBLIC_SERVICE_COMPARISON_MAX_BYTES;
  } catch {
    return false;
  }
}

export function getPublicServiceProviderInfo(providerId: string) {
  return PUBLIC_SERVICE_PROVIDER_INFO[providerId] ?? null;
}

export function normalizePublicServiceProviderId(value: string): string | null {
  const normalized = value.normalize("NFKD").replace(/[\u0300-\u036f]/gu, "").toLowerCase().replace(/[^a-z0-9]+/gu, "-").replace(/^-|-$/gu, "");
  const aliases: Record<string, string> = {
    onetrust: "one-trust-cookie-pro",
    "cookiepro": "one-trust-cookie-pro",
    "google-ads": "google-ads-conversion-linker",
    "conversion-linker": "google-ads-conversion-linker",
    "matomo-analytics": "matomo",
    openai: "openai-api",
    meta: "meta-pixel",
    facebook: "meta-pixel",
    tiktok: "tiktok-pixel",
    linkedin: "linkedin-insight-tag",
  };
  const id = aliases[normalized] ?? normalized;
  return isProviderId(id) ? id : null;
}

function compareIdentifiers(left: string, right: string): number {
  return left.localeCompare(right, "en");
}

function isProviderId(value: unknown): value is string { return typeof value === "string" && PROVIDER_ID.test(value) && Object.hasOwn(PUBLIC_SERVICE_PROVIDER_INFO, value); }
function isProviderIdentifier(value: unknown): value is string { return typeof value === "string" && PROVIDER_ID.test(value); }
function isPurposeId(value: unknown): value is string { return typeof value === "string" && PURPOSE_ID.test(value); }
function isSafeHostname(value: unknown): value is string { return typeof value === "string" && value.length <= 253 && /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)(?:\.(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?))*$/iu.test(value); }
function stringList<T extends string>(value: unknown, max: number, predicate: (item: unknown) => item is T): value is T[] { return Array.isArray(value) && value.length <= max && value.every(predicate) && new Set(value).size === value.length; }
function isRecord(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype; }
function exactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean { return Reflect.ownKeys(value).length === keys.length && keys.every((key) => Object.hasOwn(value, key)); }
