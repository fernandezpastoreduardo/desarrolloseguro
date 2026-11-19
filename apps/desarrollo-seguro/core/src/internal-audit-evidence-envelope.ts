import { createHash, createPublicKey, verify, type KeyLike } from "node:crypto";

export const INTERNAL_AUDIT_RESPONSE_SCHEMA_VERSION = "beta-d-0.2" as const;
const MAX_EVIDENCE_AGE_MS = 24 * 60 * 60 * 1_000;
const MAX_CLOCK_SKEW_MS = 60 * 1_000;
const SHA256 = /^sha256:[a-f0-9]{64}$/u;
const BASE64URL_SIGNATURE = /^[A-Za-z0-9_-]{80,100}$/u;

export type InternalAuditReleaseAttestation = {
  alg: "EdDSA";
  kid: string;
  signature: string;
};

export type InternalAuditResponseEnvelope = {
  schemaVersion: typeof INTERNAL_AUDIT_RESPONSE_SCHEMA_VERSION;
  observedAt: string;
  validUntil: string;
  environment: "production";
  deploymentDigest: string;
  cardinality: 1;
  evidence: unknown;
  attestation: InternalAuditReleaseAttestation;
};

export type InternalAuditEnvelopeOptions = {
  publicKeys: ReadonlyMap<string, KeyLike | string>;
  now?: () => Date;
  resource?: string;
};

export function parseInternalAuditResponseEnvelope(
  input: unknown,
  options: InternalAuditEnvelopeOptions,
): InternalAuditResponseEnvelope {
  if (!isRecord(input)) throw new Error("internal_audit_response_envelope_invalid");
  if (hasExactKeys(input, [
    "hostname",
    "environment",
    "generatedAt",
    "expiresAt",
    "profile",
    "scope",
    "evidence",
    "attestation",
    "kid",
  ])) {
    return parseGrumphyaEnvelope(input, options);
  }
  if (!hasExactKeys(input, [
    "schemaVersion",
    "observedAt",
    "validUntil",
    "environment",
    "deploymentDigest",
    "cardinality",
    "evidence",
    "attestation",
  ])) throw new Error("internal_audit_response_envelope_invalid");
  const envelope = parseEnvelopeFields(input, options.now ?? (() => new Date()));
  const publicKey = options.publicKeys.get(envelope.attestation.kid);
  if (!publicKey) throw new Error("internal_audit_attestation_invalid");
  const key = typeof publicKey === "string" ? createPublicKey(publicKey) : publicKey;
  const signedPayload = canonicalizeForSignature({
    schemaVersion: envelope.schemaVersion,
    observedAt: envelope.observedAt,
    validUntil: envelope.validUntil,
    environment: envelope.environment,
    deploymentDigest: envelope.deploymentDigest,
    cardinality: envelope.cardinality,
    evidence: envelope.evidence,
  });
  const validSignature = verify(
    null,
    Buffer.from(signedPayload),
    key,
    Buffer.from(envelope.attestation.signature, "base64url"),
  );
  if (!validSignature) throw new Error("internal_audit_attestation_invalid");
  return envelope;
}

