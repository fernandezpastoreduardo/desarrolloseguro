export const PUBLIC_POLICY_ASSESSMENT_VERSION = "public-policy-v1" as const;
export const PUBLIC_POLICY_MAX_LINKS = 30;
export const PUBLIC_POLICY_MAX_PAGES = 30;
export const PUBLIC_POLICY_MAX_PROVIDERS_MISSING_PURPOSE = 30;
export const PUBLIC_POLICY_MAX_PROVIDER_MENTIONS = 300;

export const PUBLIC_POLICY_CATEGORIES = [
  "analytics",
  "advertising",
  "social",
  "consent",
  "other",
] as const;

export type PublicPolicyCategory = (typeof PUBLIC_POLICY_CATEGORIES)[number];
export type PublicPolicyStatus = "pass" | "fail" | "unknown";
export type PublicPolicyReasonCode =
  | "disclosure_found"
  | "policy_link_missing"
  | "policy_content_missing"
  | "policy_page_unavailable"
  | "service_purpose_missing"
  | "access_denied"
  | "auditor_error"
  | "budget_exhausted";

export type PublicPolicyTransparencyAssessment = {
  policyVersion: typeof PUBLIC_POLICY_ASSESSMENT_VERSION;
  status: PublicPolicyStatus;
  reasonCode: PublicPolicyReasonCode;
  evidence: {
    linksFound: number;
    pagesInspected: number;
    unavailablePages: number;
    accessDeniedPages: number;
    providerMentions: number;
    providersMissingPurpose: number;
    categories: PublicPolicyCategory[];
  };
};

/** Builds only a fixed, bounded projection; caller-supplied text and URLs are never retained. */
export function assessPublicPolicyTransparency(input: {
  linksFound: number;
  pagesInspected: number;
  unavailablePages: number;
  accessDeniedPages: number;
  providerMentions: number;
  providersMissingPurpose: number;
  categories: readonly unknown[];
  auditorError?: boolean;
  budgetExhausted?: boolean;
}): PublicPolicyTransparencyAssessment {
  const evidence = sanitizePublicPolicyEvidence(input);
  if (!isCount(input.linksFound, PUBLIC_POLICY_MAX_LINKS) ||
      !isCount(input.pagesInspected, PUBLIC_POLICY_MAX_PAGES) ||
      !isCount(input.unavailablePages, PUBLIC_POLICY_MAX_PAGES) ||
      !isCount(input.accessDeniedPages, PUBLIC_POLICY_MAX_PAGES) ||
      !isCount(input.providerMentions, PUBLIC_POLICY_MAX_PROVIDER_MENTIONS) ||
      !isCount(input.providersMissingPurpose, PUBLIC_POLICY_MAX_PROVIDERS_MISSING_PURPOSE) ||
      input.providersMissingPurpose > input.providerMentions ||
      !isCategoryList(input.categories)) {
    return { policyVersion: PUBLIC_POLICY_ASSESSMENT_VERSION, status: "unknown", reasonCode: "auditor_error", evidence };
  }
  if (evidence.accessDeniedPages > 0) {
    return { policyVersion: PUBLIC_POLICY_ASSESSMENT_VERSION, status: "fail", reasonCode: "access_denied", evidence };
  }
  if (evidence.unavailablePages > 0) {
    return { policyVersion: PUBLIC_POLICY_ASSESSMENT_VERSION, status: "fail", reasonCode: "policy_page_unavailable", evidence };
  }
  if (input.auditorError) {
    return { policyVersion: PUBLIC_POLICY_ASSESSMENT_VERSION, status: "unknown", reasonCode: "auditor_error", evidence };
  }
  if (input.budgetExhausted) {
    return { policyVersion: PUBLIC_POLICY_ASSESSMENT_VERSION, status: "unknown", reasonCode: "budget_exhausted", evidence };
  }
  if (evidence.linksFound === 0) {
    return { policyVersion: PUBLIC_POLICY_ASSESSMENT_VERSION, status: "fail", reasonCode: "policy_link_missing", evidence };
  }
  if (evidence.pagesInspected === 0) {
    return { policyVersion: PUBLIC_POLICY_ASSESSMENT_VERSION, status: "fail", reasonCode: "policy_content_missing", evidence };
  }
  if (evidence.providerMentions === 0 || evidence.providersMissingPurpose > 0 || evidence.categories.length === 0) {
    return { policyVersion: PUBLIC_POLICY_ASSESSMENT_VERSION, status: "fail", reasonCode: "service_purpose_missing", evidence };
  }
  return { policyVersion: PUBLIC_POLICY_ASSESSMENT_VERSION, status: "pass", reasonCode: "disclosure_found", evidence };
}

