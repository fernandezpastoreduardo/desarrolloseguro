import {
  assessInternalAudit,
  type InternalAuditAssessment,
} from "./internal-audit-score.js";
import type { InternalAuditEvidence } from "./internal-audit-contract.js";
import { projectInternalAuditEvidence } from "./internal-audit-projection.js";

const HASH = /^sha256:[a-f0-9]{64}$/u;

export type InternalAuditReport = {
  policyVersion: "beta-d-0.1";
  hostname: "grumphya.com";
  environment: "production";
  auditRef: string;
  observedAt: string;
  evidence: readonly InternalAuditEvidence[];
  assessment: InternalAuditAssessment;
};

export function buildInternalAuditReport(input: unknown): InternalAuditReport {
  if (!isRecord(input) || !hasExactKeys(input, ["auditRef", "observedAt", "observations"])) {
    throw new Error("internal_audit_report_invalid");
  }
  const auditRef = input.auditRef;
  const observedAt = input.observedAt;
  if (
    typeof auditRef !== "string" ||
    !HASH.test(auditRef) ||
    typeof observedAt !== "string" ||
    !isIsoDate(observedAt) ||
    !Array.isArray(input.observations)
  ) {
    throw new Error("internal_audit_report_invalid");
  }
  try {
    const evidence = projectInternalAuditEvidence(input.observations);
    if (evidence.some((item) => Date.parse(item.observedAt) > Date.parse(observedAt))) {
      throw new Error("internal_audit_report_future_evidence");
    }
    const assessment = assessInternalAudit(evidence);
    return {
      policyVersion: "beta-d-0.1",
      hostname: "grumphya.com",
      environment: "production",
      auditRef,
      observedAt,
      evidence,
      assessment,
    };
  } catch {
    throw new Error("internal_audit_report_invalid");
  }
}

function isIsoDate(value: string): boolean {
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) && new Date(timestamp).toISOString() === value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasExactKeys(value: Record<string, unknown>, required: readonly string[]): boolean {
  const keys = Object.keys(value);
  return keys.length === required.length && required.every((key) => keys.includes(key));
}
