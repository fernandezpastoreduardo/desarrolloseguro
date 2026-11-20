import { describe, expect, it } from "vitest";
import {
  createInternalAuditSampleRef,
  parseInternalAuditSignalEnvelope,
  signalCriteriaForResource,
} from "./internal-audit-signal-envelope.js";
import { INTERNAL_AUDIT_CRITERIA, type InternalAuditCriterion } from "./internal-audit-contract.js";

const observedAt = "2026-11-20T08:00:00.000Z";
const sampleRef = `sha256:${"a".repeat(64)}`;

describe("internal audit signal envelope", () => {
  it("accepts bounded signals owned by an existing resource", () => {
    const signals = [
      {
        criterionId: "infrastructure.headers",
        status: "pass",
        reasonCode: "security_headers_verified",
        value: 1,
        unit: "boolean",
      },
      {
        criterionId: "infrastructure.network",
        status: "unknown",
        reasonCode: "network_surface_unobserved",
        value: null,
        unit: "boolean",
      },
    ] as const;
    const result = parseInternalAuditSignalEnvelope({
      observedAt,
      sampleRef: createInternalAuditSampleRef(signals),
      signals,
    }, signalCriteriaForResource("infrastructure_snapshot"));

    expect(result.signals).toHaveLength(2);
  });

  it("rejects a criterion owned by another resource", () => {
    expect(() => parseInternalAuditSignalEnvelope({
      observedAt,
      sampleRef,
      signals: [{
        criterionId: "ai.disclosure",
        status: "pass",
        reasonCode: "ai_disclosure_present",
        value: 1,
        unit: "boolean",
      }],
    }, signalCriteriaForResource("privacy_observation"))).toThrow(
      "internal_audit_signal_invalid",
    );
  });

  it("accepts the privacy signal codes emitted by the deployed audit contract", () => {
    const signals = [
      {
        criterionId: "privacy.third_parties",
        status: "pass",
        reasonCode: "third_party_origin_count",
        value: 1,
        unit: "count",
        limit: 1,
      },
      {
        criterionId: "privacy.third_parties",
        status: "pass",
        reasonCode: "third_party_origins_allowlisted",
        value: 1,
        unit: "boolean",
      },
      {
        criterionId: "privacy.consent",
        status: "pass",
        reasonCode: "consent_choice_selected",
        value: 1,
        unit: "boolean",
      },
    ] as const;

    const result = parseInternalAuditSignalEnvelope({
      observedAt,
      sampleRef: createInternalAuditSampleRef(signals),
      signals,
    }, signalCriteriaForResource("privacy_observation"));

    expect(result.signals).toHaveLength(3);
  });

  it("allows distinct metrics for one criterion and rejects duplicate signal keys", () => {
    const signal = {
      criterionId: "quality.accessibility",
      status: "pass",
      reasonCode: "accessibility_critical_violations",
      value: 0,
      unit: "count",
      limit: 0,
    } as const;
    expect(() => parseInternalAuditSignalEnvelope({
      observedAt,
      sampleRef: createInternalAuditSampleRef([signal, signal]),
      signals: [signal, signal],
    }, signalCriteriaForResource("performance_observation"))).toThrow(
      "internal_audit_signal_duplicate",
    );
    const performanceSignals = [
      {
        criterionId: "performance.page_load",
        status: "pass",
        reasonCode: "first_contentful_paint",
        value: 1_200,
        unit: "milliseconds",
        limit: 1_800,
      },
      {
        criterionId: "performance.page_load",
        status: "pass",
        reasonCode: "interaction_to_next_paint",
        value: 140,
        unit: "milliseconds",
        limit: 200,
      },
    ] as const;
    expect(parseInternalAuditSignalEnvelope({
      observedAt,
      sampleRef: createInternalAuditSampleRef(performanceSignals),
      signals: performanceSignals,
    }, ["performance.page_load"]).signals).toHaveLength(2);
    expect(() => parseInternalAuditSignalEnvelope({
      observedAt,
      sampleRef,
      signals: [{ ...signal, value: 1_001 }],
    }, signalCriteriaForResource("performance_observation"))).toThrow(
      "internal_audit_signal_invalid",
    );
  });

  it("covers every criterion exactly once through its owning resource", () => {
    const resources = [
      "infrastructure_snapshot",
      "deployment_attestation",
      "dependency_inventory",
      "synthetic_browser_flow",
      "performance_observation",
      "privacy_observation",
      "ai_observation",
    ] as const;
    const criterionCount = resources.reduce((count, resource) => count + signalCriteriaForResource(resource).length, 0);
    const criteria = resources.flatMap((resource) => signalCriteriaForResource(resource));

    expect(criterionCount).toBe(Object.keys(INTERNAL_AUDIT_CRITERIA).length);
    expect(new Set(criteria).size).toBe(criteria.length);
    for (const criterionId of criteria) {
      const signal = signalForCriterion(criterionId);
      expect(parseInternalAuditSignalEnvelope({
        observedAt,
        sampleRef: createInternalAuditSampleRef([signal]),
        signals: [signal],
      }, [criterionId]).signals[0]).toMatchObject({ criterionId });
    }
  });

  it("requires limits for numeric metrics and rejects extra keys", () => {
    const base = {
      criterionId: "performance.page_load",
      status: "pass",
      reasonCode: "response_time",
      value: 420,
      unit: "milliseconds",
    };
    expect(() => parseInternalAuditSignalEnvelope({
      observedAt,
      sampleRef,
      signals: [base],
    }, ["performance.page_load"])).toThrow("internal_audit_signal_invalid");
    expect(() => parseInternalAuditSignalEnvelope({
      observedAt,
      sampleRef,
      signals: [{ ...base, limit: 2_000, extra: "nope" }],
    }, ["performance.page_load"])).toThrow("internal_audit_signal_invalid");
  });

  it("uses null for an unknown metric and enforces provisional acceptance limits", () => {
    const signal = {
      criterionId: "performance.page_load",
      status: "unknown",
      reasonCode: "first_contentful_paint",
      value: null,
      unit: "milliseconds",
      limit: 1_800,
    } as const;
    expect(parseInternalAuditSignalEnvelope({
      observedAt,
      sampleRef: createInternalAuditSampleRef([signal]),
      signals: [signal],
    }, ["performance.page_load"]).signals[0]).toMatchObject({ value: null, limit: 1_800 });
    expect(() => parseInternalAuditSignalEnvelope({
      observedAt,
      sampleRef: createInternalAuditSampleRef([{ ...signal, status: "pass" }]),
      signals: [{ ...signal, status: "pass" }],
    }, ["performance.page_load"])).toThrow("internal_audit_signal_invalid");
    expect(() => parseInternalAuditSignalEnvelope({
      observedAt,
      sampleRef: createInternalAuditSampleRef([{ ...signal, limit: 2_000 }]),
      signals: [{ ...signal, limit: 2_000 }],
    }, ["performance.page_load"])).toThrow("internal_audit_signal_invalid");
  });

  it("rejects a sample reference that is not derived from the signal list", () => {
    const signal = signalForCriterion("infrastructure.headers");
    expect(() => parseInternalAuditSignalEnvelope({
      observedAt,
      sampleRef,
      signals: [signal],
    }, ["infrastructure.headers"])).toThrow("internal_audit_sample_ref_mismatch");
  });
});

