import { parseInternalAuditRequest, type InternalAuditRequest } from "./internal-audit-contract.js";
import { buildInternalAuditReport, type InternalAuditReport } from "./internal-audit-report.js";
import { readInternalAuditResource, type InternalAuditFetcher, type InternalAuditResource } from "./internal-audit-reader.js";

const SHA256 = /^sha256:[a-f0-9]{64}$/u;
const RESOURCE_NAMES = [
  "infrastructure_snapshot",
  "deployment_attestation",
  "dependency_inventory",
  "synthetic_browser_flow",
  "privacy_observation",
  "performance_observation",
] as const;
type ResourceName = (typeof RESOURCE_NAMES)[number];

export type InternalAuditOperation = {
  resource: ResourceName;
  method: "GET";
  hostname: "grumphya.com";
  path: string;
};

export type InternalAuditRunInput = {
  request: unknown;
  auditRef: string;
  observedAt: string;
  operations: readonly unknown[];
  fetcher: InternalAuditFetcher;
};

export type InternalAuditRunResult =
  | { status: "completed"; report: InternalAuditReport; completedOperations: number }
  | {
    status: "failed";
    completedOperations: number;
    reasonCode:
      | "internal_audit_resource_unavailable"
      | "internal_audit_resource_invalid"
      | "internal_audit_run_failed";
  };
type InternalAuditFailureReason =
  | "internal_audit_resource_unavailable"
  | "internal_audit_resource_invalid"
  | "internal_audit_run_failed";

export async function runInternalAudit(input: InternalAuditRunInput): Promise<InternalAuditRunResult> {
  const request = parseInternalAuditRequest(input.request);
  validateRunInput(input, request);

  const observations: Array<{ kind: EnvelopeKind; observation: InternalAuditResource }> = [];
  for (const [index, operation] of input.operations.entries()) {
    try {
      const resource = await readInternalAuditResource(request, operation, input.fetcher);
      observations.push({ kind: envelopeKind(operationResource(operation)), observation: resource });
    } catch (error) {
      return {
        status: "failed",
        completedOperations: index,
        reasonCode: toFailureReason(error),
      };
    }
  }

  try {
    const report = buildInternalAuditReport({
      auditRef: input.auditRef,
      observedAt: input.observedAt,
      observations,
    });
    return { status: "completed", report, completedOperations: input.operations.length };
  } catch {
    return {
      status: "failed",
      completedOperations: input.operations.length,
      reasonCode: "internal_audit_run_failed",
    };
  }
}

type EnvelopeKind =
  | "synthetic_auth"
  | "quality"
  | "privacy"
  | "deployment_attestation"
  | "infrastructure_snapshot"
  | "dependency_inventory";

function validateRunInput(input: InternalAuditRunInput, request: InternalAuditRequest): void {
  if (
    request.hostname !== "grumphya.com" ||
    !SHA256.test(input.auditRef) ||
    !isIsoDate(input.observedAt) ||
    !Array.isArray(input.operations) ||
    input.operations.length < 1 ||
    input.operations.length > RESOURCE_NAMES.length
  ) {
    throw new Error("internal_audit_run_invalid");
  }
  const resources = input.operations.map(operationResource);
  if (new Set(resources).size !== resources.length) {
    throw new Error("internal_audit_run_invalid");
  }
  if (resources.some((resource) => !request.scopes.includes(resourceScope(resource)))) {
    throw new Error("internal_audit_run_invalid");
  }
}

function operationResource(input: unknown): ResourceName {
  if (!isRecord(input) || typeof input.resource !== "string" || !RESOURCE_NAMES.includes(input.resource as ResourceName)) {
    throw new Error("internal_audit_run_invalid");
  }
  return input.resource as ResourceName;
}

function envelopeKind(resource: ResourceName): EnvelopeKind {
  if (resource === "synthetic_browser_flow") return "synthetic_auth";
  if (resource === "performance_observation") return "quality";
  if (resource === "privacy_observation") return "privacy";
  return resource;
}

function resourceScope(resource: ResourceName): InternalAuditRequest["scopes"][number] {
  if (resource === "infrastructure_snapshot") return "infrastructure";
  if (resource === "deployment_attestation" || resource === "dependency_inventory") return "application";
  if (resource === "synthetic_browser_flow") return "authentication";
  if (resource === "performance_observation") return "quality";
  return "privacy";
}

function toFailureReason(error: unknown): InternalAuditFailureReason {
  if (error instanceof Error && error.message === "internal_audit_resource_unavailable") {
    return "internal_audit_resource_unavailable";
  }
  if (error instanceof Error && error.message === "internal_audit_resource_invalid") {
    return "internal_audit_resource_invalid";
  }
  return "internal_audit_run_failed";
}

function isIsoDate(value: string): boolean {
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) && new Date(timestamp).toISOString() === value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
