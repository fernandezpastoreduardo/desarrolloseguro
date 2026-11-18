import {
  INTERNAL_AUDIT_CRITERIA,
  parseInternalAuditEvidence,
  type InternalAuditCriterion,
  type InternalAuditEvidence,
} from "./internal-audit-contract.js";

const CRITERION_WEIGHTS: Readonly<Record<InternalAuditCriterion, number>> = {
  "infrastructure.tls": 10,
  "infrastructure.headers": 5,
  "infrastructure.network": 5,
  "application.dependencies": 6,
  "application.secrets": 9,
  "authentication.authorization": 15,
  "quality.e2e": 5,
  "quality.accessibility": 5,
  "performance.page_load": 5,
  "privacy.cookies": 5,
  "privacy.third_parties": 5,
  "privacy.consent": 5,
  "ethics.transparency": 10,
  "ai.disclosure": 10,
};
const CRITICAL_CRITERIA: ReadonlySet<InternalAuditCriterion> = new Set([
  "infrastructure.tls",
  "application.secrets",
  "authentication.authorization",
]);

export type InternalAuditCategoryResult = {
  scope: string;
  score: number | null;
  assessedCriteria: number;
  totalCriteria: number;
};

export type InternalAuditAssessment = {
  policyVersion: "beta-d-0.1";
  status: "complete" | "incomplete" | "blocked";
  score: number | null;
  externalScore: null;
  assessedCriteria: number;
  totalCriteria: number;
  categories: readonly InternalAuditCategoryResult[];
  reasons: readonly string[];
};

export function assessInternalAudit(input: unknown): InternalAuditAssessment {
  if (!Array.isArray(input)) {
    throw new Error("internal_audit_evidence_invalid");
  }
  const evidence = input.map((item) => parseInternalAuditEvidence(item));
  const byCriterion = new Map<InternalAuditCriterion, InternalAuditEvidence>();
  for (const item of evidence) {
    if (byCriterion.has(item.criterionId)) {
      throw new Error("internal_audit_evidence_duplicate");
    }
    byCriterion.set(item.criterionId, item);
  }

  const criteria = Object.keys(INTERNAL_AUDIT_CRITERIA) as InternalAuditCriterion[];
  const assessed = criteria.filter((criterion) => {
    const status = byCriterion.get(criterion)?.status;
    return status === "pass" || status === "fail";
  });
  const incomplete = criteria.some((criterion) => {
    const status = byCriterion.get(criterion)?.status;
    return status === undefined || status === "unknown";
  });
  const criticalFailure = criteria.some((criterion) =>
    CRITICAL_CRITERIA.has(criterion) && byCriterion.get(criterion)?.status === "fail",
  );
  const assessedWeight = assessed.reduce(
    (total, criterion) => total + CRITERION_WEIGHTS[criterion],
    0,
  );
  const passedWeight = assessed.reduce(
    (total, criterion) =>
      total + (byCriterion.get(criterion)?.status === "pass" ? CRITERION_WEIGHTS[criterion] : 0),
    0,
  );
  const score = !incomplete && assessedWeight > 0
    ? Math.round((passedWeight / assessedWeight) * 100)
    : null;
  const reasons = [];
  if (incomplete) reasons.push("internal_audit_evidence_incomplete");
  if (criticalFailure) reasons.push("internal_audit_critical_failure");
  if (assessed.length === 0) reasons.push("internal_audit_no_conclusive_evidence");

  return {
    policyVersion: "beta-d-0.1",
    status: criticalFailure ? "blocked" : incomplete ? "incomplete" : "complete",
    score,
    externalScore: null,
    assessedCriteria: assessed.length,
    totalCriteria: criteria.length,
    categories: buildCategoryResults(criteria, byCriterion),
    reasons,
  };
}

function buildCategoryResults(
  criteria: readonly InternalAuditCriterion[],
  evidence: ReadonlyMap<InternalAuditCriterion, InternalAuditEvidence>,
): readonly InternalAuditCategoryResult[] {
  const scopes = [...new Set(criteria.map((criterion) => INTERNAL_AUDIT_CRITERIA[criterion]))];
  return scopes.map((scope) => {
    const scopeCriteria = criteria.filter((criterion) => INTERNAL_AUDIT_CRITERIA[criterion] === scope);
    const assessed = scopeCriteria.filter((criterion) => {
      const status = evidence.get(criterion)?.status;
      return status === "pass" || status === "fail";
    });
    const incomplete = scopeCriteria.some((criterion) => {
      const status = evidence.get(criterion)?.status;
      return status === undefined || status === "unknown";
    });
    const assessedWeight = assessed.reduce((total, criterion) => total + CRITERION_WEIGHTS[criterion], 0);
    const passedWeight = assessed.reduce(
      (total, criterion) => total + (evidence.get(criterion)?.status === "pass" ? CRITERION_WEIGHTS[criterion] : 0),
      0,
    );
    return {
      scope,
      score: !incomplete && assessedWeight > 0 ? Math.round((passedWeight / assessedWeight) * 100) : null,
      assessedCriteria: assessed.length,
      totalCriteria: scopeCriteria.length,
    };
  });
}
