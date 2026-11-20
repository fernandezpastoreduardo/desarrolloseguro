import { describe, expect, it } from "vitest";
import { assessInternalAudit } from "./internal-audit-score.js";

const ALL_CRITERIA = [
  ["infrastructure.tls", "infrastructure"],
  ["infrastructure.headers", "infrastructure"],
  ["infrastructure.network", "infrastructure"],
  ["application.dependencies", "application"],
  ["application.secrets", "application"],
  ["authentication.authorization", "authentication"],
  ["quality.e2e", "quality"],
  ["quality.accessibility", "quality"],
  ["performance.page_load", "quality"],
  ["privacy.cookies", "privacy"],
  ["privacy.third_parties", "privacy"],
  ["privacy.consent", "privacy"],
  ["ethics.transparency", "ethics"],
  ["ai.disclosure", "ai"],
] as const;

function evidence(status: "pass" | "fail" | "unknown" | "not_applicable", criterion: string, scope: string) {
  return {
    criterionId: criterion,
    scope,
    status,
    source: "production_observation",
    observedAt: "2026-11-18T16:00:00.000Z",
    reasonCode: status === "pass" ? "observed_pass" : "observed_result",
  };
}

describe("internal audit score", () => {
  it("returns a complete independent score when every criterion is observed", () => {
    const result = assessInternalAudit(ALL_CRITERIA.map(([criterion, scope]) => evidence("pass", criterion, scope)));

    expect(result).toMatchObject({
      status: "complete",
      score: 100,
      assessedCriteria: 14,
      totalCriteria: 14,
    });
    expect(result.externalScore).toBeNull();
  });

  it("keeps incomplete evidence from producing an absolute internal score", () => {
    const result = assessInternalAudit([
      evidence("pass", "infrastructure.tls", "infrastructure"),
      evidence("unknown", "infrastructure.headers", "infrastructure"),
    ]);

    expect(result).toMatchObject({ status: "incomplete", score: null, assessedCriteria: 1, totalCriteria: 14 });
    expect(result.reasons).toContain("internal_audit_evidence_incomplete");
  });

  it("keeps the production-shaped six-of-fourteen result incomplete by category", () => {
    const result = assessInternalAudit([
      evidence("pass", "infrastructure.tls", "infrastructure"),
      evidence("pass", "application.dependencies", "application"),
      evidence("pass", "authentication.authorization", "authentication"),
      evidence("pass", "quality.e2e", "quality"),
      evidence("pass", "privacy.cookies", "privacy"),
      evidence("pass", "ai.disclosure", "ai"),
    ]);

    expect(result).toMatchObject({
      status: "incomplete",
      score: null,
      assessedCriteria: 6,
      totalCriteria: 14,
      externalScore: null,
    });
    expect(result.categories).toEqual([
      { scope: "infrastructure", score: null, assessedCriteria: 1, totalCriteria: 3 },
      { scope: "application", score: null, assessedCriteria: 1, totalCriteria: 2 },
      { scope: "authentication", score: 100, assessedCriteria: 1, totalCriteria: 1 },
      { scope: "quality", score: null, assessedCriteria: 1, totalCriteria: 3 },
      { scope: "privacy", score: null, assessedCriteria: 1, totalCriteria: 3 },
      { scope: "ethics", score: null, assessedCriteria: 0, totalCriteria: 1 },
      { scope: "ai", score: 100, assessedCriteria: 1, totalCriteria: 1 },
    ]);
  });

  it("marks critical failures and preserves their weighted score when complete", () => {
    const result = assessInternalAudit(ALL_CRITERIA.map(([criterion, scope]) =>
      evidence(criterion === "infrastructure.tls" ? "fail" : "pass", criterion, scope),
    ));

    expect(result.status).toBe("blocked");
    expect(result.score).toBe(90);
    expect(result.reasons).toContain("internal_audit_critical_failure");
  });

  it("aggregates distinct signals for one criterion without double counting its weight", () => {
    const result = assessInternalAudit([
      evidence("pass", "infrastructure.tls", "infrastructure"),
      evidence("fail", "infrastructure.tls", "infrastructure"),
    ]);

    expect(result).toMatchObject({
      status: "blocked",
      score: null,
      assessedCriteria: 1,
    });
    expect(result.reasons).toContain("internal_audit_critical_failure");
  });
});
