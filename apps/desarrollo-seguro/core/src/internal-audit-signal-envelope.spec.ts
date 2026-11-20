import { describe, expect, it } from "vitest";
import {
  parseInternalAuditSignalEnvelope,
  signalCriteriaForResource,
} from "./internal-audit-signal-envelope.js";

const observedAt = "2026-11-20T08:00:00.000Z";
const sampleRef = `sha256:${"a".repeat(64)}`;

describe("internal audit signal envelope", () => {
  it("accepts bounded signals owned by an existing resource", () => {
    const result = parseInternalAuditSignalEnvelope({
      observedAt,
      sampleRef,
      signals: [
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
          value: 0,
          unit: "boolean",
        },
      ],
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

  it("rejects duplicate criteria and unbounded values", () => {
    const signal = {
      criterionId: "quality.accessibility",
      status: "pass",
      reasonCode: "accessibility_critical_violations",
      value: 0,
      unit: "count",
          limit: 100,
    };
    expect(() => parseInternalAuditSignalEnvelope({
      observedAt,
      sampleRef,
      signals: [signal, signal],
    }, signalCriteriaForResource("performance_observation"))).toThrow(
      "internal_audit_signal_duplicate",
    );
    expect(() => parseInternalAuditSignalEnvelope({
      observedAt,
      sampleRef,
      signals: [{ ...signal, value: 1_001 }],
    }, signalCriteriaForResource("performance_observation"))).toThrow(
      "internal_audit_signal_invalid",
    );
  });
});
