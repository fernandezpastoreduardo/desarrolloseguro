import { describe, expect, it } from "vitest";
import {
  authorizeInternalAuditOperation,
  type InternalAuditRequest,
} from "./internal-audit-access.js";

const request: InternalAuditRequest = {
  policyVersion: "beta-d-0.1",
  hostname: "grumphya.com",
  environment: "production",
  auditor: "desarrollo-seguro",
  scopes: ["infrastructure", "application"],
  evidenceRetentionDays: 30,
};

describe("internal audit access policy", () => {
  it("authorizes an allowlisted read-only production operation", () => {
    expect(authorizeInternalAuditOperation(request, {
      resource: "infrastructure_snapshot",
      method: "GET",
      hostname: "grumphya.com",
      path: "/audit/infrastructure",
    })).toEqual({
      resource: "infrastructure_snapshot",
      method: "GET",
      hostname: "grumphya.com",
      path: "/audit/infrastructure",
    });
  });

  it.each([
    { method: "POST" },
    { hostname: "other.example" },
    { resource: "shell" },
    { path: "/audit/infrastructure?include=secrets" },
    { path: "/audit/../users" },
  ])("rejects an operation outside the read-only contract: %o", (override) => {
    expect(() => authorizeInternalAuditOperation(request, {
      resource: "infrastructure_snapshot",
      method: "GET",
      hostname: "grumphya.com",
      path: "/audit/infrastructure",
      ...override,
    })).toThrow("internal_audit_operation_not_authorized");
  });
});