function parseGrumphyaEnvelope(
  input: Record<string, unknown>,
  options: InternalAuditEnvelopeOptions,
): InternalAuditResponseEnvelope {
  const evidence = input.evidence;
  const attestation = input.attestation;
  if (
    input.hostname !== "grumphya.com" ||
    input.environment !== "production" ||
    input.profile !== INTERNAL_AUDIT_RESPONSE_SCHEMA_VERSION ||
    typeof input.scope !== "string" ||
    !/^audit:[a-z]+$/u.test(input.scope) ||
    (options.resource !== undefined && input.scope !== `audit:${options.resource}`) ||
    typeof input.generatedAt !== "string" ||
    typeof input.expiresAt !== "string" ||
    typeof input.kid !== "string" ||
    !isRecord(attestation) ||
    !hasExactKeys(attestation, ["alg", "kid", "signature"]) ||
    attestation.alg !== "EdDSA" ||
    typeof attestation.kid !== "string" ||
    typeof attestation.signature !== "string" ||
    !BASE64URL_SIGNATURE.test(attestation.signature) ||
    !Array.isArray(evidence) ||
    evidence.length !== 1 ||
    !isRecord(evidence[0])
  ) {
    throw new Error("internal_audit_response_envelope_invalid");
  }
  const observedAt = input.generatedAt;
  const validUntil = input.expiresAt;
  const now = (options.now ?? (() => new Date()))().getTime();
  const observedTimestamp = Date.parse(observedAt);
  const validUntilTimestamp = Date.parse(validUntil);
  if (
    !isIsoDate(observedAt) ||
    !isIsoDate(validUntil) ||
    validUntilTimestamp <= observedTimestamp ||
    observedTimestamp > now + MAX_CLOCK_SKEW_MS ||
    now - observedTimestamp > MAX_EVIDENCE_AGE_MS ||
    now > validUntilTimestamp
  ) {
    throw new Error("internal_audit_evidence_stale");
  }
  const publicKey = options.publicKeys.get(attestation.kid);
  if (!publicKey) throw new Error("internal_audit_attestation_invalid");
  const key = typeof publicKey === "string" ? createPublicKey(publicKey) : publicKey;
  const unsigned = { ...input };
  delete unsigned.attestation;
  if (!verify(
    null,
    Buffer.from(canonicalizeForSignature(unsigned)),
    key,
    Buffer.from(attestation.signature, "base64url"),
  )) {
    throw new Error("internal_audit_attestation_invalid");
  }
  const evidenceValue = evidence[0];
  const deploymentDigest = `sha256:${createHash("sha256")
    .update(canonicalizeForSignature(evidenceValue))
    .digest("hex")}`;
  return {
    schemaVersion: INTERNAL_AUDIT_RESPONSE_SCHEMA_VERSION,
    observedAt,
    validUntil,
    environment: "production",
    deploymentDigest,
    cardinality: 1,
    evidence: evidenceValue,
    attestation: {
      alg: "EdDSA",
      kid: attestation.kid,
      signature: attestation.signature,
    },
  };
}

export function canonicalizeForSignature(value: unknown): string {
  if (value === null || typeof value === "boolean" || typeof value === "number" || typeof value === "string") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(canonicalizeForSignature).join(",")}]`;
  }
  if (isRecord(value)) {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalizeForSignature(value[key])}`).join(",")}}`;
  }
  throw new Error("internal_audit_response_envelope_invalid");
}

function parseEnvelopeFields(input: Record<string, unknown>, clock: () => Date): InternalAuditResponseEnvelope {
  const observedAt = input.observedAt;
  const validUntil = input.validUntil;
  const attestation = input.attestation;
  if (
    input.schemaVersion !== INTERNAL_AUDIT_RESPONSE_SCHEMA_VERSION ||
    input.environment !== "production" ||
    input.cardinality !== 1 ||
    typeof observedAt !== "string" || !isIsoDate(observedAt) ||
    typeof validUntil !== "string" || !isIsoDate(validUntil) ||
    Date.parse(validUntil) <= Date.parse(observedAt) ||
    Date.parse(validUntil) - Date.parse(observedAt) > MAX_EVIDENCE_AGE_MS ||
    typeof input.deploymentDigest !== "string" || !SHA256.test(input.deploymentDigest) ||
    !isRecord(input.evidence) ||
    !isRecord(attestation) || !hasExactKeys(attestation, ["alg", "kid", "signature"]) ||
    attestation.alg !== "EdDSA" ||
    typeof attestation.kid !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/u.test(attestation.kid) ||
    typeof attestation.signature !== "string" || !BASE64URL_SIGNATURE.test(attestation.signature)
  ) {
    throw new Error("internal_audit_response_envelope_invalid");
  }
  const now = clock().getTime();
  const observedTimestamp = Date.parse(observedAt);
  const validUntilTimestamp = Date.parse(validUntil);
  if (
    observedTimestamp > now + MAX_CLOCK_SKEW_MS ||
    now - observedTimestamp > MAX_EVIDENCE_AGE_MS ||
    now > validUntilTimestamp
  ) {
    throw new Error("internal_audit_evidence_stale");
  }
  return {
    schemaVersion: INTERNAL_AUDIT_RESPONSE_SCHEMA_VERSION,
    observedAt,
    validUntil,
    environment: "production",
    deploymentDigest: input.deploymentDigest,
    cardinality: 1,
    evidence: input.evidence,
    attestation: {
      alg: "EdDSA",
      kid: attestation.kid,
      signature: attestation.signature,
    },
  };
}

function isIsoDate(value: string): boolean {
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) && new Date(timestamp).toISOString() === value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasExactKeys(value: Record<string, unknown>, required: readonly string[]): boolean {
  const keys = Object.keys(value).sort();
  return keys.length === required.length && required.every((key) => keys.includes(key));
}
