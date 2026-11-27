import {
  PRIVACY_CRITERIA,
  PRIVACY_POLICY_VERSION,
  PRIVACY_SEVERITY_FACTOR,
  type PrivacyCoverageStatus,
  type PrivacyCriterionId,
  type PrivacySeverity,
} from "./privacy-policy.js";

export { PRIVACY_CRITERIA, PRIVACY_POLICY_VERSION } from "./privacy-policy.js";
export type { PrivacyCoverageStatus, PrivacyCriterionId, PrivacySeverity } from "./privacy-policy.js";

export type PrivacyInput = {
  criteria: Array<{
    id: PrivacyCriterionId;
    status: PrivacyCoverageStatus;
    findings: Array<{
      id: string;
      severity: PrivacySeverity;
      confidence: "confirmed" | "unknown";
    }>;
  }>;
};

export type PrivacyCriterionAssessment = {
  id: PrivacyCriterionId;
  label: string;
  status: PrivacyCoverageStatus;
  weight: number;
  deduction: number | null;
  awarded: number | null;
  confirmedFindings: number;
  unknownFindings: number;
};

export type PrivacyAssessment = {
  policyVersion: typeof PRIVACY_POLICY_VERSION | "privacy-v1";
  score: number | null;
  assessedCriteria: number;
  unknownCriteria: number;
  notApplicableCriteria: number;
  totalCriteria: number;
  evidence: {
    cookieNames: string[];
    providers: string[];
    domains: string[];
    cookieAudit?: PrivacyCookieAudit;
  };
  criteria: PrivacyCriterionAssessment[];
};

export type PrivacyCookieCatalogEntry = {
  ruleId: string;
  datasetVersion: string;
  category: string;
  provider: string;
  purpose: string;
  confidence: "high" | "medium" | "low";
  classification: "confirmed" | "unknown";
  sourceUrl: string;
  reviewedAt: string;
};

export type PrivacyCookieEvidenceItem = {
  name: string;
  domain: string;
  secure: boolean;
  httpOnly: boolean;
  ruleIds: string[];
};

export type PrivacyCookieSnapshot = {
  capturedAtMs: number | null;
  complete: boolean;
  cookieCount: number | null;
  matchedCookieCount: number;
  cookies: PrivacyCookieEvidenceItem[];
};

export type PrivacyCookieFlow = {
  status: "evaluated" | "unknown" | "not_applicable";
  beforeChoice: PrivacyCookieSnapshot | null;
  afterChoice: PrivacyCookieSnapshot | null;
  afterReload: PrivacyCookieSnapshot | null;
};

export type PrivacyCookieAudit = {
  catalog: PrivacyCookieCatalogEntry[];
  initial: PrivacyCookieSnapshot | null;
  accept: PrivacyCookieFlow;
  reject: PrivacyCookieFlow;
};

