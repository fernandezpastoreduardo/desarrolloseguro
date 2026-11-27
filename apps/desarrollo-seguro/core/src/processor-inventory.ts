import { createHash, createPublicKey, verify, type KeyObject } from "node:crypto";
import { canonicalizeForSignature } from "./internal-audit-evidence-envelope.js";

export const PROCESSOR_INVENTORY_SCHEMA = "processor-inventory-v1" as const;
export const PROCESSOR_INVENTORY_HOSTNAME = "grumphya.com" as const;
export const DEVELOPMENT_SECURITY_INVENTORY_HOSTNAME = "desarrolloseguro.org" as const;
export const PROCESSOR_INVENTORY_POLICY_URL = "https://grumphya.com/politica-de-privacidad" as const;
export const DEVELOPMENT_SECURITY_INVENTORY_POLICY_URL = "https://desarrolloseguro.org/desarrollo-seguro/politica-de-privacidad.html" as const;
const LEGACY_DEVELOPMENT_SECURITY_INVENTORY_POLICY_URL = "https://desarrolloseguro.org/desarrollo-seguro/privacidad.html" as const;
export const PROCESSOR_INVENTORY_ATTESTATION_KID = "grumphya-release-2026" as const;
export const DEVELOPMENT_SECURITY_INVENTORY_KID = "desarrolloseguro-source-registry-v1" as const;
export const PROCESSOR_INVENTORY_MAX_AGE_MS = 24 * 60 * 60 * 1_000;
export const PROCESSOR_INVENTORY_MAX_BYTES = 64 * 1024;
export const PROCESSOR_INVENTORY_MAX_PROVIDERS = 32;
export const PROCESSOR_INVENTORY_MAX_STATEMENTS = 10;
export const PROCESSOR_INVENTORY_MAX_NAME_LENGTH = 120;
export const PROCESSOR_INVENTORY_MAX_TEXT_LENGTH = 500;

const MAX_CLOCK_SKEW_MS = 60_000;
const SHA256 = /^sha256:[a-f0-9]{64}$/u;
const SIGNATURE = /^[A-Za-z0-9_-]{80,100}$/u;
const PROVIDER_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;

export type ProcessorDisclosure = {
  providerId: string;
  displayName: string;
  product: string;
  disclosureStatus: "published" | "missing";
  purpose?: string;
  policyUrl?: string;
  declaredStatements?: string[];
};

export type VerifiedProcessorInventory = {
  policyVersion: typeof PROCESSOR_INVENTORY_SCHEMA;
  observedAt: string;
  validUntil: string;
  hostname: typeof PROCESSOR_INVENTORY_HOSTNAME | typeof DEVELOPMENT_SECURITY_INVENTORY_HOSTNAME;
  deploymentDigest: string;
  inventoryStatus: "complete" | "incomplete";
  privacyPolicy: {
    url: typeof PROCESSOR_INVENTORY_POLICY_URL | typeof DEVELOPMENT_SECURITY_INVENTORY_POLICY_URL |
      typeof LEGACY_DEVELOPMENT_SECURITY_INVENTORY_POLICY_URL;
    revision: string;
  };
  processors: ProcessorDisclosure[];
  attestation: { verified: true; keyId: typeof PROCESSOR_INVENTORY_ATTESTATION_KID | typeof DEVELOPMENT_SECURITY_INVENTORY_KID };
  evidenceSource?: "grumphya_signed_attestation" | "desarrolloseguro_source_registry";
};

export type ProcessorInventoryReaderOptions = {
  publicKeys: ReadonlyMap<string, KeyObject | string>;
  now?: () => Date;
};

export type ProcessorInventoryReadResult =
  | { status: "verified"; inventory: VerifiedProcessorInventory }
  | { status: "target_endpoint_missing" }
  | { status: "auditor_error" };

export type ProcessorTransparencyAssessment = {
  policyVersion: typeof PROCESSOR_INVENTORY_SCHEMA;
  status: "pass" | "fail" | "unknown";
  reasonCode:
    | "inventory_complete_and_disclosed"
    | "inventory_complete_empty"
    | "processor_not_disclosed"
    | "inventory_incomplete"
    | "endpoint_missing"
    | "auditor_error";
  inventory: VerifiedProcessorInventory | null;
};

