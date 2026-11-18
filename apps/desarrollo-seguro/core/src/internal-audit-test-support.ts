import { generateKeyPairSync, sign } from "node:crypto";
import {
  canonicalizeForSignature,
  INTERNAL_AUDIT_RESPONSE_SCHEMA_VERSION,
} from "./internal-audit-evidence-envelope.js";
import type { InternalAuditReaderOptions } from "./internal-audit-reader.js";

const { privateKey, publicKey } = generateKeyPairSync("ed25519");
export const TEST_AUDIT_NOW = new Date("2026-11-18T20:00:00.000Z");
export const TEST_AUDIT_AUTH: InternalAuditReaderOptions = {
  technicalJwt: () => "test-technical-jwt",
  releaseAttestationPublicKeys: new Map([["test-release", publicKey]]),
  clock: () => TEST_AUDIT_NOW,
};

export function testAuditAuth(clock: Date): InternalAuditReaderOptions {
  return { ...TEST_AUDIT_AUTH, clock: () => clock };
}

export function signedAuditEvidence(evidence: unknown, observedAt = "2026-11-18T19:45:00.000Z"): unknown {
  const unsigned = {
    schemaVersion: INTERNAL_AUDIT_RESPONSE_SCHEMA_VERSION,
    observedAt,
    validUntil: new Date(Date.parse(observedAt) + 30 * 60 * 1_000).toISOString(),
    environment: "production",
    deploymentDigest: `sha256:${"a".repeat(64)}`,
    cardinality: 1,
    evidence,
  };
  const signature = sign(null, Buffer.from(canonicalizeForSignature(unsigned)), privateKey)
    .toString("base64url");
  return { ...unsigned, attestation: { alg: "EdDSA", kid: "test-release", signature } };
}
