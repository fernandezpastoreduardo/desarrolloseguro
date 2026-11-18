import { describe, expect, it } from "vitest";
import { parseInternalDeploymentAttestation } from "./internal-deployment-attestation.js";

const validAttestation = {
  observedAt: "2026-11-18T16:00:00.000Z",
  environment: "production",
  artifactDigest: `sha256:${"a".repeat(64)}`,
  dependencyDigest: `sha256:${"b".repeat(64)}`,
  checks: ["runtime_image_pinned", "secrets_not_in_image", "dependency_audit_passed"],
};

describe("internal deployment attestation", () => {
  it("accepts a bounded production attestation", () => {
    expect(parseInternalDeploymentAttestation(validAttestation)).toEqual(validAttestation);
  });

  it.each([
    { environment: "staging" },
    { artifactDigest: "latest" },
    { checks: ["shell_access"] },
    { checks: ["dependency_audit_passed", "dependency_audit_passed"] },
    { checks: ["dependency_audit_passed"], sbom: "full package contents" },
  ])("rejects an attestation outside the allowlist: %o", (override) => {
    expect(() => parseInternalDeploymentAttestation({ ...validAttestation, ...override }))
      .toThrow("internal_deployment_attestation_invalid");
  });
});