export function assessProcessorTransparency(
  result: ProcessorInventoryReadResult,
): ProcessorTransparencyAssessment {
  if (result.status === "auditor_error") {
    return { policyVersion: PROCESSOR_INVENTORY_SCHEMA, status: "unknown", reasonCode: "auditor_error", inventory: null };
  }
  if (result.status === "target_endpoint_missing") {
    return { policyVersion: PROCESSOR_INVENTORY_SCHEMA, status: "fail", reasonCode: "endpoint_missing", inventory: null };
  }
  const inventory = result.inventory;
  if (inventory.inventoryStatus === "incomplete") {
    return { policyVersion: PROCESSOR_INVENTORY_SCHEMA, status: "fail", reasonCode: "inventory_incomplete", inventory };
  }
  if (inventory.processors.some(({ disclosureStatus }) => disclosureStatus === "missing")) {
    return { policyVersion: PROCESSOR_INVENTORY_SCHEMA, status: "fail", reasonCode: "processor_not_disclosed", inventory };
  }
  return {
    policyVersion: PROCESSOR_INVENTORY_SCHEMA,
    status: "pass",
    reasonCode: inventory.processors.length === 0 ? "inventory_complete_empty" : "inventory_complete_and_disclosed",
    inventory,
  };
}

export function parseProcessorTransparencyAssessment(input: unknown): ProcessorTransparencyAssessment | null {
  if (!isRecord(input) || !hasExactKeys(input, ["policyVersion", "status", "reasonCode", "inventory"]) ||
      input.policyVersion !== PROCESSOR_INVENTORY_SCHEMA ||
      !["pass", "fail", "unknown"].includes(String(input.status)) ||
      ![
        "inventory_complete_and_disclosed", "inventory_complete_empty", "processor_not_disclosed",
        "inventory_incomplete", "endpoint_missing", "auditor_error",
      ].includes(String(input.reasonCode))) return null;

  const assessment = input as unknown as ProcessorTransparencyAssessment;
  if (assessment.inventory === null) {
    const validNoInventory = assessment.status === "fail" && assessment.reasonCode === "endpoint_missing" ||
      assessment.status === "unknown" && assessment.reasonCode === "auditor_error";
    return validNoInventory ? assessment : null;
  }
  if (!isVerifiedProjection(assessment.inventory)) return null;
  const expected = assessProcessorTransparency({ status: "verified", inventory: assessment.inventory });
  return expected.status === assessment.status && expected.reasonCode === assessment.reasonCode ? assessment : null;
}

export type ProcessorInventoryFetcher = (
  url: string,
  init: {
    method: "GET";
    redirect: "error";
    cache: "no-store";
    headers: Readonly<Record<string, string>>;
    signal?: AbortSignal;
  },
) => Promise<{
  ok: boolean;
  status: number;
  headers: { get(name: string): string | null };
  json: () => Promise<unknown>;
  text?: () => Promise<string>;
}>;

export async function readProcessorInventory(
  input: {
    technicalJwt: () => string;
    fetcher: ProcessorInventoryFetcher;
    options: ProcessorInventoryReaderOptions;
    signal?: AbortSignal;
  },
): Promise<ProcessorInventoryReadResult> {
  try {
    if (input.signal?.aborted) return { status: "auditor_error" };
    const token = input.technicalJwt();
    if (token.length === 0 || token.length > 4096) return { status: "auditor_error" };
    const response = await input.fetcher(`https://${PROCESSOR_INVENTORY_HOSTNAME}/audit/processors`, {
      method: "GET",
      redirect: "error",
      cache: "no-store",
      headers: { Accept: "application/json", Authorization: `Bearer ${token}` },
      ...(input.signal ? { signal: input.signal } : {}),
    });
    if (response.status === 404) return { status: "target_endpoint_missing" };
    if (!response.ok || response.status < 200 || response.status >= 300) return { status: "auditor_error" };
    if (response.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase() !== "application/json") {
      return { status: "auditor_error" };
    }
    const contentLength = response.headers.get("content-length");
    if (contentLength !== null && !/^(?:0|[1-9][0-9]*)$/u.test(contentLength)) return { status: "auditor_error" };
    if (contentLength !== null && Number(contentLength) > PROCESSOR_INVENTORY_MAX_BYTES) return { status: "auditor_error" };
    let payload: unknown;
    try {
      if (response.text) {
        const body = await response.text();
        if (Buffer.byteLength(body, "utf8") > PROCESSOR_INVENTORY_MAX_BYTES) return { status: "auditor_error" };
        payload = JSON.parse(body) as unknown;
      } else {
        payload = await response.json();
        if (Buffer.byteLength(JSON.stringify(payload), "utf8") > PROCESSOR_INVENTORY_MAX_BYTES) return { status: "auditor_error" };
      }
    } catch {
      return { status: "auditor_error" };
    }
    return { status: "verified", inventory: verifyProcessorInventory(payload, input.options) };
  } catch {
    return { status: "auditor_error" };
  }
}

