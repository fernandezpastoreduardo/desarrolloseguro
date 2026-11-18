import { describe, expect, it } from "vitest";
import { projectInternalAuditEvidence } from "./internal-audit-projection.js";

const sampleRef = `sha256:${"a".repeat(64)}`;
const observedAt = "2026-11-18T18:00:00.000Z";

describe("internal audit evidence projection", () => {
  it("projects typed synthetic, quality and privacy observations to criteria", () => {
    const evidence = projectInternalAuditEvidence([
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
      {
        kind: "quality",
        observation: {
          kind: "accessibility_snapshot",
          status: "pass",
          metricCode: "accessibility_critical_violations",
          value: 0,
          unit: "count",
          sampleRef,
          observedAt,
        },
      },
      {
        kind: "privacy",
        observation: {
          area: "transparency",
          status: "pass",
          signalCode: "ai_disclosure_present",
          value: 1,
          unit: "boolean",
          sampleRef,
          observedAt,
        },
      },
    ]);

    expect(evidence).toEqual([
      expect.objectContaining({
        criterionId: "authentication.authorization",
        scope: "authentication",
        status: "pass",
        source: "synthetic_check",
        reasonCode: "cross_account_denied",
      }),
      expect.objectContaining({ criterionId: "quality.accessibility", scope: "quality" }),
      expect.objectContaining({ criterionId: "ai.disclosure", scope: "ai" }),
    ]);
  });

  it("rejects duplicate criteria before scoring can double count them", () => {
    const observation = {
      kind: "quality",
      observation: {
        kind: "e2e_flow",
        status: "pass",
        metricCode: "public_flow_loaded",
        value: 420,
        unit: "milliseconds",
        sampleRef,
        observedAt,
      },
    };
    expect(() => projectInternalAuditEvidence([observation, observation]))
      .toThrow("internal_audit_projection_duplicate");
  });

  it("projects only explicit deployment attestation checks", () => {
    const evidence = projectInternalAuditEvidence([{
      kind: "deployment_attestation",
      observation: {
        observedAt,
        environment: "production",
        artifactDigest: `sha256:${"1".repeat(64)}`,
        dependencyDigest: `sha256:${"2".repeat(64)}`,
        checks: ["dependency_audit_passed", "secrets_not_in_image", "api_surface_allowlisted"],
      },
    }]);

    expect(evidence.map(({ criterionId, source }) => ({ criterionId, source }))).toEqual([
      { criterionId: "application.dependencies", source: "deployment_attestation" },
      { criterionId: "application.secrets", source: "deployment_attestation" },
      { criterionId: "infrastructure.network", source: "deployment_attestation" },
    ]);
  });

  it("rejects unknown envelopes and raw observation data", () => {
    expect(() => projectInternalAuditEvidence([{ kind: "quality", observation: { html: "<body>" } }]))
      .toThrow("internal_audit_projection_invalid");
    expect(() => projectInternalAuditEvidence([{ kind: "network", observation: {} }]))
      .toThrow("internal_audit_projection_invalid");
  });
});
