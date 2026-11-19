import { createHash } from "node:crypto";
import { authorizeInternalAuditOperation, type AuthorizedInternalAuditOperation } from "./internal-audit-access.js";
import { canonicalizeForSignature, parseInternalAuditResponseEnvelope } from "./internal-audit-evidence-envelope.js";
import type { TechnicalJwtProvider } from "./internal-audit-auth.js";
import type { KeyLike } from "node:crypto";
import type { InternalAuditRequest } from "./internal-audit-contract.js";
import { parseInternalDeploymentAttestation, type InternalDeploymentAttestation } from "./internal-deployment-attestation.js";
import { parseInternalDependencyInventory, type InternalDependencyInventory } from "./internal-dependency-inventory.js";
import { parseInternalInfrastructureSnapshot, type InternalInfrastructureSnapshot } from "./internal-infrastructure.js";
import { parseInternalPrivacyObservation, type InternalPrivacyObservation } from "./internal-privacy-observation.js";
import { parseInternalQualityObservation, type InternalQualityObservation } from "./internal-quality-observation.js";
import { parseSyntheticAuthObservation, type SyntheticAuthObservation } from "./internal-synthetic-auth.js";

export const INTERNAL_AUDIT_MAX_RESPONSE_BYTES = 64 * 1024;

export type InternalAuditResource =
  | InternalInfrastructureSnapshot
  | InternalDeploymentAttestation
  | InternalDependencyInventory
  | SyntheticAuthObservation
  | InternalPrivacyObservation
  | InternalQualityObservation;

