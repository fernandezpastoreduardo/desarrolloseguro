import { describe, expect, it, vi } from "vitest";
import { runInternalAudit } from "./internal-audit-runner.js";
import { signedAuditEvidence, TEST_AUDIT_AUTH } from "./internal-audit-test-support.js";

const request = {
  policyVersion: "beta-d-0.1",
  hostname: "grumphya.com",
  environment: "production",
  auditor: "desarrollo-seguro",
  scopes: ["infrastructure", "application", "quality"],
  evidenceRetentionDays: 7,
} as const;

const auditRef = `sha256:${"a".repeat(64)}`;
const observedAt = "2026-11-18T19:45:00.000Z";

function operation(resource: string, path: string) {
  return { resource, method: "GET", hostname: "grumphya.com", path };
}

function resourceForPath(path: string): string {
  const resources: Record<string, string> = {
    "/audit/infrastructure": "infrastructure_snapshot",
    "/audit/deployment": "deployment_attestation",
    "/audit/dependencies": "dependency_inventory",
    "/audit/auth": "synthetic_browser_flow",
    "/audit/quality": "performance_observation",
    "/audit/privacy": "privacy_observation",
    "/audit/ai": "ai_observation",
  };
  return resources[path] ?? "";
}

describe("internal audit runner", () => {
  it("completes the seven-route contract in order with bounded signed evidence", async () => {
    const evidenceByPath: Record<string, unknown> = {
      "/audit/infrastructure": {
        observedAt,
        snapshotHash: "a".repeat(64),
        services: [{
          name: "api",
          imageDigest: `sha256:${"b".repeat(64)}`,
          exposure: "internal",
          privilege: "rootless",
          transport: "internal_tls_verified",
        }],
      },
      "/audit/deployment": {
        observedAt,
        environment: "production",
        artifactDigest: `sha256:${"c".repeat(64)}`,
        dependencyDigest: `sha256:${"d".repeat(64)}`,
        checks: ["secrets_not_in_image", "api_surface_allowlisted"],
      },
      "/audit/dependencies": {
        observedAt,
        inventoryDigest: `sha256:${"e".repeat(64)}`,
        packageCount: 20,
        vulnerablePackageCount: 0,
        highRiskCount: 0,
        criticalRiskCount: 0,
      },
      "/audit/auth": {
        flow: "authorization_boundary",
        status: "pass",
        principalClass: "synthetic_auditor",
        subjectRef: `sha256:${"f".repeat(64)}`,
        observedAt,
        reasonCode: "authorization_boundary_passed",
      },
      "/audit/quality": {
        kind: "e2e_flow",
        status: "pass",
        metricCode: "report_flow_loaded",
        value: 180,
        unit: "milliseconds",
        sampleRef: `sha256:${"1".repeat(64)}`,
        observedAt,
      },
      "/audit/privacy": {
        area: "consent",
        status: "pass",
        signalCode: "consent_state_respected",
        value: 1,
        unit: "boolean",
        sampleRef: `sha256:${"2".repeat(64)}`,
        observedAt,
      },
      "/audit/ai": {
        area: "transparency",
        status: "pass",
        signalCode: "ai_disclosure_present",
        value: 1,
        unit: "boolean",
        sampleRef: `sha256:${"3".repeat(64)}`,
        observedAt,
      },
    };
    const paths = Object.keys(evidenceByPath);
    const fetcher = vi.fn(async (url: string) => {
      const path = new URL(url).pathname;
      return {
        ok: true,
        status: 200,
        headers: { get: (name: string) => name === "content-type" ? "application/json" : null },
        json: async () => signedAuditEvidence(evidenceByPath[path]),
      };
    });

    const result = await runInternalAudit({
      request: { ...request, scopes: ["infrastructure", "application", "authentication", "quality", "privacy", "ethics", "ai"] },
      auditRef,
      observedAt,
      operations: paths.map((path) => operation(resourceForPath(path), path)),
      fetcher,
      auth: TEST_AUDIT_AUTH,
    });

    expect(result.status).toBe("completed");
    if (result.status !== "completed") return;
    expect(result.completedOperations).toBe(7);
    expect(result.report.assessment.assessedCriteria).toBe(8);
    expect(result.report.assessment.status).toBe("incomplete");
    expect(fetcher.mock.calls.map(([url]) => new URL(url).pathname)).toEqual(paths);
  });

  it("reads only the requested resources and builds a separated report", async () => {
    const fetcher = vi.fn(async (url: string) => ({
      ok: true,
      status: 200,
      headers: { get: (name: string) => name === "content-type" ? "application/json" : null },
      json: async () => signedAuditEvidence(url.endsWith("/deployment")
        ? {
          observedAt,
          environment: "production",
          artifactDigest: `sha256:${"b".repeat(64)}`,
          dependencyDigest: `sha256:${"c".repeat(64)}`,
          checks: ["secrets_not_in_image"],
        }
        : {
          kind: "performance_sample",
          status: "pass",
          metricCode: "response_time",
          value: 180,
          unit: "milliseconds",
          sampleRef: `sha256:${"d".repeat(64)}`,
          observedAt,
        }),
    }));

    const result = await runInternalAudit({
      request,
      auditRef,
      observedAt,
      operations: [
        operation("deployment_attestation", "/audit/deployment"),
        operation("performance_observation", "/audit/quality"),
      ],
      fetcher,
      auth: TEST_AUDIT_AUTH,
    });

    expect(result.status).toBe("completed");
    if (result.status !== "completed") return;
    expect(result.report.hostname).toBe("grumphya.com");
    expect(result.report.assessment.externalScore).toBeNull();
    expect(result.report.assessment.assessedCriteria).toBe(2);
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(fetcher).toHaveBeenNthCalledWith(
      1,
      "https://grumphya.com/audit/deployment",
      {
        method: "GET",
        redirect: "error",
        cache: "no-store",
        headers: { Accept: "application/json", Authorization: "Bearer test-technical-jwt" },
      },
    );
  });

  it("returns a safe failure without producing an incomplete report when a resource is unavailable", async () => {
    const fetcher = vi.fn(async () => ({
      ok: false,
      status: 503,
      headers: { get: (name: string) => name === "content-type" ? "application/json" : null },
      json: async () => ({}),
    }));

    await expect(runInternalAudit({
      request,
      auditRef,
      observedAt,
      operations: [operation("performance_observation", "/audit/quality")],
      fetcher,
      auth: TEST_AUDIT_AUTH,
    })).resolves.toEqual({
      status: "failed",
      completedOperations: 0,
      reasonCode: "internal_audit_resource_unavailable",
    });
  });

  it("rejects duplicate resource operations before making requests", async () => {
    const fetcher = vi.fn();

    await expect(runInternalAudit({
      request,
      auditRef,
      observedAt,
      operations: [
        operation("performance_observation", "/audit/quality"),
        operation("performance_observation", "/audit/quality"),
      ],
      fetcher,
      auth: TEST_AUDIT_AUTH,
    })).rejects.toThrow("internal_audit_run_invalid");
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("rejects a resource outside the request scopes before making requests", async () => {
    const fetcher = vi.fn();

    await expect(runInternalAudit({
      request: { ...request, scopes: ["infrastructure"] },
      auditRef,
      observedAt,
      operations: [operation("performance_observation", "/audit/quality")],
      fetcher,
      auth: TEST_AUDIT_AUTH,
    })).rejects.toThrow("internal_audit_run_invalid");
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("does not let a privacy scope read an AI disclosure signal", async () => {
    const fetcher = vi.fn(async () => ({
      ok: true,
      status: 200,
      headers: { get: (name: string) => name === "content-type" ? "application/json" : null },
      json: async () => signedAuditEvidence({
        area: "transparency",
        status: "pass",
        signalCode: "ai_disclosure_present",
        value: 1,
        unit: "boolean",
        sampleRef: `sha256:${"e".repeat(64)}`,
        observedAt,
      }),
    }));

    await expect(runInternalAudit({
      request: { ...request, scopes: ["privacy"] },
      auditRef,
      observedAt,
      operations: [operation("privacy_observation", "/audit/privacy")],
      fetcher,
      auth: TEST_AUDIT_AUTH,
    })).resolves.toEqual({
      status: "failed",
      completedOperations: 0,
      reasonCode: "internal_audit_operation_not_authorized",
    });
  });

  it("reads the dedicated AI observation with the AI scope", async () => {
    const fetcher = vi.fn(async () => ({
      ok: true,
      status: 200,
      headers: { get: (name: string) => name === "content-type" ? "application/json" : null },
      json: async () => signedAuditEvidence({
        area: "transparency",
        status: "pass",
        signalCode: "ai_disclosure_present",
        value: 1,
        unit: "boolean",
        sampleRef: `sha256:${"f".repeat(64)}`,
        observedAt,
      }),
    }));

    await expect(runInternalAudit({
      request: { ...request, scopes: ["ai"] },
      auditRef,
      observedAt,
      operations: [operation("ai_observation", "/audit/ai")],
      fetcher,
      auth: TEST_AUDIT_AUTH,
    })).resolves.toMatchObject({
      status: "completed",
      completedOperations: 1,
    });
  });

  it("rejects an AI disclosure delivered through the privacy route", async () => {
    const fetcher = vi.fn(async () => ({
      ok: true,
      status: 200,
      headers: { get: (name: string) => name === "content-type" ? "application/json" : null },
      json: async () => signedAuditEvidence({
        area: "transparency",
        status: "pass",
        signalCode: "ai_disclosure_present",
        value: 1,
        unit: "boolean",
        sampleRef: `sha256:${"g".repeat(64)}`,
        observedAt,
      }),
    }));

    await expect(runInternalAudit({
      request: { ...request, scopes: ["privacy", "ai"] },
      auditRef,
      observedAt,
      operations: [operation("privacy_observation", "/audit/privacy")],
      fetcher,
      auth: TEST_AUDIT_AUTH,
    })).resolves.toEqual({
      status: "failed",
      completedOperations: 0,
      reasonCode: "internal_audit_resource_invalid",
    });
  });

  it("stops before reading when the audit is already cancelled", async () => {
    const controller = new AbortController();
    controller.abort();
    const fetcher = vi.fn();

    await expect(runInternalAudit({
      request,
      auditRef,
      observedAt,
      operations: [operation("performance_observation", "/audit/quality")],
      fetcher,
      auth: TEST_AUDIT_AUTH,
      signal: controller.signal,
    })).resolves.toEqual({
      status: "failed",
      completedOperations: 0,
      reasonCode: "internal_audit_cancelled",
    });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("propagates cancellation to an in-flight resource read", async () => {
    const controller = new AbortController();
    const fetcher = vi.fn(async (_url: string, init: { signal?: AbortSignal }) => {
      controller.abort();
      const error = new Error("aborted");
      error.name = "AbortError";
      if (init.signal?.aborted) throw error;
      return {
        ok: true,
        status: 200,
        headers: { get: (name: string) => name === "content-type" ? "application/json" : null },
        json: async () => ({}),
      };
    });

    await expect(runInternalAudit({
      request,
      auditRef,
      observedAt,
      operations: [operation("performance_observation", "/audit/quality")],
      fetcher,
      auth: TEST_AUDIT_AUTH,
      signal: controller.signal,
    })).resolves.toEqual({
      status: "failed",
      completedOperations: 0,
      reasonCode: "internal_audit_cancelled",
    });
    expect(fetcher).toHaveBeenCalledOnce();
  });
});
