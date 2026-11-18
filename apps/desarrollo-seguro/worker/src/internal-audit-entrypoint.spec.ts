import { describe, expect, it } from "vitest";
import { formatInternalAuditCompletion } from "./internal-audit-entrypoint.js";

describe("internal audit entrypoint output", () => {
  it("emits only a bounded private score summary with external score separated", () => {
    const output = formatInternalAuditCompletion({
      policyVersion: "beta-d-0.1",
      hostname: "grumphya.com",
      environment: "production",
      auditRef: `sha256:${"a".repeat(64)}`,
      observedAt: "2026-11-19T00:00:00.000Z",
      evidence: [{
        criterionId: "ai.disclosure",
        scope: "ai",
        status: "pass",
        source: "production_observation",
        observedAt: "2026-11-19T00:00:00.000Z",
        reasonCode: "ai_disclosure_present",
      }],
      assessment: {
        policyVersion: "beta-d-0.1",
        status: "incomplete",
        score: null,
        externalScore: null,
        assessedCriteria: 1,
        totalCriteria: 14,
        categories: [{ scope: "ai", score: null, assessedCriteria: 1, totalCriteria: 1 }],
        reasons: ["internal_audit_evidence_incomplete"],
      },
    });

    expect(JSON.parse(output)).toEqual({
      event: "internal_audit_completed",
      policyVersion: "beta-d-0.1",
      auditRef: `sha256:${"a".repeat(64)}`,
      observedAt: "2026-11-19T00:00:00.000Z",
      status: "incomplete",
      internalScore: null,
      externalScore: null,
      assessedCriteria: 1,
      totalCriteria: 14,
      categories: [{ scope: "ai", score: null, assessedCriteria: 1, totalCriteria: 1 }],
    });
    expect(output).not.toContain("ai_disclosure_present");
  });
});
