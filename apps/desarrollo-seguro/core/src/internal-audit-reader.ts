import { authorizeInternalAuditOperation, type AuthorizedInternalAuditOperation } from "./internal-audit-access.js";
import { parseInternalAuditResponseEnvelope } from "./internal-audit-evidence-envelope.js";
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
    });
    const resource = parseResource(operation.resource, envelope.evidence);
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
