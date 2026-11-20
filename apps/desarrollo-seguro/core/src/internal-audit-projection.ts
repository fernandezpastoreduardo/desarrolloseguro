import {
  INTERNAL_AUDIT_CRITERIA,
  parseInternalAuditEvidence,
  type InternalAuditCriterion,
  type InternalAuditEvidence,
} from "./internal-audit-contract.js";
import { parseInternalDeploymentAttestation } from "./internal-deployment-attestation.js";
import { parseInternalDependencyInventory } from "./internal-dependency-inventory.js";
import { parseInternalInfrastructureSnapshot } from "./internal-infrastructure.js";
import { parseInternalPrivacyObservation } from "./internal-privacy-observation.js";
import { parseInternalQualityObservation } from "./internal-quality-observation.js";
import { parseSyntheticAuthObservation } from "./internal-synthetic-auth.js";
import {
  parseInternalAuditSignalEnvelope,
  signalCriteriaForResource,
  type InternalAuditSignalEnvelope,
} from "./internal-audit-signal-envelope.js";

const ENVELOPE_KINDS = [
  "synthetic_auth",
  "quality",
  "privacy",
  "ai",
  "deployment_attestation",
  "infrastructure_snapshot",
  "dependency_inventory",
] as const;
type EnvelopeKind = (typeof ENVELOPE_KINDS)[number];

type ProjectedEvidence = {
  criterionId: InternalAuditCriterion;
  scope: string;
  status: "pass" | "fail" | "unknown" | "not_applicable";
  source: "production_observation" | "synthetic_check" | "deployment_attestation";
  observedAt: string;
  reasonCode: string;
  value?: number | null;
  unit?: "boolean" | "count" | "milliseconds";
  limit?: number;
};

export function projectInternalAuditEvidence(input: unknown): readonly InternalAuditEvidence[] {
  if (!Array.isArray(input) || input.length === 0 || input.length > 32) {
    throw new Error("internal_audit_projection_invalid");
  }
  const projected = input.flatMap((item) => {
    try {
      return projectEnvelope(item);
    } catch {
      throw new Error("internal_audit_projection_invalid");
    }
  });
  const signalKeys = projected.map((item) => `${item.criterionId}:${item.reasonCode}`);
  if (new Set(signalKeys).size !== signalKeys.length) {
    throw new Error("internal_audit_projection_duplicate");
  }
  try {
    return projected.map((item) => parseInternalAuditEvidence(item));
  } catch {
    throw new Error("internal_audit_projection_invalid");
  }
}

