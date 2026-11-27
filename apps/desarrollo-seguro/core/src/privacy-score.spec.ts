import { describe, expect, it } from "vitest";
import { assessPrivacy, parsePrivacyAssessment, PRIVACY_CRITERIA, type PrivacyInput } from "./privacy-score.js";

function criteria(status: PrivacyInput["criteria"][number]["status"] = "evaluated"): PrivacyInput["criteria"] {
  return PRIVACY_CRITERIA.map(({ id }) => ({ id, status, findings: [] }));
}

describe("assessPrivacy", () => {
  it("parses a canonical assessment and rejects altered weights or coverage counts", () => {
    const assessment = assessPrivacy({ criteria: criteria("unknown") });
    expect(parsePrivacyAssessment(assessment)).toEqual(assessment);
    expect(parsePrivacyAssessment({ ...assessment, assessedCriteria: 1 })).toBeNull();
    expect(parsePrivacyAssessment({
      ...assessment,
      criteria: assessment.criteria.map((criterion, index) => index === 0 ? { ...criterion, weight: 99 } : criterion),
    })).toBeNull();
  });

  it("rejects malformed assessment envelopes, criterion arithmetic, and unsafe evidence", () => {
    const assessment = assessPrivacy({ criteria: criteria() });
    expect(parsePrivacyAssessment(null)).toBeNull();
    expect(parsePrivacyAssessment({ ...assessment, criteria: assessment.criteria.slice(1) })).toBeNull();
    expect(parsePrivacyAssessment({
      ...assessment,
      criteria: assessment.criteria.map((criterion, index) => index === 0
        ? { ...criterion, awarded: criterion.awarded! - 1 }
        : criterion),
    })).toBeNull();
    expect(parsePrivacyAssessment({
      ...assessment,
      evidence: { ...assessment.evidence, cookieNames: ["duplicate", "duplicate"] },
    })).toBeNull();
    expect(parsePrivacyAssessment({
      ...assessment,
      evidence: { ...assessment.evidence, domains: ["bad\nhost.example"] },
    })).toBeNull();
  });

  it("reports not-applicable criteria outside the evaluated denominator", () => {
    const input = criteria();
    input[0]!.status = "not_applicable";
    const result = assessPrivacy({ criteria: input });
    expect(result.notApplicableCriteria).toBe(1);
    expect(result.criteria[0]!.awarded).toBeNull();
    expect(parsePrivacyAssessment(result)).toEqual(result);
  });

  it("awards full points when all criteria are evaluated without confirmed findings", () => {
    const result = assessPrivacy({ criteria: criteria() });

    expect(result.score).toBe(100);
    expect(result.assessedCriteria).toBe(5);
    expect(result.unknownCriteria).toBe(0);
    expect(result.totalCriteria).toBe(5);
  });

  it("subtracts absolute severity points and preserves quarter points", () => {
    const input = criteria();
    input[0]!.findings.push({ id: "observed-cookie", severity: "low", confidence: "confirmed" });

    const result = assessPrivacy({ criteria: input });

    expect(result.criteria[0]!.deduction).toBe(0.25);
    expect(result.criteria[0]!.awarded).toBe(29.75);
    expect(result.score).toBe(99.75);
  });

  it("caps accumulated deductions at the criterion weight", () => {
    const input = criteria();
    input[0]!.findings.push(...Array.from({ length: 31 }, (_, index) => ({
      id: `high-${index}`,
      severity: "high" as const,
      confidence: "confirmed" as const,
    })));

    const result = assessPrivacy({ criteria: input });

    expect(result.criteria[0]!.deduction).toBe(30);
    expect(result.score).toBe(70);
  });

  it("withholds the dimension score when any required criterion is unknown", () => {
    const input = criteria();
    input[0]!.status = "unknown";

    const result = assessPrivacy({ criteria: input });

    expect(result.score).toBeNull();
    expect(result.assessedCriteria).toBe(4);
    expect(result.unknownCriteria).toBe(1);
    expect(result.criteria[0]!.awarded).toBeNull();
  });

  it("continues to parse privacy-v1 historical partial scores without reinterpreting them", () => {
    const rows = criteria();
    rows[0]!.status = "unknown";
    const result = assessPrivacy({ criteria: rows });
    const historical = { ...result, policyVersion: "privacy-v1", score: 100 };
    expect(parsePrivacyAssessment(historical)).toMatchObject({ policyVersion: "privacy-v1", score: 100 });
  });

  it("does not penalize unconfirmed findings and treats duplicate criterion rows as unknown", () => {
    const input = criteria();
    input[0]!.findings.push({ id: "uncertain", severity: "high", confidence: "unknown" });

    const withUnknownFinding = assessPrivacy({ criteria: input });
    expect(withUnknownFinding.score).toBe(100);
    expect(withUnknownFinding.criteria[0]!.unknownFindings).toBe(1);

    const withDuplicateCriterion = assessPrivacy({ criteria: [...input, input[0]] });
    expect(withDuplicateCriterion.criteria[0]!.status).toBe("unknown");
    expect(withDuplicateCriterion.score).toBeNull();
    expect(withDuplicateCriterion.assessedCriteria).toBe(4);
  });

  it("deduplicates finding ids so repeated payload entries do not inflate penalties", () => {
    const input = criteria();
    input[0]!.findings.push(
      { id: "same-observation", severity: "high", confidence: "confirmed" },
      { id: "same-observation", severity: "high", confidence: "confirmed" },
    );

    const result = assessPrivacy({ criteria: input });

    expect(result.criteria[0]!.confirmedFindings).toBe(1);
    expect(result.criteria[0]!.deduction).toBe(1);
  });

  it("marks oversized finding sets unknown instead of evaluating unbounded input", () => {
    const input = criteria();
    input[0]!.findings = Array.from({ length: 101 }, (_, index) => ({
      id: `finding-${index}`,
      severity: "high" as const,
      confidence: "confirmed" as const,
    }));

    const result = assessPrivacy({ criteria: input });

    expect(result.criteria[0]!.status).toBe("unknown");
    expect(result.criteria[0]!.deduction).toBeNull();
    expect(result.score).toBeNull();
  });

  it("returns an unknown score when no criterion could be evaluated", () => {
    const result = assessPrivacy({ criteria: criteria("unknown") });

    expect(result.score).toBeNull();
    expect(result.assessedCriteria).toBe(0);
    expect(result.unknownCriteria).toBe(5);
  });
});
