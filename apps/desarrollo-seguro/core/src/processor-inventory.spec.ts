import { generateKeyPairSync, sign } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { canonicalizeForSignature } from "./internal-audit-evidence-envelope.js";
import {
  PROCESSOR_INVENTORY_ATTESTATION_KID,
  PROCESSOR_INVENTORY_HOSTNAME,
  PROCESSOR_INVENTORY_POLICY_URL,
  PROCESSOR_INVENTORY_SCHEMA,
  assessDevelopmentSecurityProcessorRegistry,
  assessProcessorTransparency,
  parseProcessorTransparencyAssessment,
  readProcessorInventory,
  verifyProcessorInventory,
} from "./processor-inventory.js";

const { privateKey, publicKey } = generateKeyPairSync("ed25519");
const now = new Date("2026-11-22T12:00:00.000Z");

function signedInventory(overrides: Record<string, unknown> = {}): unknown {
  const unsigned = {
    schemaVersion: PROCESSOR_INVENTORY_SCHEMA,
    observedAt: "2026-11-22T11:55:00.000Z",
    validUntil: "2026-11-23T11:55:00.000Z",
    environment: "production",
    hostname: PROCESSOR_INVENTORY_HOSTNAME,
    deploymentDigest: `sha256:${"a".repeat(64)}`,
    inventoryStatus: "complete",
    privacyPolicy: { url: PROCESSOR_INVENTORY_POLICY_URL, revision: "v5" },
    processors: [{
      providerId: "openai",
      displayName: "OpenAI",
      product: "OpenAI API",
      disclosureStatus: "published",
      purpose: "Generación de respuestas y moderación de imágenes.",
      policyUrl: `${PROCESSOR_INVENTORY_POLICY_URL}#privacy-providers-title`,
      declaredStatements: ["Declaración publicada por Grumphya."],
    }],
    ...overrides,
  };
  const signature = sign(null, Buffer.from(canonicalizeForSignature(unsigned)), privateKey).toString("base64url");
  return {
    ...unsigned,
    attestation: { alg: "EdDSA", kid: PROCESSOR_INVENTORY_ATTESTATION_KID, signature },
  };
}

