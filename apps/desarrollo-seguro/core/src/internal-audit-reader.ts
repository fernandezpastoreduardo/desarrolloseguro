import { authorizeInternalAuditOperation, type AuthorizedInternalAuditOperation } from "./internal-audit-access.js";
import type { InternalAuditRequest } from "./internal-audit-contract.js";
import { parseInternalDeploymentAttestation, type InternalDeploymentAttestation } from "./internal-deployment-attestation.js";
import { parseInternalDependencyInventory, type InternalDependencyInventory } from "./internal-dependency-inventory.js";
import { parseInternalInfrastructureSnapshot, type InternalInfrastructureSnapshot } from "./internal-infrastructure.js";
import { parseInternalPrivacyObservation, type InternalPrivacyObservation } from "./internal-privacy-observation.js";
import { parseInternalQualityObservation, type InternalQualityObservation } from "./internal-quality-observation.js";
import { parseSyntheticAuthObservation, type SyntheticAuthObservation } from "./internal-synthetic-auth.js";

export type InternalAuditResource =
  | InternalInfrastructureSnapshot
  | InternalDeploymentAttestation
  | InternalDependencyInventory
  | SyntheticAuthObservation
  | InternalPrivacyObservation
  | InternalQualityObservation;

export type InternalAuditFetcher = (
  url: string,
  init: { method: "GET"; redirect: "error"; cache: "no-store" },
) => Promise<{
  ok: boolean;
  status: number;
  json: () => Promise<unknown>;
}>;

export async function readInternalAuditResource(
  request: InternalAuditRequest,
  operationInput: unknown,
  fetcher: InternalAuditFetcher,
): Promise<InternalAuditResource> {
  const operation = authorizeInternalAuditOperation(request, operationInput);
  const response = await fetchResource(operation, fetcher);
  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new Error("internal_audit_resource_invalid");
  }
  try {
    return parseResource(operation.resource, payload);
  } catch {
    throw new Error("internal_audit_resource_invalid");
  }
}

async function fetchResource(
  operation: AuthorizedInternalAuditOperation,
  fetcher: InternalAuditFetcher,
): Promise<Awaited<ReturnType<InternalAuditFetcher>>> {
  const response = await fetcher(
    `https://${operation.hostname}${operation.path}`,
    { method: "GET", redirect: "error", cache: "no-store" },
  );
  if (!response.ok || response.status < 200 || response.status >= 300) {
    throw new Error("internal_audit_resource_unavailable");
  }
  return response;
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
    case "performance_observation":
      return parseInternalQualityObservation(payload);
  }
}