/** Validates the public, derived score shape read from immutable report storage. */
export function parsePrivacyAssessment(input: unknown): PrivacyAssessment | null {
  if (!isRecord(input) || !isOneOf(input.policyVersion, ["privacy-v1", PRIVACY_POLICY_VERSION]) || !Array.isArray(input.criteria) || !isPrivacyEvidence(input.evidence) ||
      input.criteria.length !== PRIVACY_CRITERIA.length ||
      !isScore(input.score) || !isCount(input.assessedCriteria) || !isCount(input.unknownCriteria) ||
      !isCount(input.notApplicableCriteria) || input.totalCriteria !== PRIVACY_CRITERIA.length) return null;
  if (input.policyVersion === PRIVACY_POLICY_VERSION && input.evidence.cookieAudit === undefined) return null;

  const criteria: PrivacyCriterionAssessment[] = [];
  for (const [index, definition] of PRIVACY_CRITERIA.entries()) {
    const row = input.criteria[index];
    if (!isRecord(row) || row.id !== definition.id || row.label !== definition.label || row.weight !== definition.weight ||
        !isCoverageStatus(row.status) || !isNullableScore(row.deduction) || !isNullableScore(row.awarded) ||
        !isCount(row.confirmedFindings) || !isCount(row.unknownFindings)) return null;
    if (row.status === "evaluated" && (row.deduction === null || row.awarded === null ||
        row.deduction < 0 || row.deduction > definition.weight ||
        row.deduction + row.awarded !== definition.weight)) return null;
    if (row.status !== "evaluated" && (row.deduction !== null || row.awarded !== null)) return null;
    criteria.push({
      id: definition.id,
      label: definition.label,
      status: row.status,
      weight: definition.weight,
      deduction: row.deduction,
      awarded: row.awarded,
      confirmedFindings: row.confirmedFindings,
      unknownFindings: row.unknownFindings,
    });
  }
  if (criteria.filter(({ status }) => status === "evaluated").length !== input.assessedCriteria ||
      criteria.filter(({ status }) => status === "unknown").length !== input.unknownCriteria ||
      criteria.filter(({ status }) => status === "not_applicable").length !== input.notApplicableCriteria) return null;
  const assessedWeight = criteria.filter(({ status }) => status === "evaluated")
    .reduce((sum, criterion) => sum + criterion.weight, 0);
  const awardedPoints = criteria.filter(({ status }) => status === "evaluated")
    .reduce((sum, criterion) => sum + (criterion.awarded ?? 0), 0);
  const expectedScore = assessedWeight === 0 ||
    input.policyVersion === PRIVACY_POLICY_VERSION && criteria.some(({ status }) => status === "unknown")
    ? null
    : roundScore(awardedPoints / assessedWeight * 100);
  if (input.score !== expectedScore) return null;
  return {
    policyVersion: input.policyVersion,
    score: input.score,
    assessedCriteria: input.assessedCriteria,
    unknownCriteria: input.unknownCriteria,
    notApplicableCriteria: input.notApplicableCriteria,
    totalCriteria: PRIVACY_CRITERIA.length,
    evidence: input.evidence,
    criteria,
  };
}

const MAX_FINDINGS_PER_CRITERION = 100;

function roundScore(value: number): number {
  return Number(value.toFixed(2));
}

/** Scores only complete, reproducible findings; missing or ambiguous evidence stays unknown. */
export function assessPrivacy(input: unknown): PrivacyAssessment {
  const rows = normalizeCriteria(input);
  const criteria = PRIVACY_CRITERIA.map((definition): PrivacyCriterionAssessment => {
    const row = rows.get(definition.id);
    if (!row || row.status === "unknown") {
      return {
        ...definition,
        status: "unknown",
        deduction: null,
        awarded: null,
        confirmedFindings: 0,
        unknownFindings: row?.findings.length ?? 0,
      };
    }
    if (row.status === "not_applicable") {
      return {
        ...definition,
        status: "not_applicable",
        deduction: null,
        awarded: null,
        confirmedFindings: 0,
        unknownFindings: row.findings.length,
      };
    }

    const confirmed = row.findings.filter((finding) => finding.confidence === "confirmed");
    const unknownFindings = row.findings.length - confirmed.length;
    const deduction = Math.min(
      definition.weight,
      confirmed.reduce((sum, finding) => sum + PRIVACY_SEVERITY_FACTOR[finding.severity], 0),
    );
    return {
      ...definition,
      status: "evaluated",
      deduction,
      awarded: definition.weight - deduction,
      confirmedFindings: confirmed.length,
      unknownFindings,
    };
  });

  const evaluated = criteria.filter((criterion) => criterion.status === "evaluated");
  const assessedWeight = evaluated.reduce((sum, criterion) => sum + criterion.weight, 0);
  const awarded = evaluated.reduce((sum, criterion) => sum + (criterion.awarded ?? 0), 0);
  const unknownCriteria = criteria.filter((criterion) => criterion.status === "unknown").length;

  return {
    policyVersion: PRIVACY_POLICY_VERSION,
    score: assessedWeight === 0 || unknownCriteria > 0 ? null : roundScore((awarded / assessedWeight) * 100),
    assessedCriteria: evaluated.length,
    unknownCriteria,
    notApplicableCriteria: criteria.filter((criterion) => criterion.status === "not_applicable").length,
    totalCriteria: criteria.length,
    evidence: isRecord(input) && isPrivacyEvidence(input.evidence)
      ? input.evidence.cookieAudit === undefined
        ? { ...input.evidence, cookieAudit: emptyPrivacyCookieAudit() }
        : input.evidence
      : { cookieNames: [], providers: [], domains: [], cookieAudit: emptyPrivacyCookieAudit() },
    criteria,
  };
}

