import { describe, expect, it, vi } from "vitest";
import { readInternalAuditResource } from "./internal-audit-reader.js";
import type { InternalAuditRequest } from "./internal-audit-contract.js";

const request: InternalAuditRequest = {
  policyVersion: "beta-d-0.1",
  hostname: "grumphya.com",
  environment: "production",
  auditor: "desarrollo-seguro",
  scopes: ["infrastructure", "application", "quality", "privacy"],
  evidenceRetentionDays: 30,
};

describe("internal production audit reader", () => {
  it("reads an allowlisted resource through a fixed Grumphya origin", async () => {
    const fetcher = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        observedAt: "2026-11-18T18:45:00.000Z",
        snapshotHash: "a".repeat(64),
        services: [{
          name: "api",
          imageDigest: `sha256:${"b".repeat(64)}`,
          exposure: "internal",
          privilege: "rootless",
          transport: "internal_tls_verified",
        }],
      }),
    });

    const result = await readInternalAuditResource(
      request,
      {
        resource: "infrastructure_snapshot",
        method: "GET",
        hostname: "grumphya.com",
        path: "/audit/infrastructure",
      },
      fetcher,
    );

    expect(fetcher).toHaveBeenCalledWith(
      "https://grumphya.com/audit/infrastructure",
      { method: "GET", redirect: "error", cache: "no-store" },
    );
    expect(result).toMatchObject({ snapshotHash: "a".repeat(64) });
  });

  it("fails closed on HTTP errors", async () => {
    const fetcher = vi.fn().mockResolvedValue({
      ok: false,
      status: 403,
      json: async () => ({ secret: "never-read" }),
    });
    await expect(readInternalAuditResource(request, {
      resource: "infrastructure_snapshot",
      method: "GET",
      hostname: "grumphya.com",
      path: "/audit/infrastructure",
    }, fetcher)).rejects.toThrow("internal_audit_resource_unavailable");
    expect(fetcher).toHaveBeenCalledOnce();

  });

  it("reads only the aggregate dependency inventory contract", async () => {
    const fetcher = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        observedAt: "2026-11-18T19:00:00.000Z",
        inventoryDigest: `sha256:${"c".repeat(64)}`,
        packageCount: 20,
        vulnerablePackageCount: 0,
        highRiskCount: 0,
        criticalRiskCount: 0,
      }),
    });
    await expect(readInternalAuditResource(request, {
      resource: "dependency_inventory",
      method: "GET",
      hostname: "grumphya.com",
      path: "/audit/dependencies",
    }, fetcher)).resolves.toMatchObject({ packageCount: 20 });
  });

  it("rejects a reader response that is not valid bounded evidence", async () => {
    const fetcher = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ html: "<private>" }),
    });
    await expect(readInternalAuditResource(request, {
      resource: "privacy_observation",
      method: "GET",
      hostname: "grumphya.com",
      path: "/audit/privacy",
    }, fetcher)).rejects.toThrow("internal_audit_resource_invalid");
  });
});
