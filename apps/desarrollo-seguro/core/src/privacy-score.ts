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
  policyVersion: typeof PRIVACY_POLICY_VERSION;
  score: number | null;
  assessedCriteria: number;
  unknownCriteria: number;
  notApplicableCriteria: number;
  totalCriteria: number;
  evidence: { cookieNames: string[]; providers: string[]; domains: string[] };
  criteria: PrivacyCriterionAssessment[];
};

/** Validates the public, derived score shape read from immutable report storage. */
export function parsePrivacyAssessment(input: unknown): PrivacyAssessment | null {
  if (!isRecord(input) || input.policyVersion !== PRIVACY_POLICY_VERSION || !Array.isArray(input.criteria) || !isPrivacyEvidence(input.evidence) ||
      input.criteria.length !== PRIVACY_CRITERIA.length ||
      !isScore(input.score) || !isCount(input.assessedCriteria) || !isCount(input.unknownCriteria) ||
      !isCount(input.notApplicableCriteria) || input.totalCriteria !== PRIVACY_CRITERIA.length) return null;

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
  const expectedScore = assessedWeight === 0 ? null : roundScore(awardedPoints / assessedWeight * 100);
  if (input.score !== expectedScore) return null;
  return {
    policyVersion: PRIVACY_POLICY_VERSION,
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

  return {
    policyVersion: PRIVACY_POLICY_VERSION,
    score: assessedWeight === 0 ? null : roundScore((awarded / assessedWeight) * 100),
    assessedCriteria: evaluated.length,
    unknownCriteria: criteria.filter((criterion) => criterion.status === "unknown").length,
    notApplicableCriteria: criteria.filter((criterion) => criterion.status === "not_applicable").length,
    totalCriteria: criteria.length,
    evidence: isRecord(input) && isPrivacyEvidence(input.evidence) ? input.evidence : { cookieNames: [], providers: [], domains: [] },
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
  return isEvidenceList(value.cookieNames, 128) && isEvidenceList(value.providers, 100) && isEvidenceList(value.domains, 253);
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
