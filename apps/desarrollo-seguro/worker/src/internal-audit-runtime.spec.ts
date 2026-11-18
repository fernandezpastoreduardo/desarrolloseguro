import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { generateKeyPairSync } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createInternalAuditRuntime } from "./internal-audit-runtime.js";

describe("internal audit runtime configuration", () => {
  it("is disabled unless explicitly enabled", () => {
    expect(() => createInternalAuditRuntime({})).toThrow("internal_audit_disabled");
  });

  it("loads restricted Ed25519 keys and fixes production operations", () => {
    const directory = mkdtempSync(join(tmpdir(), "ds-internal-audit-runtime-"));
    const jwt = generateKeyPairSync("ed25519");
    const attestation = generateKeyPairSync("ed25519");
    const privatePath = join(directory, "jwt.pem");
    const publicPath = join(directory, "attestation.pem");
    writeFileSync(privatePath, jwt.privateKey.export({ type: "pkcs8", format: "pem" }), { mode: 0o400 });
    writeFileSync(publicPath, attestation.publicKey.export({ type: "spki", format: "pem" }), { mode: 0o400 });

    const runtime = createInternalAuditRuntime({
      AUDIT_ENABLED: "true",
      AUDIT_JWT_PRIVATE_KEY_FILE: privatePath,
      AUDIT_TECHNICAL_AUTH_KID: "ds-auditor-2026",
      AUDIT_RELEASE_ATTESTATION_PUBLIC_KEY_FILE: publicPath,
      AUDIT_RELEASE_ATTESTATION_KID: "grumphya-release-2026",
    });

    expect(runtime.request).toEqual({
      policyVersion: "beta-d-0.1",
      hostname: "grumphya.com",
      environment: "production",
      auditor: "desarrollo-seguro",
      scopes: ["infrastructure", "application", "authentication", "quality", "privacy", "ethics", "ai"],
      evidenceRetentionDays: 30,
    });
    expect(runtime.operations.map(({ path }) => path)).toEqual([
      "/audit/infrastructure",
      "/audit/deployment",
      "/audit/dependencies",
      "/audit/auth",
      "/audit/quality",
      "/audit/privacy",
      "/audit/ai",
    ]);
    rmSync(directory, { recursive: true, force: true });
  });

  it("rejects a private attestation key", () => {
    const directory = mkdtempSync(join(tmpdir(), "ds-internal-audit-runtime-"));
    const jwt = generateKeyPairSync("ed25519");
    const privatePath = join(directory, "jwt.pem");
    const attestationPath = join(directory, "attestation.pem");
    writeFileSync(privatePath, jwt.privateKey.export({ type: "pkcs8", format: "pem" }), { mode: 0o400 });
    writeFileSync(attestationPath, jwt.privateKey.export({ type: "pkcs8", format: "pem" }), { mode: 0o400 });

    expect(() => createInternalAuditRuntime({
      AUDIT_ENABLED: "true",
      AUDIT_JWT_PRIVATE_KEY_FILE: privatePath,
      AUDIT_TECHNICAL_AUTH_KID: "ds-auditor-2026",
      AUDIT_RELEASE_ATTESTATION_PUBLIC_KEY_FILE: attestationPath,
      AUDIT_RELEASE_ATTESTATION_KID: "grumphya-release-2026",
    })).toThrow("internal_audit_attestation_key_invalid");
    rmSync(directory, { recursive: true, force: true });
  });

  it("runs sequentially with a short-lived JWT and stops on the first unavailable resource", async () => {
    const directory = mkdtempSync(join(tmpdir(), "ds-internal-audit-runtime-"));
    const jwt = generateKeyPairSync("ed25519");
    const attestation = generateKeyPairSync("ed25519");
    const privatePath = join(directory, "jwt.pem");
    const publicPath = join(directory, "attestation.pem");
    writeFileSync(privatePath, jwt.privateKey.export({ type: "pkcs8", format: "pem" }), { mode: 0o400 });
    writeFileSync(publicPath, attestation.publicKey.export({ type: "spki", format: "pem" }), { mode: 0o400 });
    const calls: Array<{ url: string; init: { headers: Readonly<Record<string, string>> } }> = [];
    const runtime = createInternalAuditRuntime({
      AUDIT_ENABLED: "true",
      AUDIT_JWT_PRIVATE_KEY_FILE: privatePath,
      AUDIT_TECHNICAL_AUTH_KID: "ds-auditor-2026",
      AUDIT_RELEASE_ATTESTATION_PUBLIC_KEY_FILE: publicPath,
      AUDIT_RELEASE_ATTESTATION_KID: "grumphya-release-2026",
    }, {
      clock: () => new Date("2026-11-18T20:00:00.000Z"),
      idFactory: () => "audit-jti-1",
      fetcher: async (url, init) => {
        calls.push({ url, init });
        return { ok: false, status: 503, headers: { get: () => "application/json" }, json: async () => ({}) };
      },
    });

    await expect(runtime.run()).resolves.toEqual({
      status: "failed",
      completedOperations: 0,
      reasonCode: "internal_audit_resource_unavailable",
    });
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe("https://grumphya.com/audit/infrastructure");
    expect(calls[0].init.headers.Accept).toBe("application/json");
    expect(calls[0].init.headers.Authorization).toMatch(/^Bearer [^.]+\.[^.]+\.[^.]+$/u);
    const [, payload] = calls[0].init.headers.Authorization.slice("Bearer ".length).split(".");
    expect(JSON.parse(Buffer.from(payload, "base64url").toString())).toMatchObject({
      iss: "desarrolloseguro-audit",
      aud: "grumphya-audit",
      domain: "grumphya.com",
      environment: "production",
      scope: "audit:infrastructure audit:application audit:authentication audit:quality audit:privacy audit:ethics audit:ai",
    });
    rmSync(directory, { recursive: true, force: true });
  });
});
