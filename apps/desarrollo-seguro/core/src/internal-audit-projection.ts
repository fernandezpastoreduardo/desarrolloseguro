import {
  parseInternalAuditEvidence,
  type InternalAuditCriterion,
  type InternalAuditEvidence,
} from "./internal-audit-contract.js";
import { parseInternalPrivacyObservation } from "./internal-privacy-observation.js";
import { parseInternalQualityObservation } from "./internal-quality-observation.js";
import { parseSyntheticAuthObservation } from "./internal-synthetic-auth.js";

const ENVELOPE_KINDS = ["synthetic_auth", "quality", "privacy"] as const;
type EnvelopeKind = (typeof ENVELOPE_KINDS)[number];

type ProjectedEvidence = {
  criterionId: InternalAuditCriterion;
  scope: string;
  status: "pass" | "fail" | "unknown" | "not_applicable";
  source: "production_observation" | "synthetic_check";
  observedAt: string;
  reasonCode: string;
};

export function projectInternalAuditEvidence(input: unknown): readonly InternalAuditEvidence[] {
  if (!Array.isArray(input) || input.length === 0 || input.length > 32) {
    throw new Error("internal_audit_projection_invalid");
  }
  const projected = input.map((item) => {
    try {
      return projectEnvelope(item);
    } catch {
      throw new Error("internal_audit_projection_invalid");
    }
  });
  const criterionIds = projected.map((item) => item.criterionId);
  if (new Set(criterionIds).size !== criterionIds.length) {
    throw new Error("internal_audit_projection_duplicate");
  }
  try {
    return projected.map((item) => parseInternalAuditEvidence(item));
  } catch {
    throw new Error("internal_audit_projection_invalid");
  }
}

function projectEnvelope(input: unknown): ProjectedEvidence {
  if (!isRecord(input) || !hasExactKeys(input, ["kind", "observation"]) || !isEnvelopeKind(input.kind)) {
    throw new Error("internal_audit_projection_invalid");
  }
  if (input.kind === "synthetic_auth") {
    const observation = parseSyntheticAuthObservation(input.observation);
    return {
      criterionId: "authentication.authorization",
      scope: "authentication",
      status: observation.status,
      source: "synthetic_check",
      observedAt: observation.observedAt,
      reasonCode: observation.reasonCode,
    };
  }
  if (input.kind === "quality") {
    const observation = parseInternalQualityObservation(input.observation);
    return {
      criterionId: qualityCriterion(observation.kind),
      scope: "quality",
      status: observation.status,
      source: "production_observation",
      observedAt: observation.observedAt,
      reasonCode: observation.metricCode,
    };
  }
  const observation = parseInternalPrivacyObservation(input.observation);
  const criterionId = privacyCriterion(observation.area, observation.signalCode);
  return {
    criterionId,
    scope: criterionScope(criterionId),
    status: observation.status,
    source: "production_observation",
    observedAt: observation.observedAt,
    reasonCode: observation.signalCode,
  };
}

function qualityCriterion(kind: "e2e_flow" | "performance_sample" | "accessibility_snapshot" | "responsive_check"): InternalAuditCriterion {
  if (kind === "accessibility_snapshot") return "quality.accessibility";
  if (kind === "performance_sample") return "performance.page_load";
  return "quality.e2e";
}

function privacyCriterion(
  area: "storage" | "third_party" | "consent" | "transparency" | "data_minimization",
  signalCode: string,
): InternalAuditCriterion {
  if (area === "third_party") return "privacy.third_parties";
  if (area === "consent") return "privacy.consent";
  if (area === "transparency" && signalCode === "ai_disclosure_present") return "ai.disclosure";
  if (area === "transparency") return "ethics.transparency";
  return "privacy.cookies";
}

function criterionScope(criterionId: InternalAuditCriterion): string {
  if (criterionId === "ai.disclosure") return "ai";
  if (criterionId === "ethics.transparency") return "ethics";
  if (criterionId.startsWith("privacy.")) return "privacy";
  if (criterionId.startsWith("performance.")) return "quality";
  if (criterionId.startsWith("quality.")) return "quality";
  return "authentication";
}

function isEnvelopeKind(value: unknown): value is EnvelopeKind {
  return typeof value === "string" && ENVELOPE_KINDS.includes(value as EnvelopeKind);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasExactKeys(value: Record<string, unknown>, required: readonly string[]): boolean {
  const keys = Object.keys(value).sort();
  return keys.length === required.length && required.every((key) => keys.includes(key));
}