/** Creates first-party evidence from the versioned production integration registry. */
export function assessDevelopmentSecurityProcessorRegistry(input: {
  deploymentRevision: string;
  registryRevision: string;
  processors: ProcessorDisclosure[];
  now?: Date;
}): ProcessorTransparencyAssessment {
  if (!/^[a-f0-9]{40,64}$/u.test(input.deploymentRevision) ||
      !/^v[1-9][0-9]*$/u.test(input.registryRevision) || !Array.isArray(input.processors) ||
      input.processors.length > PROCESSOR_INVENTORY_MAX_PROVIDERS) {
    return assessProcessorTransparency({ status: "auditor_error" });
  }
  const observedAt = input.now ?? new Date();
  const validUntil = new Date(observedAt.getTime() + PROCESSOR_INVENTORY_MAX_AGE_MS);
  const inventory: VerifiedProcessorInventory = {
    policyVersion: PROCESSOR_INVENTORY_SCHEMA,
    observedAt: observedAt.toISOString(),
    validUntil: validUntil.toISOString(),
    hostname: DEVELOPMENT_SECURITY_INVENTORY_HOSTNAME,
    deploymentDigest: `sha256:${createHash("sha256").update(input.deploymentRevision).digest("hex")}`,
    inventoryStatus: "complete",
    privacyPolicy: { url: DEVELOPMENT_SECURITY_INVENTORY_POLICY_URL, revision: input.registryRevision },
    processors: input.processors.map((processor) => ({ ...processor })),
    attestation: { verified: true, keyId: DEVELOPMENT_SECURITY_INVENTORY_KID },
    evidenceSource: "desarrolloseguro_source_registry",
  };
  return assessProcessorTransparency({ status: "verified", inventory });
}

/** Verifies the target's standalone signed payload and returns only its public allowlist. */
export function verifyProcessorInventory(
  input: unknown,
  options: ProcessorInventoryReaderOptions,
): VerifiedProcessorInventory {
  if (!isRecord(input) || !hasExactKeys(input, [
    "schemaVersion", "observedAt", "validUntil", "environment", "hostname",
    "deploymentDigest", "inventoryStatus", "privacyPolicy", "processors", "attestation",
  ])) throw new Error("processor_inventory_invalid");

  const attestation = input.attestation;
  if (!isRecord(attestation) || !hasExactKeys(attestation, ["alg", "kid", "signature"]) ||
      attestation.alg !== "EdDSA" || attestation.kid !== PROCESSOR_INVENTORY_ATTESTATION_KID ||
      typeof attestation.signature !== "string" || !SIGNATURE.test(attestation.signature)) {
    throw new Error("processor_inventory_attestation_invalid");
  }

  const publicKey = options.publicKeys.get(attestation.kid);
  if (!publicKey) throw new Error("processor_inventory_attestation_invalid");
  let key: KeyObject;
  try {
    key = typeof publicKey === "string" ? createPublicKey(publicKey) : publicKey;
  } catch {
    throw new Error("processor_inventory_attestation_invalid");
  }
  if (key.asymmetricKeyType !== "ed25519") throw new Error("processor_inventory_attestation_invalid");

  const unsigned = { ...input };
  delete unsigned.attestation;
  const validSignature = (() => {
    try {
      return verify(null, Buffer.from(canonicalizeForSignature(unsigned)), key, Buffer.from(attestation.signature, "base64url"));
    } catch {
      return false;
    }
  })();
  if (!validSignature) throw new Error("processor_inventory_attestation_invalid");

  validateInventoryFields(input, options.now ?? (() => new Date()));
  if (Buffer.byteLength(JSON.stringify(input), "utf8") > PROCESSOR_INVENTORY_MAX_BYTES) {
    throw new Error("processor_inventory_invalid");
  }

  return {
    policyVersion: PROCESSOR_INVENTORY_SCHEMA,
    observedAt: input.observedAt as string,
    validUntil: input.validUntil as string,
    hostname: PROCESSOR_INVENTORY_HOSTNAME,
    deploymentDigest: input.deploymentDigest as string,
    inventoryStatus: input.inventoryStatus as VerifiedProcessorInventory["inventoryStatus"],
    privacyPolicy: {
      url: PROCESSOR_INVENTORY_POLICY_URL,
      revision: (input.privacyPolicy as Record<string, unknown>).revision as string,
    },
    processors: (input.processors as ProcessorDisclosure[]).map((processor) => ({ ...processor })),
    attestation: { verified: true, keyId: PROCESSOR_INVENTORY_ATTESTATION_KID },
    evidenceSource: "grumphya_signed_attestation",
  };
}