type NormalizedCriterion = PrivacyInput["criteria"][number];

function normalizeCriteria(input: unknown): Map<PrivacyCriterionId, NormalizedCriterion> {
  const result = new Map<PrivacyCriterionId, NormalizedCriterion>();
  if (!isRecord(input) || !Array.isArray(input.criteria)) return result;

  for (const value of input.criteria) {
    if (!isRecord(value) || !isPrivacyCriterionId(value.id) || !isCoverageStatus(value.status) || !Array.isArray(value.findings)) continue;
    const findings = value.findings.filter(isPrivacyFinding);
    const candidate = findings.length !== value.findings.length || findings.length > MAX_FINDINGS_PER_CRITERION
      ? { id: value.id, status: "unknown" as const, findings: [] }
      : { id: value.id, status: value.status, findings: uniqueFindings(findings) };
    if (result.has(value.id)) {
      result.set(value.id, { id: value.id, status: "unknown", findings: [] });
      continue;
    }
    result.set(value.id, candidate);
  }
  return result;
}

function uniqueFindings(findings: NormalizedCriterion["findings"]): NormalizedCriterion["findings"] {
  const ids = new Set<string>();
  return findings.filter((finding) => {
    if (ids.has(finding.id)) return false;
    ids.add(finding.id);
    return true;
  });
}

function isPrivacyFinding(value: unknown): value is NormalizedCriterion["findings"][number] {
  return isRecord(value) && typeof value.id === "string" && value.id.length > 0 && value.id.length <= 100 &&
    (value.severity === "low" || value.severity === "medium" || value.severity === "high") &&
    (value.confidence === "confirmed" || value.confidence === "unknown");
}

function isPrivacyCriterionId(value: unknown): value is PrivacyCriterionId {
  return typeof value === "string" && PRIVACY_CRITERIA.some((criterion) => criterion.id === value);
}

function isCoverageStatus(value: unknown): value is PrivacyCoverageStatus {
  return value === "evaluated" || value === "unknown" || value === "not_applicable";
}

function isScore(value: unknown): value is number | null {
  return value === null || typeof value === "number" && Number.isFinite(value) &&
    value >= 0 && value <= 100 && Math.abs(value * 100 - Math.round(value * 100)) < 1e-8;
}

function isNullableScore(value: unknown): value is number | null {
  return isScore(value);
}

