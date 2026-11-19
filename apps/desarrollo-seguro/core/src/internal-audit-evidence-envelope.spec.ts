import { generateKeyPairSync, sign } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  canonicalizeForSignature,
  INTERNAL_AUDIT_RESPONSE_SCHEMA_VERSION,
  parseInternalAuditResponseEnvelope,
} from "./internal-audit-evidence-envelope.js";

const { privateKey, publicKey } = generateKeyPairSync("ed25519");
const now = new Date("2026-11-18T20:00:00.000Z");

function envelope(overrides: Record<string, unknown> = {}) {
  const unsigned = {
    schemaVersion: INTERNAL_AUDIT_RESPONSE_SCHEMA_VERSION,
    observedAt: "2026-11-18T19:45:00.000Z",
    validUntil: "2026-11-18T20:15:00.000Z",
    environment: "production",
    deploymentDigest: `sha256:${"a".repeat(64)}`,
    cardinality: 1,
    evidence: { status: "pass" },
    ...overrides,
  };
  const signature = sign(null, Buffer.from(canonicalizeForSignature(unsigned)), privateKey)
    .toString("base64url");
  return { ...unsigned, attestation: { alg: "EdDSA", kid: "grumphya-release-2026", signature } };
}

describe("signed internal audit response envelope", () => {
  it("accepts a fresh, signed, single evidence item", () => {
    const result = parseInternalAuditResponseEnvelope(envelope(), {
      publicKeys: new Map([["grumphya-release-2026", publicKey]]),
      now: () => now,
    });
    expect(result.evidence).toEqual({ status: "pass" });
  });

  it("rejects an unknown release key id", () => {
    expect(() => parseInternalAuditResponseEnvelope(envelope(), {
      publicKeys: new Map(),
      now: () => now,
    })).toThrow("internal_audit_attestation_invalid");
  });

  it("rejects stale evidence and a cardinality mismatch", () => {
    expect(() => parseInternalAuditResponseEnvelope(envelope({
      observedAt: "2026-11-17T19:45:00.000Z",
      validUntil: "2026-11-17T20:15:00.000Z",
    }), { publicKeys: new Map([["grumphya-release-2026", publicKey]]), now: () => now }))
      .toThrow("internal_audit_evidence_stale");
    expect(() => parseInternalAuditResponseEnvelope(envelope({ cardinality: 2 }), {
      publicKeys: new Map([["grumphya-release-2026", publicKey]]),
      now: () => now,
    })).toThrow("internal_audit_response_envelope_invalid");
  });

  it("rejects a valid signature when evidence is changed after signing", () => {
    const tampered = envelope() as Record<string, unknown>;
    tampered.evidence = { status: "pass", extra: "not-signed" };
    expect(() => parseInternalAuditResponseEnvelope(tampered, {
      publicKeys: new Map([["grumphya-release-2026", publicKey]]),
      now: () => now,
    })).toThrow("internal_audit_attestation_invalid");
  });

  it("rejects future evidence beyond the allowed clock skew", () => {
    const future = envelope({
      observedAt: "2026-11-18T20:02:00.000Z",
      validUntil: "2026-11-18T20:15:00.000Z",
    });
    expect(() => parseInternalAuditResponseEnvelope(future, {
      publicKeys: new Map([["grumphya-release-2026", publicKey]]),
      now: () => now,
    })).toThrow("internal_audit_evidence_stale");
  });

  it("rejects unknown envelope fields before verifying a signature", () => {
    const extraField = { ...envelope(), internalNote: "must-not-cross-boundary" };
    expect(() => parseInternalAuditResponseEnvelope(extraField, {
      publicKeys: new Map([["grumphya-release-2026", publicKey]]),
      now: () => now,
    })).toThrow("internal_audit_response_envelope_invalid");
  });
});