function validateInventoryFields(input: Record<string, unknown>, now: () => Date): void {
  const policy = input.privacyPolicy;
  const processors = input.processors;
  if (input.schemaVersion !== PROCESSOR_INVENTORY_SCHEMA || input.environment !== "production" ||
      input.hostname !== PROCESSOR_INVENTORY_HOSTNAME || typeof input.deploymentDigest !== "string" ||
      !SHA256.test(input.deploymentDigest) ||
      (input.inventoryStatus !== "complete" && input.inventoryStatus !== "incomplete") ||
      !isRecord(policy) || !hasExactKeys(policy, ["url", "revision"]) ||
      policy.url !== PROCESSOR_INVENTORY_POLICY_URL || !isBoundedText(policy.revision, 40) ||
      !/^v[1-9][0-9]*$/u.test(policy.revision) || !Array.isArray(processors) ||
      processors.length > PROCESSOR_INVENTORY_MAX_PROVIDERS || processors.some((item) => !isProcessor(item))) {
    throw new Error("processor_inventory_invalid");
  }

  const ids = processors.map((processor) => (processor as ProcessorDisclosure).providerId);
  if (new Set(ids).size !== ids.length || ids.some((id, index) => index > 0 && ids[index - 1]! >= id)) {
    throw new Error("processor_inventory_invalid");
  }

  const observedAt = input.observedAt;
  const validUntil = input.validUntil;
  if (typeof observedAt !== "string" || !isIsoInstant(observedAt) ||
      typeof validUntil !== "string" || !isIsoInstant(validUntil)) {
    throw new Error("processor_inventory_invalid");
  }
  const nowMs = now().getTime();
  const observedMs = Date.parse(observedAt);
  const validUntilMs = Date.parse(validUntil);
  if (observedMs > nowMs + MAX_CLOCK_SKEW_MS || validUntilMs <= observedMs ||
      validUntilMs - observedMs > PROCESSOR_INVENTORY_MAX_AGE_MS || nowMs > validUntilMs) {
    throw new Error("processor_inventory_stale");
  }
}

function isProcessor(value: unknown): value is ProcessorDisclosure {
  if (!isRecord(value) || typeof value.providerId !== "string" || !PROVIDER_ID.test(value.providerId) ||
      !isBoundedText(value.displayName, PROCESSOR_INVENTORY_MAX_NAME_LENGTH) ||
      !isBoundedText(value.product, PROCESSOR_INVENTORY_MAX_NAME_LENGTH)) return false;
  if (value.disclosureStatus === "missing") {
    return hasExactKeys(value, ["providerId", "displayName", "product", "disclosureStatus"]);
  }
  return value.disclosureStatus === "published" &&
    hasExactKeys(value, ["providerId", "displayName", "product", "disclosureStatus", "purpose", "policyUrl", "declaredStatements"]) &&
    isBoundedText(value.purpose, PROCESSOR_INVENTORY_MAX_TEXT_LENGTH) &&
    typeof value.policyUrl === "string" &&
    (value.policyUrl.startsWith(`${PROCESSOR_INVENTORY_POLICY_URL}#`) ||
      value.policyUrl.startsWith(`${DEVELOPMENT_SECURITY_INVENTORY_POLICY_URL}#`) ||
      value.policyUrl.startsWith(`${LEGACY_DEVELOPMENT_SECURITY_INVENTORY_POLICY_URL}#`)) &&
    Array.isArray(value.declaredStatements) && value.declaredStatements.length <= PROCESSOR_INVENTORY_MAX_STATEMENTS &&
    value.declaredStatements.every((statement) => isBoundedText(statement, PROCESSOR_INVENTORY_MAX_TEXT_LENGTH)) &&
    new Set(value.declaredStatements).size === value.declaredStatements.length;
}