function isCount(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 && value <= MAX_FINDINGS_PER_CRITERION * PRIVACY_CRITERIA.length;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isPrivacyEvidence(value: unknown): value is PrivacyAssessment["evidence"] {
  if (!isRecord(value)) return false;
  return isEvidenceList(value.cookieNames, 128) && isEvidenceList(value.providers, 100) &&
    isEvidenceList(value.domains, 253) &&
    (value.cookieAudit === undefined || isPrivacyCookieAudit(value.cookieAudit));
}

function isPrivacyCookieAudit(value: unknown): value is PrivacyCookieAudit {
  if (!isRecord(value) || !Array.isArray(value.catalog) || value.catalog.length > 20 ||
      !value.catalog.every(isPrivacyCookieCatalogEntry) ||
      !(value.initial === null || isPrivacyCookieSnapshot(value.initial)) ||
      !isPrivacyCookieFlow(value.accept) || !isPrivacyCookieFlow(value.reject)) return false;
  return true;
}

function emptyPrivacyCookieAudit(): PrivacyCookieAudit {
  const emptyFlow: PrivacyCookieFlow = { status: "unknown", beforeChoice: null, afterChoice: null, afterReload: null };
  return { catalog: [], initial: null, accept: emptyFlow, reject: emptyFlow };
}

function isPrivacyCookieCatalogEntry(value: unknown): value is PrivacyCookieCatalogEntry {
  if (!isRecord(value) || !isCleanString(value.ruleId, 128) || !isCleanString(value.datasetVersion, 64) ||
      !isCleanString(value.category, 64) || !isCleanString(value.provider, 100) ||
      !isCleanString(value.purpose, 300) || !isOneOf(value.confidence, ["high", "medium", "low"]) ||
      !isOneOf(value.classification, ["confirmed", "unknown"]) || !isCleanString(value.sourceUrl, 500) ||
      !isCleanString(value.reviewedAt, 32)) return false;
  try {
    return new URL(value.sourceUrl).protocol === "https:";
  } catch {
    return false;
  }
}

function isPrivacyCookieFlow(value: unknown): value is PrivacyCookieFlow {
  return isRecord(value) && isOneOf(value.status, ["evaluated", "unknown", "not_applicable"]) &&
    (value.beforeChoice === null || isPrivacyCookieSnapshot(value.beforeChoice)) &&
    (value.afterChoice === null || isPrivacyCookieSnapshot(value.afterChoice)) &&
    (value.afterReload === null || isPrivacyCookieSnapshot(value.afterReload));
}

function isPrivacyCookieSnapshot(value: unknown): value is PrivacyCookieSnapshot {
  if (!isRecord(value) || !(value.capturedAtMs === null || typeof value.capturedAtMs === "number" &&
      Number.isSafeInteger(value.capturedAtMs) && value.capturedAtMs >= 0) ||
      typeof value.complete !== "boolean" || !(value.cookieCount === null || isBoundedCookieCount(value.cookieCount)) ||
      !isBoundedCookieCount(value.matchedCookieCount) || !Array.isArray(value.cookies) || value.cookies.length > 3 ||
      !value.cookies.every(isPrivacyCookieEvidenceItem)) return false;
  if (value.complete !== (value.cookieCount !== null) ||
      value.cookieCount !== null && value.matchedCookieCount > value.cookieCount) return false;
  return new Set(value.cookies.map((cookie) => `${cookie.name}\0${cookie.domain}`)).size === value.cookies.length;
}

function isPrivacyCookieEvidenceItem(value: unknown): value is PrivacyCookieEvidenceItem {
  return isRecord(value) && isCleanString(value.name, 128) && isCleanString(value.domain, 253) &&
    typeof value.secure === "boolean" && typeof value.httpOnly === "boolean" &&
    Array.isArray(value.ruleIds) && value.ruleIds.length <= 3 &&
    value.ruleIds.every((ruleId) => isCleanString(ruleId, 128));
}

function isBoundedCookieCount(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 0 && (value as number) <= 10_000;
}

function isCleanString(value: unknown, maxLength: number): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= maxLength && isCleanEvidenceText(value);
}

function isOneOf<const T extends readonly string[]>(value: unknown, choices: T): value is T[number] {
  return typeof value === "string" && choices.includes(value);
}

function isEvidenceList(value: unknown, maxLength: number): value is string[] {
  return Array.isArray(value) && value.length <= 100 && value.every((item) =>
    typeof item === "string" && item.length > 0 && item.length <= maxLength && isCleanEvidenceText(item),
  ) && new Set(value).size === value.length;
}

function isCleanEvidenceText(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code <= 31 || code === 127) return false;
  }
  return true;
}
