import assert from "node:assert/strict";
import { test } from "node:test";
import {
  checkInternalAuditResources,
  INTERNAL_AUDIT_RESOURCES,
  validateProbeResponse,
} from "./check-internal-audit-resources.mjs";

function response(status, contentType = "application/json") {
  return { status, headers: { get: () => contentType } };
}

test("accepts JSON authentication rejection for every allowlisted resource", async () => {
  const calls = [];
  const result = await checkInternalAuditResources(async (url, init) => {
    calls.push({ url, init });
    return response(401);
  }, "https://audit.example");

  assert.equal(result.resources.length, INTERNAL_AUDIT_RESOURCES.length);
  assert.equal(calls.length, INTERNAL_AUDIT_RESOURCES.length);
  assert.equal(calls[0].init.method, "GET");
  assert.equal(calls[0].init.headers.accept, "application/json");
});

test("rejects an unpublished route with a safe category", () => {
  assert.throws(
    () => validateProbeResponse(response(404)),
    { message: "internal_audit_resource_unavailable" },
  );
});

test("rejects an unauthenticated success response", () => {
  assert.throws(
    () => validateProbeResponse(response(200)),
    { message: "internal_audit_auth_rejection_missing" },
  );
});

test("rejects an HTML authentication response", () => {
  assert.throws(
    () => validateProbeResponse(response(403, "text/html")),
    { message: "internal_audit_resource_not_json" },
  );
});

test("reports every resource failure without sending credentials", async () => {
  await assert.rejects(
    checkInternalAuditResources(async (_url, init) => {
      assert.equal("authorization" in init.headers, false);
      return response(404);
    }),
    (error) => {
      assert.equal(error.message, "internal_audit_resources_not_ready");
      assert.equal(error.failures.length, INTERNAL_AUDIT_RESOURCES.length);
      assert.equal(error.failures[0].code, "internal_audit_resource_unavailable");
      return true;
    },
  );
});
