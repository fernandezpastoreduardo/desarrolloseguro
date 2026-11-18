import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const INTERNAL_AUDIT_ORIGIN = "https://grumphya.com";
export const INTERNAL_AUDIT_RESOURCES = [
  ["infrastructure_snapshot", "/audit/infrastructure"],
  ["deployment_attestation", "/audit/deployment"],
  ["dependency_inventory", "/audit/dependencies"],
  ["synthetic_browser_flow", "/audit/auth"],
  ["performance_observation", "/audit/quality"],
  ["privacy_observation", "/audit/privacy"],
  ["ai_observation", "/audit/ai"],
];

export async function checkInternalAuditResources(
  fetcher = globalThis.fetch,
  origin = INTERNAL_AUDIT_ORIGIN,
) {
  if (typeof fetcher !== "function") {
    throw new Error("internal_audit_preflight_fetch_unavailable");
  }
  const failures = [];
  for (const [resource, path] of INTERNAL_AUDIT_RESOURCES) {
    try {
      const response = await fetcher(`${origin}${path}`, {
        method: "GET",
        redirect: "error",
        cache: "no-store",
        headers: { accept: "application/json" },
        signal: AbortSignal.timeout(15_000),
      });
      validateProbeResponse(response);
    } catch (error) {
      failures.push({ resource, code: classifyFailure(error) });
    }
  }
  if (failures.length > 0) {
    const error = new Error("internal_audit_resources_not_ready");
    error.failures = failures;
    throw error;
  }
  return { resources: INTERNAL_AUDIT_RESOURCES.map(([resource]) => resource) };
}

export function validateProbeResponse(response) {
  if (!response || typeof response !== "object") {
    throw new Error("internal_audit_resource_unavailable");
  }
  if (response.status === 404) {
    throw new Error("internal_audit_resource_unavailable");
  }
  if (response.status !== 401 && response.status !== 403) {
    throw new Error("internal_audit_auth_rejection_missing");
  }
  const contentType = response.headers?.get?.("content-type")
    ?.split(";", 1)[0]
    ?.trim()
    .toLowerCase();
  if (contentType !== "application/json") {
    throw new Error("internal_audit_resource_not_json");
  }
}

function classifyFailure(error) {
  if (error instanceof Error && /^[a-z0-9_]+$/u.test(error.message)) {
    return error.message;
  }
  return "internal_audit_resource_unavailable";
}

async function run() {
  try {
    const result = await checkInternalAuditResources();
    process.stdout.write(`internal_audit_resources_ready count=${result.resources.length}\n`);
  } catch (error) {
    if (!(error instanceof Error) || !Array.isArray(error.failures)) {
      process.stderr.write("internal_audit_preflight_failed\n");
      process.exitCode = 1;
      return;
    }
    for (const failure of error.failures) {
      process.stderr.write(`${failure.code} resource=${failure.resource}\n`);
    }
    process.exitCode = 1;
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  await run();
}
