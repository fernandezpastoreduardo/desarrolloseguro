import { describe, expect, it, vi } from "vitest";
import { readInternalAuditResource } from "./internal-audit-reader.js";
import type { InternalAuditRequest } from "./internal-audit-contract.js";
import { signedAuditEvidence, testAuditAuth } from "./internal-audit-test-support.js";

const request: InternalAuditRequest = {
  policyVersion: "beta-d-0.1",
  hostname: "grumphya.com",
  environment: "production",
  auditor: "desarrollo-seguro",
  scopes: ["infrastructure", "application", "quality", "privacy"],
  evidenceRetentionDays: 30,
};

const jsonHeaders = { get: (name: string) => name === "content-type" ? "application/json" : null };

describe("internal production audit reader", () => {
  it("reads an allowlisted resource through a fixed Grumphya origin", async () => {
    const fetcher = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: jsonHeaders,
      json: async () => signedAuditEvidence({
        observedAt: "2026-11-18T18:45:00.000Z",
        snapshotHash: "a".repeat(64),
        services: [{
          name: "api",
          imageDigest: `sha256:${"b".repeat(64)}`,
          exposure: "internal",
          privilege: "rootless",
          transport: "internal_tls_verified",
        }],
      }, "2026-11-18T18:45:00.000Z"),
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
      testAuditAuth(new Date("2026-11-18T19:00:00.000Z")),
    );

    expect(fetcher).toHaveBeenCalledWith(
      "https://grumphya.com/audit/infrastructure",
      {
        method: "GET",
        redirect: "error",
        cache: "no-store",
        headers: { Accept: "application/json", Authorization: "Bearer test-technical-jwt" },
      },
    );
    expect(result).toMatchObject({ snapshotHash: "a".repeat(64) });
  });

  it("fails closed on HTTP errors", async () => {
    const fetcher = vi.fn().mockResolvedValue({
      ok: false,
      status: 403,
      headers: jsonHeaders,
      json: async () => ({ secret: "never-read" }),
    });
    await expect(readInternalAuditResource(request, {
      resource: "infrastructure_snapshot",
      method: "GET",
      hostname: "grumphya.com",
      path: "/audit/infrastructure",
    }, fetcher, testAuditAuth(new Date("2026-11-18T19:00:00.000Z")))).rejects.toThrow("internal_audit_resource_unavailable");
    expect(fetcher).toHaveBeenCalledOnce();

  });

  it("reads only the aggregate dependency inventory contract", async () => {
    const fetcher = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: jsonHeaders,
      json: async () => signedAuditEvidence({
        observedAt: "2026-11-18T19:00:00.000Z",
        inventoryDigest: `sha256:${"c".repeat(64)}`,
        packageCount: 20,
        vulnerablePackageCount: 0,
        highRiskCount: 0,
        criticalRiskCount: 0,
      }, "2026-11-18T19:00:00.000Z"),
    });
    await expect(readInternalAuditResource(request, {
      resource: "dependency_inventory",
      method: "GET",
      hostname: "grumphya.com",
      path: "/audit/dependencies",
    }, fetcher, testAuditAuth(new Date("2026-11-18T19:10:00.000Z")))).resolves.toMatchObject({ packageCount: 20 });
  });

  it("rejects a reader response that is not valid bounded evidence", async () => {
    const fetcher = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: jsonHeaders,
      json: async () => signedAuditEvidence({ html: "<private>" }),
    });
    await expect(readInternalAuditResource(request, {
      resource: "privacy_observation",
      method: "GET",
      hostname: "grumphya.com",
      path: "/audit/privacy",
    }, fetcher, testAuditAuth(new Date("2026-11-18T20:00:00.000Z")))).rejects.toThrow("internal_audit_resource_invalid");
  });

  it("rejects a successful response that is not JSON", async () => {
    const fetcher = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: { get: () => "text/html; charset=utf-8" },
      json: async () => ({}),
    });
    await expect(readInternalAuditResource(request, {
      resource: "infrastructure_snapshot",
      method: "GET",
      hostname: "grumphya.com",
      path: "/audit/infrastructure",
    }, fetcher, testAuditAuth(new Date("2026-11-18T20:00:00.000Z")))).rejects.toThrow("internal_audit_resource_invalid");
  });

  it("rejects an oversized response before parsing its body", async () => {
    const json = vi.fn();
    const fetcher = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: { get: (name: string) => name === "content-type" ? "application/json" : "70000" },
      json,
    });
    await expect(readInternalAuditResource(request, {
      resource: "infrastructure_snapshot",
      method: "GET",
      hostname: "grumphya.com",
      path: "/audit/infrastructure",
    }, fetcher, testAuditAuth(new Date("2026-11-18T20:00:00.000Z")))).rejects.toThrow("internal_audit_resource_invalid");
    expect(json).not.toHaveBeenCalled();
  });

  it("bounds a chunked response body when content length is absent", async () => {
    const text = vi.fn().mockResolvedValue(`${"x".repeat(70_000)}`);
    const json = vi.fn();
    const fetcher = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: { get: (name: string) => name === "content-type" ? "application/json" : null },
      text,
      json,
    });
    await expect(readInternalAuditResource(request, {
      resource: "infrastructure_snapshot",
      method: "GET",
      hostname: "grumphya.com",
      path: "/audit/infrastructure",
    }, fetcher, testAuditAuth(new Date("2026-11-18T20:00:00.000Z")))).rejects.toThrow("internal_audit_resource_invalid");
    expect(text).toHaveBeenCalledOnce();
    expect(json).not.toHaveBeenCalled();
  });

  it("rejects a malformed content length instead of trusting an unbounded response", async () => {
    const fetcher = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: { get: (name: string) => name === "content-type" ? "application/json" : "unknown" },
      json: async () => ({}),
    });
    await expect(readInternalAuditResource(request, {
      resource: "infrastructure_snapshot",
      method: "GET",
      hostname: "grumphya.com",
      path: "/audit/infrastructure",
    }, fetcher, testAuditAuth(new Date("2026-11-18T20:00:00.000Z")))).rejects.toThrow("internal_audit_resource_invalid");
  });
});
