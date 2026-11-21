import { normalizeHostname } from "./scan-policy.js";
import type { InternalAuditRequest } from "./internal-audit-contract.js";

export type { InternalAuditRequest } from "./internal-audit-contract.js";

const ALLOWED_RESOURCES = [
  "infrastructure_snapshot",
  "deployment_attestation",
  "dependency_inventory",
  "synthetic_browser_flow",
  "privacy_observation",
  "ai_observation",
  "performance_observation",
] as const;
type InternalAuditResource = (typeof ALLOWED_RESOURCES)[number];

const RESOURCE_PATHS: Record<InternalAuditResource, string> = {
  infrastructure_snapshot: "/audit/infrastructure",
  deployment_attestation: "/audit/deployment",
  dependency_inventory: "/audit/dependencies",
  synthetic_browser_flow: "/audit/auth",
  privacy_observation: "/audit/privacy",
  ai_observation: "/audit/ai",
  performance_observation: "/audit/quality",
};

export type AuthorizedInternalAuditOperation = {
  resource: InternalAuditResource;
  method: "GET";
  hostname: "grumphya.com";
  path: string;
};

export function authorizeInternalAuditOperation(
  request: InternalAuditRequest,
  input: unknown,
): AuthorizedInternalAuditOperation {
  if (!isRecord(input) || !hasExactKeys(input, ["resource", "method", "hostname", "path"])) {
    throw new Error("internal_audit_operation_not_authorized");
  }
  try {
    const hostname = normalizeHostname(input.hostname);
    const resource = input.resource;
    const method = input.method;
    const path = input.path;
    if (
      request.hostname !== "grumphya.com" ||
      request.environment !== "production" ||
      hostname !== request.hostname ||
      method !== "GET" ||
      typeof resource !== "string" ||
      !isAllowedResource(resource) ||
      typeof path !== "string" ||
      !isAllowlistedPath(resource, path)
    ) {
      throw new Error("internal_audit_operation_not_authorized");
    }
    return { resource, method, hostname, path };
  } catch {
    throw new Error("internal_audit_operation_not_authorized");
  }
}

function isAllowedResource(value: string): value is InternalAuditResource {
  return ALLOWED_RESOURCES.includes(value as InternalAuditResource);
}

function isAllowlistedPath(resource: InternalAuditResource, value: string): boolean {
  return value === RESOURCE_PATHS[resource];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasExactKeys(value: Record<string, unknown>, required: readonly string[]): boolean {
  const keys = Object.keys(value);
  return keys.length === required.length && required.every((key) => keys.includes(key));
}
