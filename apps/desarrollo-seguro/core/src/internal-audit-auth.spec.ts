import { generateKeyPairSync } from "node:crypto";
import { describe, expect, it } from "vitest";
import { createTechnicalJwt } from "./internal-audit-auth.js";

describe("technical audit JWT", () => {
  it("creates a short lived EdDSA token with bounded audit claims", () => {
    const { privateKey } = generateKeyPairSync("ed25519");
    const token = createTechnicalJwt({
      privateKey,
      kid: "ds-auditor-2026",
      issuer: "desarrolloseguro-audit",
      audience: "grumphya-audit",
      subject: "desarrolloseguro-audit",
      hostname: "grumphya.com",
      environment: "production",
      scopes: ["infrastructure", "application"],
      clock: () => new Date("2026-11-18T20:00:00.000Z"),
      idFactory: () => "audit-jti-1",
    });
    const [encodedHeader, encodedPayload, encodedSignature] = token.split(".");
    expect(JSON.parse(Buffer.from(encodedHeader, "base64url").toString())).toEqual({
      alg: "EdDSA",
      kid: "ds-auditor-2026",
      typ: "JWT",
    });
    expect(JSON.parse(Buffer.from(encodedPayload, "base64url").toString())).toMatchObject({
      iss: "desarrolloseguro-audit",
      aud: "grumphya-audit",
      sub: "desarrolloseguro-audit",
      kid: "ds-auditor-2026",
      iat: 1795032000,
      exp: 1795032300,
      jti: "audit-jti-1",
      domain: "grumphya.com",
      hostname: "grumphya.com",
      environment: "production",
      scope: "audit:infrastructure audit:application",
    });
    expect(encodedSignature).toMatch(/^[A-Za-z0-9_-]+$/u);
  });

  it("rejects a token lifetime over the five minute contract", () => {
    const { privateKey } = generateKeyPairSync("ed25519");
    expect(() => createTechnicalJwt({
      privateKey,
      kid: "ds-auditor-2026",
      issuer: "issuer",
      audience: "audience",
      subject: "subject",
      hostname: "grumphya.com",
      environment: "production",
      scopes: ["application"],
      ttlSeconds: 301,
    })).toThrow("internal_audit_auth_config_invalid");
  });

  it("rejects issuer or audience values outside the fixed contract", () => {
    const { privateKey } = generateKeyPairSync("ed25519");
    expect(() => createTechnicalJwt({
      privateKey,
      kid: "ds-auditor-2026",
      issuer: "untrusted-issuer",
      audience: "grumphya-audit",
      subject: "desarrollo-seguro-audit",
      hostname: "grumphya.com",
      environment: "production",
      scopes: ["application"],
    })).toThrow("internal_audit_auth_config_invalid");
  });
});
