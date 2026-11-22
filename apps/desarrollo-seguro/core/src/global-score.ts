import type { DomainEthicsAssessment } from "./domain-ethics-score.js";
import type { PrivacyAssessment } from "./privacy-score.js";

export const GLOBAL_SCORE_POLICY_VERSION = "mvp-global-v1" as const;
export const GLOBAL_SCORE_WEIGHTS = { ethics: 50, privacy: 50 } as const;

export type GlobalScoreAssessment = {
  policyVersion: typeof GLOBAL_SCORE_POLICY_VERSION;
  status: "scored" | "review" | "not_available";
  score: number | null;
  weights: typeof GLOBAL_SCORE_WEIGHTS;
  ethicsCoverage: { assessedCriteria: number; totalCriteria: number };
  privacyCoverage: {
    assessedCriteria: number;
    unknownCriteria: number;
    notApplicableCriteria: number;
    totalCriteria: number;
  } | null;
};

/** Combines complete ethics and privacy dimensions; incomplete coverage stays under review. */
export function assessGlobalScore(
  ethics: DomainEthicsAssessment,
  privacy: PrivacyAssessment | null,
): GlobalScoreAssessment {
  const ethicsCoverage = {
    assessedCriteria: ethics.assessedCriteria,
    totalCriteria: ethics.totalCriteria,
  };
  const privacyCoverage = privacy === null ? null : {
    assessedCriteria: privacy.assessedCriteria,
    unknownCriteria: privacy.unknownCriteria,
    notApplicableCriteria: privacy.notApplicableCriteria,
    totalCriteria: privacy.totalCriteria,
  };
  const base = {
    policyVersion: GLOBAL_SCORE_POLICY_VERSION,
    weights: GLOBAL_SCORE_WEIGHTS,
    ethicsCoverage,
    privacyCoverage,
  } as const;

  if (privacy === null) {
    return { ...base, status: "not_available", score: null };
  }

  if (ethics.score === null || ethics.assessedCriteria !== ethics.totalCriteria ||
      privacy.score === null || privacy.unknownCriteria !== 0 ||
      privacy.assessedCriteria + privacy.notApplicableCriteria !== privacy.totalCriteria) {
    return { ...base, status: "review", score: null };
  }

  const weightedScore = ethics.score * GLOBAL_SCORE_WEIGHTS.ethics / 100 +
    privacy.score * GLOBAL_SCORE_WEIGHTS.privacy / 100;
  return { ...base, status: "scored", score: Math.round(weightedScore) };
}
