import { describe, expect, it } from "vitest";
import { buildInternalAuditReport } from "./internal-audit-report.js";

const sampleRef = `sha256:${"a".repeat(64)}`;
const auditRef = `sha256:${"b".repeat(64)}`;
const observedAt = "2026-11-18T18:30:00.000Z";

describe("internal audit report", () => {
  it("builds a redacted internal report without an external score", () => {
    const report = buildInternalAuditReport({
      auditRef,
      observedAt,
      observations: [
        {
          kind: "synthetic_auth",
          observation: {
            flow: "authorization_boundary",
            status: "pass",
            principalClass: "synthetic_auditor",
            subjectRef: sampleRef,
            observedAt,
            reasonCode: "cross_account_denied",
          },
        },
      ],
    });

    expect(report).toMatchObject({
      policyVersion: "beta-d-0.1",
      hostname: "grumphya.com",
      environment: "production",
      auditRef,
      observedAt,
      assessment: {
        status: "incomplete",
        score: null,
        externalScore: null,
      },
    });
    expect(report.evidence).toEqual([
      expect.objectContaining({
        criterionId: "authentication.authorization",
        source: "synthetic_check",
      }),
    ]);
  });

  it("rejects raw report content and invalid audit references", () => {
    expect(() => buildInternalAuditReport({
      auditRef: "report-id",
      observedAt,
      observations: [],
    })).toThrow("internal_audit_report_invalid");
    expect(() => buildInternalAuditReport({
      auditRef,
      observedAt,
      observations: [{ html: "<body>" }],
    })).toThrow("internal_audit_report_invalid");
  });

  it("rejects evidence observed after the report timestamp", () => {
    expect(() => buildInternalAuditReport({
      auditRef,
      observedAt,
      observations: [{
        kind: "quality",
        observation: {
          kind: "performance_sample",
          status: "pass",
          metricCode: "response_time",
          value: 200,
          unit: "milliseconds",
          sampleRef,
          observedAt: "2026-11-18T18:30:01.000Z",
        },
      }],
    })).toThrow("internal_audit_report_invalid");
  });
});