function isVerifiedProjection(value: unknown): value is VerifiedProcessorInventory {
  if (!isRecord(value)) return false;
  const hasSource = Object.hasOwn(value, "evidenceSource");
  const expectedKeys = [
    "policyVersion", "observedAt", "validUntil", "hostname", "deploymentDigest",
    "inventoryStatus", "privacyPolicy", "processors", "attestation",
  ];
  if (hasSource) expectedKeys.push("evidenceSource");
  if (!hasExactKeys(value, expectedKeys) || value.policyVersion !== PROCESSOR_INVENTORY_SCHEMA ||
      typeof value.observedAt !== "string" || !isIsoInstant(value.observedAt) ||
      typeof value.validUntil !== "string" || !isIsoInstant(value.validUntil) ||
      typeof value.deploymentDigest !== "string" || !SHA256.test(value.deploymentDigest) ||
      (value.inventoryStatus !== "complete" && value.inventoryStatus !== "incomplete") ||
      !isRecord(value.privacyPolicy) || !hasExactKeys(value.privacyPolicy, ["url", "revision"]) ||
      !isBoundedText(value.privacyPolicy.revision, 40) || !/^v[1-9][0-9]*$/u.test(value.privacyPolicy.revision) ||
      !Array.isArray(value.processors) || value.processors.length > PROCESSOR_INVENTORY_MAX_PROVIDERS ||
      value.processors.some((processor) => !isProcessor(processor)) ||
      !isRecord(value.attestation) || !hasExactKeys(value.attestation, ["verified", "keyId"]) ||
      value.attestation.verified !== true) return false;
  if (value.hostname === PROCESSOR_INVENTORY_HOSTNAME &&
      value.privacyPolicy.url === PROCESSOR_INVENTORY_POLICY_URL &&
      value.attestation.keyId === PROCESSOR_INVENTORY_ATTESTATION_KID &&
      (!hasSource || value.evidenceSource === "grumphya_signed_attestation")) {
    // Legacy reports did not carry an evidenceSource field.
  } else if (value.hostname === DEVELOPMENT_SECURITY_INVENTORY_HOSTNAME &&
      (value.privacyPolicy.url === DEVELOPMENT_SECURITY_INVENTORY_POLICY_URL ||
        value.privacyPolicy.url === LEGACY_DEVELOPMENT_SECURITY_INVENTORY_POLICY_URL) &&
      value.attestation.keyId === DEVELOPMENT_SECURITY_INVENTORY_KID &&
      value.evidenceSource === "desarrolloseguro_source_registry" &&
      value.inventoryStatus === "complete") {
    // The self-domain registry is versioned in this source tree and tied to the built revision.
  } else return false;
  const ids = value.processors.map((processor) => (processor as ProcessorDisclosure).providerId);
  return new Set(ids).size === ids.length && !ids.some((id, index) => index > 0 && ids[index - 1]! >= id);
}

function isBoundedText(value: unknown, maxLength: number): value is string {
  if (typeof value !== "string" || value.trim().length === 0 || value.length > maxLength) return false;
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code <= 31 || code === 127) return false;
  }
  return true;
}

function isIsoInstant(value: string): boolean {
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) && new Date(timestamp).toISOString() === value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasExactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const compareKeys = (left: string, right: string) => left.localeCompare(right, "en");
  const actual = Object.keys(value).sort(compareKeys);
  const expected = [...keys].sort(compareKeys);
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}