function projectEnvelope(input: unknown): readonly ProjectedEvidence[] {
  if (!isRecord(input) || !hasExactKeys(input, ["kind", "observation"]) || !isEnvelopeKind(input.kind)) {
    throw new Error("internal_audit_projection_invalid");
  }
  if (input.kind === "synthetic_auth") {
    if (isSignalEnvelope(input.observation)) {
      return projectSignals(input.observation, "synthetic_browser_flow", "synthetic_check");
    }
    const observation = parseSyntheticAuthObservation(input.observation);
    return [{
      criterionId: "authentication.authorization",
      scope: "authentication",
      status: observation.status,
      source: "synthetic_check",
      observedAt: observation.observedAt,
      reasonCode: observation.reasonCode,
    }];
  }
  if (input.kind === "quality") {
    if (isSignalEnvelope(input.observation)) {
      return projectSignals(input.observation, "performance_observation", "production_observation");
    }
    const observation = parseInternalQualityObservation(input.observation);
    return [{
      criterionId: qualityCriterion(observation.kind),
      scope: "quality",
      status: observation.status,
      source: "production_observation",
      observedAt: observation.observedAt,
      reasonCode: observation.metricCode,
    }];
  }
  if (input.kind === "deployment_attestation") {
    if (isSignalEnvelope(input.observation)) {
      return projectSignals(input.observation, "deployment_attestation", "deployment_attestation");
    }
    const observation = parseInternalDeploymentAttestation(input.observation);
    return observation.checks.flatMap((check): ProjectedEvidence[] => {
      if (check === "dependency_audit_passed") {
        return [toEvidence("application.dependencies", "application", observation.observedAt, "deployment_attestation")];
      }
      if (check === "secrets_not_in_image") {
        return [toEvidence("application.secrets", "application", observation.observedAt, "deployment_attestation")];
      }
      if (check === "api_surface_allowlisted") {
        return [toEvidence("infrastructure.network", "infrastructure", observation.observedAt, "deployment_attestation")];
      }
      return [];
    });
  }
  if (input.kind === "infrastructure_snapshot") {
    if (isSignalEnvelope(input.observation)) {
      return projectSignals(input.observation, "infrastructure_snapshot", "production_observation");
    }
    const observation = parseInternalInfrastructureSnapshot(input.observation);
    const transports = observation.services.map((service) => service.transport);
    const hasUnknownTransport = transports.includes("unknown");
    const hasVerifiedTransport = transports.some((transport) =>
      transport === "tls_verified" || transport === "internal_tls_verified",
    );
    const transportAssessment = assessInfrastructureTransport(
      hasUnknownTransport,
      hasVerifiedTransport,
    );
    return [{
      criterionId: "infrastructure.tls",
      scope: "infrastructure",
      status: transportAssessment.status,
      source: "production_observation",
      observedAt: observation.observedAt,
      reasonCode: transportAssessment.reasonCode,
    }];
  }
  if (input.kind === "dependency_inventory") {
    if (isSignalEnvelope(input.observation)) {
      return projectSignals(input.observation, "dependency_inventory", "production_observation");
    }
    const observation = parseInternalDependencyInventory(input.observation);
    const assessment = assessDependencyInventory(observation.criticalRiskCount, observation.highRiskCount);
    return [{
      criterionId: "application.dependencies",
      scope: "application",
      status: assessment.status,
      source: "production_observation",
      observedAt: observation.observedAt,
      reasonCode: assessment.reasonCode,
    }];
  }
  if (input.kind === "ai") {
    if (isSignalEnvelope(input.observation)) {
      return projectSignals(input.observation, "ai_observation", "production_observation");
    }
    const observation = parseInternalPrivacyObservation(input.observation);
    if (observation.area !== "transparency" || observation.signalCode !== "ai_disclosure_present") {
      throw new Error("internal_audit_projection_invalid");
    }
    return [{
      criterionId: "ai.disclosure",
      scope: "ai",
      status: observation.status,
      source: "production_observation",
      observedAt: observation.observedAt,
      reasonCode: observation.signalCode,
    }];
  }
  if (isSignalEnvelope(input.observation)) {
    return projectSignals(input.observation, "privacy_observation", "production_observation");
  }
  const observation = parseInternalPrivacyObservation(input.observation);
  const criterionId = privacyCriterion(observation.area, observation.signalCode);
  return [{
    criterionId,
    scope: criterionScope(criterionId),
    status: observation.status,
    source: "production_observation",
    observedAt: observation.observedAt,
    reasonCode: observation.signalCode,
  }];
}

function projectSignals(
  input: unknown,
  resource: string,
  source: ProjectedEvidence["source"],
): readonly ProjectedEvidence[] {
  const envelope = parseInternalAuditSignalEnvelope(input, signalCriteriaForResource(resource));
  return envelope.signals.map((signal) => ({
    criterionId: signal.criterionId,
    scope: INTERNAL_AUDIT_CRITERIA[signal.criterionId],
    status: signal.status,
    source,
    observedAt: envelope.observedAt,
    reasonCode: signal.reasonCode,
    value: signal.value,
    unit: signal.unit,
    ...(signal.limit === undefined ? {} : { limit: signal.limit }),
  }));
}

function isSignalEnvelope(value: unknown): value is InternalAuditSignalEnvelope {
  return isRecord(value) && Object.hasOwn(value, "signals");
}

function assessInfrastructureTransport(
  hasUnknownTransport: boolean,
  hasVerifiedTransport: boolean,
): { status: "pass" | "unknown"; reasonCode: string } {
  if (hasUnknownTransport) {
    return { status: "unknown", reasonCode: "infrastructure_transport_incomplete" };
  }
  if (hasVerifiedTransport) {
    return { status: "pass", reasonCode: "infrastructure_transport_verified" };
  }
  return { status: "unknown", reasonCode: "infrastructure_transport_not_applicable" };
}

function assessDependencyInventory(
  criticalRiskCount: number,
  highRiskCount: number,
): { status: "pass" | "fail" | "unknown"; reasonCode: string } {
  if (criticalRiskCount > 0) {
    return { status: "fail", reasonCode: "critical_dependency_risk_observed" };
  }
  if (highRiskCount > 0) {
    return { status: "unknown", reasonCode: "high_dependency_risk_observed" };
  }
  return { status: "pass", reasonCode: "dependency_risk_not_observed" };
}

function toEvidence(
  criterionId: InternalAuditCriterion,
  scope: string,
  observedAt: string,
  source: "deployment_attestation",
): ProjectedEvidence {
  return {
    criterionId,
    scope,
    status: "pass",
    source,
    observedAt,
    reasonCode: "attestation_check_passed",
  };
}

function qualityCriterion(kind: "e2e_flow" | "performance_sample" | "accessibility_snapshot" | "responsive_check" | "release_checks"): InternalAuditCriterion {
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
