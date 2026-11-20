import { describe, expect, it } from "vitest";
import { projectInternalAuditEvidence } from "./internal-audit-projection.js";
import { createInternalAuditSampleRef } from "./internal-audit-signal-envelope.js";

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

  it("projects multiple allowlisted signals without adding a new route", () => {
    const infrastructureSignals = [
      {
        criterionId: "infrastructure.headers",
        status: "pass",
        reasonCode: "security_headers_verified",
        value: 1,
        unit: "boolean",
      },
      {
        criterionId: "infrastructure.network",
        status: "pass",
        reasonCode: "network_surface_allowlisted",
        value: 1,
        unit: "boolean",
      },
    ] as const;
    const qualitySignals = [
      {
        criterionId: "quality.accessibility",
        status: "pass",
        reasonCode: "accessibility_critical_violations",
        value: 0,
        unit: "count",
        limit: 0,
      },
      {
        criterionId: "performance.page_load",
        status: "pass",
        reasonCode: "response_time",
        value: 420,
        unit: "milliseconds",
        limit: 2_500,
      },
    ] as const;
    const evidence = projectInternalAuditEvidence([
      {
        kind: "infrastructure_snapshot",
        observation: {
          observedAt,
          sampleRef: createInternalAuditSampleRef(infrastructureSignals),
          signals: infrastructureSignals,
        },
      },
      {
        kind: "quality",
        observation: {
          observedAt,
          sampleRef: createInternalAuditSampleRef(qualitySignals),
          signals: qualitySignals,
        },
      },
    ]);

    expect(evidence.map(({ criterionId, status }) => ({ criterionId, status }))).toEqual([
      { criterionId: "infrastructure.headers", status: "pass" },
      { criterionId: "infrastructure.network", status: "pass" },
      { criterionId: "quality.accessibility", status: "pass" },
      { criterionId: "performance.page_load", status: "pass" },
    ]);
    expect(evidence).toEqual(expect.arrayContaining([
      expect.objectContaining({ criterionId: "performance.page_load", value: 420, unit: "milliseconds", limit: 2_500 }),
    ]));
  });

  it("rejects duplicate criterion and reason pairs", () => {
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

  it("keeps distinct metrics for one criterion", () => {
    const signals = [
      {
        criterionId: "performance.page_load",
        status: "pass",
        reasonCode: "response_time",
        value: 420,
        unit: "milliseconds",
        limit: 2_500,
      },
      {
        criterionId: "performance.page_load",
        status: "fail",
        reasonCode: "first_contentful_paint",
        value: 2_100,
        unit: "milliseconds",
        limit: 1_800,
      },
    ] as const;

    const evidence = projectInternalAuditEvidence([{
      kind: "quality",
      observation: {
        observedAt,
        sampleRef: createInternalAuditSampleRef(signals),
        signals,
      },
    }]);

    expect(evidence).toHaveLength(2);
    expect(evidence.map(({ reasonCode }) => reasonCode)).toEqual([
      "response_time",
      "first_contentful_paint",
    ]);
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

  it("projects infrastructure TLS only when the snapshot has verified transport", () => {
    const evidence = projectInternalAuditEvidence([{
      kind: "infrastructure_snapshot",
      observation: {
        observedAt,
        snapshotHash: "c".repeat(64),
        services: [{
          name: "api",
          imageDigest: `sha256:${"3".repeat(64)}`,
          exposure: "internal",
          privilege: "rootless",
          transport: "internal_tls_verified",
        }],
      },
    }]);
    expect(evidence).toEqual([
      expect.objectContaining({
        criterionId: "infrastructure.tls",
        status: "pass",
        reasonCode: "infrastructure_transport_verified",
      }),
    ]);
  });

  it("projects dependency risk from aggregate counters only", () => {
    const evidence = projectInternalAuditEvidence([{
      kind: "dependency_inventory",
      observation: {
        observedAt,
        inventoryDigest: `sha256:${"4".repeat(64)}`,
        packageCount: 20,
        vulnerablePackageCount: 0,
        highRiskCount: 0,
        criticalRiskCount: 0,
      },
    }]);
    expect(evidence).toEqual([
      expect.objectContaining({
        criterionId: "application.dependencies",
        status: "pass",
        reasonCode: "dependency_risk_not_observed",
      }),
    ]);
  });

  it("rejects unknown envelopes and raw observation data", () => {
    expect(() => projectInternalAuditEvidence([{ kind: "quality", observation: { html: "<body>" } }]))
      .toThrow("internal_audit_projection_invalid");
    expect(() => projectInternalAuditEvidence([{ kind: "network", observation: {} }]))
      .toThrow("internal_audit_projection_invalid");
  });
});