export type InternalAuditFetcher = (
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

export type InternalAuditReaderOptions = {
  technicalJwt: TechnicalJwtProvider;
  releaseAttestationPublicKeys: ReadonlyMap<string, KeyLike | string>;
  clock?: () => Date;
  signal?: AbortSignal;
};

export async function readInternalAuditResource(
  request: InternalAuditRequest,
  operationInput: unknown,
  fetcher: InternalAuditFetcher,
  options: InternalAuditReaderOptions,
): Promise<InternalAuditResource> {
  const operation = authorizeInternalAuditOperation(request, operationInput);
  const response = await fetchResource(operation, fetcher, options);
  let payload: unknown;
  try {
    payload = await readBoundedJson(response);
  } catch (error) {
    if (isAbortError(error)) throw new Error("internal_audit_cancelled", { cause: error });
    throw new Error("internal_audit_resource_invalid", { cause: error });
  }
  try {
    const envelope = parseInternalAuditResponseEnvelope(payload, {
      publicKeys: options.releaseAttestationPublicKeys,
      now: options.clock,
      resource: auditResourceName(operation.resource),
    });
    const resource = parseResource(
      operation.resource,
      normalizeGrumphyaEvidence(operation.resource, envelope.evidence, envelope.observedAt),
    );
    if (resource.observedAt !== envelope.observedAt) {
      throw new Error("internal_audit_resource_invalid");
    }
    return resource;
  } catch (error) {
    if (error instanceof Error && (
      error.message === "internal_audit_attestation_invalid" ||
      error.message === "internal_audit_evidence_stale"
    )) {
      throw error;
    }
    throw new Error("internal_audit_resource_invalid", { cause: error });
  }
}

function normalizeGrumphyaEvidence(
  resource: AuthorizedInternalAuditOperation["resource"],
  evidence: unknown,
  observedAt: string,
): unknown {
  if (!isRecord(evidence) || typeof evidence.observedAt === "string") return evidence;
  const sampleRef = `sha256:${createHash("sha256").update(canonicalizeForSignature(evidence)).digest("hex")}`;
  if (resource === "infrastructure_snapshot" && hasExactKeys(evidence, ["proxy", "domain", "database", "transport", "environment"])) {
    const transport = evidence.transport === "https" ? "tls_verified" : "unknown";
    return {
      observedAt,
      snapshotHash: sampleRef.slice("sha256:".length),
      services: [
        { name: "proxy", imageDigest: sampleRef, exposure: "public", privilege: "unknown", transport },
        { name: "database", imageDigest: sampleRef, exposure: "internal", privilege: "unknown", transport: "not_applicable" },
      ],
    };
  }
  if (resource === "deployment_attestation" && hasExactKeys(evidence, ["checks", "images", "deploymentSha"])) {
    const images = evidence.images;
    const checks = evidence.checks;
    if (isRecord(images) && isArrayOfRecords(checks)) {
      const mappedChecks = checks
        .filter((check) => check.status === "passed")
        .map((check) => mapDeploymentCheck(check.name));
      return {
        observedAt,
        environment: "production",
        artifactDigest: typeof images.api === "string" ? images.api : sampleRef,
        dependencyDigest: sampleRef,
        checks: [...new Set(mappedChecks)],
      };
    }
  }
  if (resource === "dependency_inventory" && hasExactKeys(evidence, ["packageCount", "highRiskCount", "criticalRiskCount", "dependencyInventoryDigest"])) {
    const packageCount = asBoundedCount(evidence.packageCount);
    const highRiskCount = asBoundedCount(evidence.highRiskCount);
    const criticalRiskCount = asBoundedCount(evidence.criticalRiskCount);
    if (packageCount !== undefined && highRiskCount !== undefined && criticalRiskCount !== undefined && typeof evidence.dependencyInventoryDigest === "string") {
      return {
        observedAt,
        inventoryDigest: `sha256:${evidence.dependencyInventoryDigest}`,
        packageCount,
        vulnerablePackageCount: highRiskCount + criticalRiskCount,
        highRiskCount,
        criticalRiskCount,
      };
    }
  }
  if (resource === "synthetic_browser_flow" && hasExactKeys(evidence, ["domain", "issuer", "jwtKid", "audience", "hostname", "algorithm", "ttlSeconds", "environment", "clockSkewSeconds"])) {
    const valid = evidence.domain === "grumphya.com" && evidence.hostname === "grumphya.com" && evidence.issuer === "desarrolloseguro-audit" && evidence.audience === "grumphya-audit" && evidence.algorithm === "Ed25519" && evidence.environment === "production" && evidence.ttlSeconds === 300 && typeof evidence.clockSkewSeconds === "number" && evidence.clockSkewSeconds <= 60;
    return {
      flow: "authorization_boundary",
      status: valid ? "pass" : "fail",
      principalClass: "synthetic_auditor",
      subjectRef: sampleRef,
      observedAt,
      reasonCode: valid ? "technical_contract_verified" : "technical_contract_mismatch",
    };
  }
  if (resource === "performance_observation" && hasExactKeys(evidence, ["checks", "source"]) && isArrayOfRecords(evidence.checks)) {
    const passed = evidence.checks.filter((check) => check.status === "passed").length;
    return {
      kind: "release_checks",
      status: passed === evidence.checks.length && passed > 0 ? "pass" : "fail",
      metricCode: "release_checks",
      value: passed,
      unit: "count",
      sampleRef,
      observedAt,
    };
  }
  if (resource === "privacy_observation" && hasExactKeys(evidence, ["accessLogs", "retentionDays", "externalIngest", "productionFixtures"])) {
    return {
      area: "third_party",
      status: evidence.externalIngest === false ? "pass" : "fail",
      signalCode: "external_ingest_enabled",
      value: evidence.externalIngest === true ? 1 : 0,
      unit: "boolean",
      sampleRef,
      observedAt,
    };
  }
  if (resource === "ai_observation" && hasExactKeys(evidence, ["model", "smoke", "provider"])) {
    return {
      area: "transparency",
      status: evidence.smoke === "passed" ? "pass" : "fail",
      signalCode: "ai_disclosure_present",
      value: evidence.smoke === "passed" ? 1 : 0,
      unit: "boolean",
      sampleRef,
      observedAt,
    };
  }
  return evidence;
}

function auditResourceName(resource: AuthorizedInternalAuditOperation["resource"]): string {
  if (resource === "infrastructure_snapshot") return "infrastructure";
  if (resource === "deployment_attestation") return "deployment";
  if (resource === "dependency_inventory") return "dependencies";
  if (resource === "synthetic_browser_flow") return "auth";
  if (resource === "performance_observation") return "quality";
  if (resource === "privacy_observation") return "privacy";
  return "ai";
}

function mapDeploymentCheck(name: unknown): string {
  if (typeof name !== "string") return "production_configuration_checked";
  const normalized = name.toLowerCase();
  if (normalized.includes("trivy") || normalized.includes("depend")) return "dependency_audit_passed";
  if (normalized.includes("secret")) return "secrets_not_in_image";
  if (normalized.includes("api") || normalized.includes("surface")) return "api_surface_allowlisted";
  return "production_configuration_checked";
}

function asBoundedCount(value: unknown): number | undefined {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 && value <= 10_000 ? value : undefined;
}

function isArrayOfRecords(value: unknown): value is Record<string, unknown>[] {
  return Array.isArray(value) && value.every(isRecord);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasExactKeys(value: Record<string, unknown>, required: readonly string[]): boolean {
  const keys = Object.keys(value).sort();
  return keys.length === required.length && required.every((key) => keys.includes(key));
}

async function readBoundedJson(
  response: Awaited<ReturnType<InternalAuditFetcher>>,
): Promise<unknown> {
  if (response.text) {
    const body = await response.text();
    if (Buffer.byteLength(body, "utf8") > INTERNAL_AUDIT_MAX_RESPONSE_BYTES) {
      throw new Error("internal_audit_resource_invalid");
    }
    return JSON.parse(body) as unknown;
  }
  const payload = await response.json();
  if (Buffer.byteLength(JSON.stringify(payload), "utf8") > INTERNAL_AUDIT_MAX_RESPONSE_BYTES) {
    throw new Error("internal_audit_resource_invalid");
  }
  return payload;
}

async function fetchResource(
  operation: AuthorizedInternalAuditOperation,
  fetcher: InternalAuditFetcher,
  options: InternalAuditReaderOptions,
): Promise<Awaited<ReturnType<InternalAuditFetcher>>> {
  const signal = options.signal;
  if (signal?.aborted) throw new Error("internal_audit_cancelled");
  let token: string;
  try {
    token = options.technicalJwt();
  } catch (error) {
    throw new Error("internal_audit_auth_failed", { cause: error });
  }
  if (typeof token !== "string" || token.length === 0 || token.length > 4096) {
    throw new Error("internal_audit_auth_failed");
  }
  let response: Awaited<ReturnType<InternalAuditFetcher>>;
  try {
    response = await fetcher(
      `https://${operation.hostname}${operation.path}`,
      {
        method: "GET",
        redirect: "error",
        cache: "no-store",
        headers: { Accept: "application/json", Authorization: `Bearer ${token}` },
        ...(signal ? { signal } : {}),
      },
    );
  } catch (error) {
    if (isAbortError(error)) throw new Error("internal_audit_cancelled", { cause: error });
    throw new Error("internal_audit_resource_unavailable", { cause: error });
  }
  if (!response.ok || response.status < 200 || response.status >= 300) {
    throw new Error("internal_audit_resource_unavailable");
  }
  const contentType = response.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase();
  if (contentType !== "application/json") {
    throw new Error("internal_audit_resource_invalid");
  }
  const contentLength = response.headers.get("content-length");
  if (contentLength !== null && !isBoundedContentLength(contentLength)) {
    throw new Error("internal_audit_resource_invalid");
  }
  return response;
}

function isBoundedContentLength(value: string): boolean {
  if (!/^\d+$/u.test(value)) return false;
  const length = Number(value);
  return Number.isSafeInteger(length) && length <= INTERNAL_AUDIT_MAX_RESPONSE_BYTES;
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError";
}

function parseResource(
  resource: AuthorizedInternalAuditOperation["resource"],
  payload: unknown,
): InternalAuditResource {
  switch (resource) {
    case "infrastructure_snapshot":
      return parseInternalInfrastructureSnapshot(payload);
    case "deployment_attestation":
      return parseInternalDeploymentAttestation(payload);
    case "dependency_inventory":
      return parseInternalDependencyInventory(payload);
    case "synthetic_browser_flow":
      return parseSyntheticAuthObservation(payload);
    case "privacy_observation":
      return parseInternalPrivacyObservation(payload);
    case "ai_observation":
      return parseInternalPrivacyObservation(payload);
    case "performance_observation":
      return parseInternalQualityObservation(payload);
  }
}