/** Parses database and IPC values without retaining unknown fields or raw content. */
export function parsePublicPolicyTransparencyAssessment(input: unknown): PublicPolicyTransparencyAssessment | null {
  if (!isRecord(input) || !hasExactKeys(input, ["policyVersion", "status", "reasonCode", "evidence"]) ||
      input.policyVersion !== PUBLIC_POLICY_ASSESSMENT_VERSION ||
      !isStatus(input.status) || !isReasonCode(input.reasonCode) || !isRecord(input.evidence) ||
      !hasExactKeys(input.evidence, ["linksFound", "pagesInspected", "unavailablePages", "accessDeniedPages", "providerMentions", "providersMissingPurpose", "categories"])) {
    return null;
  }
  const rawEvidence = input.evidence;
  if (!isCount(rawEvidence.linksFound, PUBLIC_POLICY_MAX_LINKS) ||
      !isCount(rawEvidence.pagesInspected, PUBLIC_POLICY_MAX_PAGES) ||
      !isCount(rawEvidence.unavailablePages, PUBLIC_POLICY_MAX_PAGES) ||
      !isCount(rawEvidence.accessDeniedPages, PUBLIC_POLICY_MAX_PAGES) ||
      !isCount(rawEvidence.providerMentions, PUBLIC_POLICY_MAX_PROVIDER_MENTIONS) ||
      !isCount(rawEvidence.providersMissingPurpose, PUBLIC_POLICY_MAX_PROVIDERS_MISSING_PURPOSE) ||
      (rawEvidence.providersMissingPurpose as number) > (rawEvidence.providerMentions as number) ||
      !isCategoryList(rawEvidence.categories)) {
    return null;
  }

  const candidate = input as unknown as PublicPolicyTransparencyAssessment;
  const unknownReason = candidate.reasonCode === "auditor_error" || candidate.reasonCode === "budget_exhausted";
  const hasConclusiveRemoteFailure = candidate.evidence.accessDeniedPages > 0 || candidate.evidence.unavailablePages > 0;
  if (unknownReason && hasConclusiveRemoteFailure) return null;
  const expected = unknownReason
    ? { status: "unknown" as const, reasonCode: candidate.reasonCode }
    : deriveStatusAndReason(candidate.evidence);
  if (candidate.status !== expected.status || candidate.reasonCode !== expected.reasonCode) return null;
  return {
    policyVersion: PUBLIC_POLICY_ASSESSMENT_VERSION,
    status: candidate.status,
    reasonCode: candidate.reasonCode,
    evidence: {
      linksFound: candidate.evidence.linksFound,
      pagesInspected: candidate.evidence.pagesInspected,
      unavailablePages: candidate.evidence.unavailablePages,
      accessDeniedPages: candidate.evidence.accessDeniedPages,
      providerMentions: candidate.evidence.providerMentions,
      providersMissingPurpose: candidate.evidence.providersMissingPurpose,
      categories: [...candidate.evidence.categories],
    },
  };
}

function sanitizePublicPolicyEvidence(input: {
  linksFound: number;
  pagesInspected: number;
  unavailablePages: number;
  accessDeniedPages: number;
  providerMentions: number;
  providersMissingPurpose: number;
  categories: readonly unknown[];
}): PublicPolicyTransparencyAssessment["evidence"] {
  const categories = isCategoryList(input.categories)
    ? [...new Set(input.categories)]
    : [];
  return {
    linksFound: clampCount(input.linksFound, PUBLIC_POLICY_MAX_LINKS),
    pagesInspected: clampCount(input.pagesInspected, PUBLIC_POLICY_MAX_PAGES),
    unavailablePages: clampCount(input.unavailablePages, PUBLIC_POLICY_MAX_PAGES),
    accessDeniedPages: clampCount(input.accessDeniedPages, PUBLIC_POLICY_MAX_PAGES),
    providerMentions: clampCount(input.providerMentions, PUBLIC_POLICY_MAX_PROVIDER_MENTIONS),
    providersMissingPurpose: clampCount(input.providersMissingPurpose, PUBLIC_POLICY_MAX_PROVIDERS_MISSING_PURPOSE),
    categories,
  };
}

function deriveStatusAndReason(evidence: PublicPolicyTransparencyAssessment["evidence"]): {
  status: PublicPolicyStatus;
  reasonCode: PublicPolicyReasonCode;
} {
  if (evidence.accessDeniedPages > 0) return { status: "fail", reasonCode: "access_denied" };
  if (evidence.unavailablePages > 0) return { status: "fail", reasonCode: "policy_page_unavailable" };
  if (evidence.linksFound === 0) return { status: "fail", reasonCode: "policy_link_missing" };
  if (evidence.pagesInspected === 0) return { status: "fail", reasonCode: "policy_content_missing" };
  if (evidence.providerMentions === 0 || evidence.providersMissingPurpose > 0 || evidence.categories.length === 0) {
    return { status: "fail", reasonCode: "service_purpose_missing" };
  }
  return { status: "pass", reasonCode: "disclosure_found" };
}

function isCount(input: unknown, maximum: number): input is number {
  return Number.isSafeInteger(input) && (input as number) >= 0 && (input as number) <= maximum;
}

function clampCount(input: number, maximum: number): number {
  if (!Number.isSafeInteger(input) || input < 0) return 0;
  return Math.min(input, maximum);
}

function isCategoryList(input: unknown): input is PublicPolicyCategory[] {
  return Array.isArray(input) && input.length <= PUBLIC_POLICY_CATEGORIES.length &&
    input.every((category, index) => isPublicPolicyCategory(category) && input.indexOf(category) === index);
}

function isPublicPolicyCategory(input: unknown): input is PublicPolicyCategory {
  return typeof input === "string" && PUBLIC_POLICY_CATEGORIES.includes(input as PublicPolicyCategory);
}

function isStatus(input: unknown): input is PublicPolicyStatus {
  return input === "pass" || input === "fail" || input === "unknown";
}

function isReasonCode(input: unknown): input is PublicPolicyReasonCode {
  return input === "disclosure_found" || input === "policy_link_missing" ||
    input === "policy_content_missing" || input === "service_purpose_missing" ||
    input === "policy_page_unavailable" || input === "access_denied" ||
    input === "auditor_error" || input === "budget_exhausted";
}

function isRecord(input: unknown): input is Record<string, unknown> {
  return typeof input === "object" && input !== null && !Array.isArray(input) &&
    Object.getPrototypeOf(input) === Object.prototype;
}

function hasExactKeys(input: Record<string, unknown>, keys: readonly string[]): boolean {
  const actual = Reflect.ownKeys(input);
  return actual.length === keys.length && keys.every((key) => Object.hasOwn(input, key));
}