describe("verifyProcessorInventory", () => {
  it("accepts the declared IONOS hosting provider in the versioned first-party registry", () => {
    const processors = [{
      providerId: "ionos",
      displayName: "IONOS",
      product: "VPS",
      disclosureStatus: "published" as const,
      purpose: "Alojamiento de la web pública, la API y la base de datos de Desarrollo Seguro.",
      policyUrl: "https://desarrolloseguro.org/desarrollo-seguro/politica-de-privacidad.html#ionos-hosting",
      declaredStatements: [
        "Desarrollo Seguro está alojado en un VPS de IONOS que ejecuta la web pública, la API y la base de datos.",
      ],
    }];
    const assessment = assessDevelopmentSecurityProcessorRegistry({
      deploymentRevision: "a".repeat(40),
      registryRevision: "v2",
      processors,
      now,
    });

    expect(assessment).toMatchObject({ status: "pass", reasonCode: "inventory_complete_and_disclosed" });
    expect(assessment.inventory).toMatchObject({
      hostname: "desarrolloseguro.org",
      evidenceSource: "desarrolloseguro_source_registry",
      privacyPolicy: { revision: "v2" },
      processors,
    });
    expect(parseProcessorTransparencyAssessment(assessment)).toEqual(assessment);
  });

  it("reads immutable self-domain reports that retain the previous privacy-policy route", () => {
    const current = assessDevelopmentSecurityProcessorRegistry({
      deploymentRevision: "a".repeat(40),
      registryRevision: "v2",
      processors: [{
        providerId: "ionos",
        displayName: "IONOS",
        product: "VPS",
        disclosureStatus: "published",
        purpose: "Alojamiento de la web pública, la API y la base de datos de Desarrollo Seguro.",
        policyUrl: "https://desarrolloseguro.org/desarrollo-seguro/politica-de-privacidad.html#ionos-hosting",
        declaredStatements: [
          "Desarrollo Seguro está alojado en un VPS de IONOS que ejecuta la web pública, la API y la base de datos.",
        ],
      }],
      now,
    });
    const legacyRoute = "https://desarrolloseguro.org/desarrollo-seguro/privacidad.html";
    const historical = {
      ...current,
      inventory: {
        ...current.inventory!,
        privacyPolicy: { url: legacyRoute, revision: "v2" },
        processors: current.inventory!.processors.map((processor) => ({
          ...processor,
          policyUrl: `${legacyRoute}#ionos-hosting`,
        })),
      },
    };

    expect(parseProcessorTransparencyAssessment(historical)).toEqual(historical);
  });

  it("leaves the self-domain result unknown when no deployment revision is present", () => {
    expect(assessDevelopmentSecurityProcessorRegistry({
      deploymentRevision: "local",
      registryRevision: "v1",
      processors: [],
      now,
    })).toMatchObject({ status: "unknown", reasonCode: "auditor_error" });
  });

  it("verifies the standalone signature and returns an allowlisted projection", () => {
    const result = verifyProcessorInventory(signedInventory(), {
      publicKeys: new Map([[PROCESSOR_INVENTORY_ATTESTATION_KID, publicKey]]),
      now: () => now,
    });

    expect(result).toMatchObject({
      policyVersion: "processor-inventory-v1",
      hostname: "grumphya.com",
      inventoryStatus: "complete",
      privacyPolicy: { revision: "v5" },
      processors: [{ providerId: "openai", disclosureStatus: "published" }],
      attestation: { verified: true, keyId: PROCESSOR_INVENTORY_ATTESTATION_KID },
    });
    expect(result.attestation).not.toHaveProperty("signature");
  });

  it("accepts a valid incomplete inventory for the scorer to report as a target failure", () => {
    const response = signedInventory({ inventoryStatus: "incomplete" });
    expect(verifyProcessorInventory(response, {
      publicKeys: new Map([[PROCESSOR_INVENTORY_ATTESTATION_KID, publicKey]]),
      now: () => now,
    }).inventoryStatus).toBe("incomplete");
  });

  it("rejects altered signed fields", () => {
    const response = signedInventory() as Record<string, unknown>;
    const altered = { ...response, inventoryStatus: "incomplete" };

    expect(() => verifyProcessorInventory(altered, {
      publicKeys: new Map([[PROCESSOR_INVENTORY_ATTESTATION_KID, publicKey]]),
      now: () => now,
    })).toThrow("processor_inventory_attestation_invalid");
  });

  it("rejects stale responses and unsigned provider claims", () => {
    const stale = signedInventory({
      observedAt: "2026-11-20T11:55:00.000Z",
      validUntil: "2026-11-21T11:55:00.000Z",
    });
    expect(() => verifyProcessorInventory(stale, {
      publicKeys: new Map([[PROCESSOR_INVENTORY_ATTESTATION_KID, publicKey]]),
      now: () => now,
    })).toThrow("processor_inventory_stale");

    const withUnlistedField = signedInventory({
      processors: [{
        providerId: "openai",
        displayName: "OpenAI",
        product: "OpenAI API",
        disclosureStatus: "missing",
        purpose: "No debe poder inventarse.",
      }],
    });
    expect(() => verifyProcessorInventory(withUnlistedField, {
      publicKeys: new Map([[PROCESSOR_INVENTORY_ATTESTATION_KID, publicKey]]),
      now: () => now,
    })).toThrow("processor_inventory_invalid");
  });

  it("scores complete, incomplete, undisclosed, missing-endpoint, and auditor-error states distinctly", () => {
    const complete = verifyProcessorInventory(signedInventory(), {
      publicKeys: new Map([[PROCESSOR_INVENTORY_ATTESTATION_KID, publicKey]]),
      now: () => now,
    });
    const empty = verifyProcessorInventory(signedInventory({ processors: [] }), {
      publicKeys: new Map([[PROCESSOR_INVENTORY_ATTESTATION_KID, publicKey]]),
      now: () => now,
    });
    const incomplete = verifyProcessorInventory(signedInventory({ inventoryStatus: "incomplete" }), {
      publicKeys: new Map([[PROCESSOR_INVENTORY_ATTESTATION_KID, publicKey]]),
      now: () => now,
    });
    const undisclosed = verifyProcessorInventory(signedInventory({
      processors: [{ providerId: "openai", displayName: "OpenAI", product: "OpenAI API", disclosureStatus: "missing" }],
    }), {
      publicKeys: new Map([[PROCESSOR_INVENTORY_ATTESTATION_KID, publicKey]]),
      now: () => now,
    });

    expect(assessProcessorTransparency({ status: "verified", inventory: complete })).toMatchObject({ status: "pass", reasonCode: "inventory_complete_and_disclosed" });
    expect(assessProcessorTransparency({ status: "verified", inventory: empty })).toMatchObject({ status: "pass", reasonCode: "inventory_complete_empty" });
    expect(assessProcessorTransparency({ status: "verified", inventory: incomplete })).toMatchObject({ status: "fail", reasonCode: "inventory_incomplete" });
    expect(assessProcessorTransparency({ status: "verified", inventory: undisclosed })).toMatchObject({ status: "fail", reasonCode: "processor_not_disclosed" });
    expect(assessProcessorTransparency({ status: "target_endpoint_missing" })).toMatchObject({ status: "fail", reasonCode: "endpoint_missing" });
    expect(assessProcessorTransparency({ status: "auditor_error" })).toMatchObject({ status: "unknown", reasonCode: "auditor_error" });
  });

  it("uses only the fixed authenticated endpoint and distinguishes a missing target endpoint", async () => {
    const fetcher = vi.fn(async (url: string, init: { method: string; redirect: string; cache: string; headers: Record<string, string> }) => {
      expect(url).toBe("https://grumphya.com/audit/processors");
      expect(init).toMatchObject({ method: "GET", redirect: "error", cache: "no-store" });
      expect(init.headers.Authorization).toBe("Bearer scoped-token");
      return { ok: false, status: 404, headers: { get: () => "application/json" }, json: async () => ({}) };
    });
    const result = await readProcessorInventory({
      technicalJwt: () => "scoped-token",
      fetcher,
      options: { publicKeys: new Map([[PROCESSOR_INVENTORY_ATTESTATION_KID, publicKey]]), now: () => now },
    });

    expect(result).toEqual({ status: "target_endpoint_missing" });
  });
});
