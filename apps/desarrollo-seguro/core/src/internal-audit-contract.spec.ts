import { describe, expect, it } from "vitest";
import {
  parseInternalAuditRequest,
  parseInternalAuditEvidence,
} from "./internal-audit-contract.js";

describe("internal production audit contract", () => {
  it("accepts only the approved Grumphya production target and scopes", () => {
    expect(parseInternalAuditRequest({
      hostname: "grumphya.com",
      environment: "production",
      auditor: "desarrollo-seguro",
      scopes: ["infrastructure", "privacy", "quality"],
      evidenceRetentionDays: 30,
    })).toMatchObject({
      hostname: "grumphya.com",
      environment: "production",
      auditor: "desarrollo-seguro",
    });
  });

  it.each([
    { hostname: "example.com" },
    { environment: "staging" },
    { auditor: "unknown-client" },
    { scopes: ["shell"] },
    { evidenceRetentionDays: 31 },
  ])("rejects an out-of-contract request: %o", (override) => {
    expect(() => parseInternalAuditRequest({
      hostname: "grumphya.com",
      environment: "production",
      auditor: "desarrollo-seguro",
      scopes: ["infrastructure"],
      evidenceRetentionDays: 30,
      ...override,
    })).toThrow("internal_audit_request_invalid");
  });

  it("accepts bounded, redacted evidence and omits free-form details", () => {
    expect(parseInternalAuditEvidence({
      criterionId: "infrastructure.tls",
      scope: "infrastructure",
      status: "pass",
      source: "production_observation",
      observedAt: "2026-11-18T16:00:00.000Z",
      reasonCode: "tls_current_protocol",
    })).toEqual({
      criterionId: "infrastructure.tls",
      scope: "infrastructure",
      status: "pass",
      source: "production_observation",
      observedAt: "2026-11-18T16:00:00.000Z",
      reasonCode: "tls_current_protocol",
    });
  });

  it("rejects raw content, non-allowlisted criteria, and invalid dates", () => {
    expect(() => parseInternalAuditEvidence({
      criterionId: "security.tls",
      scope: "security",
      status: "pass",
      source: "production_observation",
      observedAt: "2026-11-18T16:00:00.000Z",
      reasonCode: "tls_current_protocol",
      html: "private page",
    })).toThrow("internal_audit_evidence_invalid");
    expect(() => parseInternalAuditEvidence({
      criterionId: "infrastructure.shell",
      scope: "infrastructure",
      status: "pass",
      source: "production_observation",
      observedAt: "2026-11-18T16:00:00.000Z",
      reasonCode: "allowed",
    })).toThrow("internal_audit_evidence_invalid");
  });
});