function signalForCriterion(criterionId: InternalAuditCriterion) {
  if (criterionId === "quality.accessibility") {
    return { criterionId, status: "unknown", reasonCode: "accessibility_critical_violations", value: null, unit: "count", limit: 0 } as const;
  }
  if (criterionId === "performance.page_load") {
    return { criterionId, status: "unknown", reasonCode: "response_time", value: null, unit: "milliseconds", limit: 2_500 } as const;
  }
  if (criterionId === "privacy.third_parties") {
    return { criterionId, status: "unknown", reasonCode: "third_party_request_count", value: 0, unit: "count", limit: 100 } as const;
  }
  const reasonCode = {
    "infrastructure.tls": "infrastructure_transport_verified",
    "infrastructure.headers": "security_headers_verified",
    "infrastructure.network": "network_surface_allowlisted",
    "application.dependencies": "dependency_risk_not_observed",
    "application.secrets": "secrets_not_in_image",
    "authentication.authorization": "technical_contract_verified",
    "quality.e2e": "public_flow_loaded",
    "privacy.cookies": "essential_storage_only_before_consent",
    "privacy.consent": "consent_state_respected",
    "ethics.transparency": "privacy_notice_present",
    "ai.disclosure": "ai_disclosure_present",
  }[criterionId];
  return { criterionId, status: "unknown", reasonCode, value: 0, unit: "boolean" } as const;
}
