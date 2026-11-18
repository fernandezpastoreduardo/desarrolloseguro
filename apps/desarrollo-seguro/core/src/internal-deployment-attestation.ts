const ATTESTATION_CHECKS = [
  "runtime_image_pinned",
  "secrets_not_in_image",
  "dependency_audit_passed",
  "production_configuration_checked",
  "api_surface_allowlisted",
] as const;
const SHA256 = /^sha256:[a-f0-9]{64}$/u;
const MAX_CHECKS = ATTESTATION_CHECKS.length;

export type InternalDeploymentAttestation = {
  observedAt: string;
  environment: "production";
  artifactDigest: string;
  dependencyDigest: string;
  checks: readonly (typeof ATTESTATION_CHECKS)[number][];
};

export function parseInternalDeploymentAttestation(
  input: unknown,
): InternalDeploymentAttestation {
  if (!isRecord(input) || !hasExactKeys(input, [
    "observedAt",
    "environment",
    "artifactDigest",
    "dependencyDigest",
    "checks",
  ])) {
    throw new Error("internal_deployment_attestation_invalid");
  }
  const observedAt = input.observedAt;
  const environment = input.environment;
  const artifactDigest = input.artifactDigest;
  const dependencyDigest = input.dependencyDigest;
  const checks = input.checks;
  if (
    typeof observedAt !== "string" ||
    !isIsoDate(observedAt) ||
    environment !== "production" ||
    typeof artifactDigest !== "string" ||
    !SHA256.test(artifactDigest) ||
    typeof dependencyDigest !== "string" ||
    !SHA256.test(dependencyDigest) ||
    !Array.isArray(checks) ||
    checks.length === 0 ||
    checks.length > MAX_CHECKS
  ) {
    throw new Error("internal_deployment_attestation_invalid");
  }
  const safeChecks = checks.map((check) => {
    if (!isAttestationCheck(check)) {
      throw new Error("internal_deployment_attestation_invalid");
    }
    return check;
  });
  if (new Set(safeChecks).size !== safeChecks.length) {
    throw new Error("internal_deployment_attestation_invalid");
  }
  return { observedAt, environment, artifactDigest, dependencyDigest, checks: safeChecks };
}

function isAttestationCheck(value: unknown): value is (typeof ATTESTATION_CHECKS)[number] {
  return typeof value === "string" && ATTESTATION_CHECKS.includes(value as (typeof ATTESTATION_CHECKS)[number]);
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
