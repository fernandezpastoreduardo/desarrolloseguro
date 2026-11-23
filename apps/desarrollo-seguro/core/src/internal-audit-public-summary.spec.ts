import { describe, expect, it } from "vitest";
import { INTERNAL_AUDIT_CRITERIA } from "./internal-audit-contract.js";
import type { InternalAuditReport } from "./internal-audit-report.js";
import { parseInternalAuditPublicSummary, toInternalAuditPublicSummary } from "./internal-audit-public-summary.js";

const ids = Object.keys(INTERNAL_AUDIT_CRITERIA) as (keyof typeof INTERNAL_AUDIT_CRITERIA)[];
const observedAt = "2026-11-23T08:00:00.000Z";

function makeReport(status: "complete" | "blocked" | "incomplete" = "complete"): InternalAuditReport {
  return {
    policyVersion: "beta-d-0.1",
    hostname: "grumphya.com",
    environment: "production",
    auditRef: `sha256:${"a".repeat(64)}`,
    observedAt,
    evidence: ids.map((criterionId, index) => ({
      criterionId,
      scope: INTERNAL_AUDIT_CRITERIA[criterionId],
      status: status === "incomplete" && index === 0 ? "unknown" : criterionId === "application.secrets" ? "fail" : "pass",
      source: "production_observation",
      observedAt,
      reasonCode: "safe_allowlisted_code",
      ...(criterionId === "performance.page_load" ? { value: 2_400, unit: "milliseconds" as const, limit: 2_500 } : {}),
    })),
    assessment: {
      policyVersion: "beta-d-0.1",
      status,
      score: 90,
      externalScore: null,
      assessedCriteria: 14,
      totalCriteria: 14,
      categories: [],
      reasons: [],
    },
  } as unknown as InternalAuditReport;
}

describe("public internal audit summary", () => {
  it("publishes the 14 aggregated states without internal score or evidence", () => {
    const summary = toInternalAuditPublicSummary(makeReport("blocked"));

    expect(summary).toMatchObject({
      policyVersion: "internal-audit-public-v1",
      status: "complete",
      observedAt,
      criteria: expect.arrayContaining([
        { id: "application.secrets", status: "fail" },
        { id: "privacy.cookies", status: "pass" },
      ]),
    });
    expect(summary.criteria).toHaveLength(14);
    expect(Object.keys(summary).sort()).toEqual(["criteria", "observedAt", "policyVersion", "status"]);
    expect(JSON.stringify(summary)).not.toContain("internalScore");
    expect(JSON.stringify(summary)).not.toContain("reasonCode");
    expect(JSON.stringify(summary)).not.toContain("2400");
  });

  it("turns an incomplete run into a full review state instead of reusing partial results", () => {
    const summary = toInternalAuditPublicSummary(makeReport("incomplete"));
    expect(summary.status).toBe("review");
    expect(summary.observedAt).toBe(observedAt);
    expect(summary.criteria).toHaveLength(14);
    expect(summary.criteria.every((criterion) => criterion.status === "unknown")).toBe(true);
  });

  it("returns a review state when no report is available", () => {
    const summary = toInternalAuditPublicSummary(null);
    expect(summary.status).toBe("review");
    expect(summary.observedAt).toBeNull();
    expect(summary.criteria).toHaveLength(14);
  });

  it("rejects duplicate criteria and extra private fields from public persistence", () => {
    const summary = toInternalAuditPublicSummary(makeReport());
    expect(parseInternalAuditPublicSummary({ ...summary, internalScore: 90 })).toBeNull();
    expect(parseInternalAuditPublicSummary({
      ...summary,
      criteria: [...summary.criteria.slice(0, 13), summary.criteria[0]],
    })).toBeNull();
  });
});
