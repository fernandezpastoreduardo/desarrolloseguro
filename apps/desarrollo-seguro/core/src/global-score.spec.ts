import { describe, expect, it } from "vitest";
import { assessGlobalScore } from "./global-score.js";
import type { DomainEthicsAssessment } from "./domain-ethics-score.js";
import type { PrivacyAssessment } from "./privacy-score.js";

const ETHICS: DomainEthicsAssessment = {
  policyVersion: "domain-ethics-v3",
  score: 90,
  assessedCriteria: 8,
  totalCriteria: 8,
  maturity: "broad",
  criteria: [],
  reasons: [],
  interpretation: "",
};

const PRIVACY: PrivacyAssessment = {
  policyVersion: "privacy-v1",
  score: 99,
  assessedCriteria: 3,
  unknownCriteria: 0,
  notApplicableCriteria: 2,
  totalCriteria: 5,
  evidence: { cookieNames: [], providers: [], domains: [] },
  criteria: [],
};

describe("assessGlobalScore", () => {
  it("combines complete dimensions with equal published weights and rounds to an integer", () => {
    expect(assessGlobalScore(ETHICS, PRIVACY)).toMatchObject({
      policyVersion: "mvp-global-v1",
      status: "scored",
      score: 95,
      weights: { ethics: 50, privacy: 50 },
    });
  });

  it("keeps the global score under review if either dimension has unknown coverage", () => {
    const partialEthics = { ...ETHICS, assessedCriteria: 7 };
    expect(assessGlobalScore(partialEthics, PRIVACY)).toMatchObject({
      status: "review",
      score: null,
    });
    expect(assessGlobalScore(ETHICS, { ...PRIVACY, unknownCriteria: 1, notApplicableCriteria: 1 }))
      .toMatchObject({ status: "review", score: null });
  });

  it("does not invent a global score for a historical report without Solistos", () => {
    expect(assessGlobalScore(ETHICS, null)).toMatchObject({
      status: "not_available",
      score: null,
      privacyCoverage: null,
    });
  });
});
