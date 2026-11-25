import { describe, expect, it } from "vitest";
import { parseScanFailureDiagnostic } from "./scan-failure-diagnostic.js";

describe("parseScanFailureDiagnostic", () => {
  it("accepts bounded operational fields and probe categories", () => {
    expect(parseScanFailureDiagnostic({
      stage: "executor",
      code: "executor_application_failed",
      probeFailures: [{ operation: "http-get", code: "connection_failed" }],
      privateMessage: "discard me",
    })).toEqual({
      stage: "executor",
      code: "executor_application_failed",
      probeFailures: [{ operation: "http-get", code: "connection_failed" }],
    });
  });

  it("rejects arbitrary messages, repeated operations, and unknown categories", () => {
    expect(parseScanFailureDiagnostic({ stage: "executor", code: "secret /path" })).toBeNull();
    expect(parseScanFailureDiagnostic({ stage: "executor", code: "executor_application_failed", probeFailures: [
      { operation: "dns", code: "connection_failed" },
      { operation: "dns", code: "request_timeout" },
    ] })).toBeNull();
  });

  it("accepts exact allowlisted coordinator timeout and oversized response categories", () => {
    expect(parseScanFailureDiagnostic({
      stage: "executor",
      code: "runtime_execution_timeout",
    })).toEqual({ stage: "executor", code: "runtime_execution_timeout" });
    expect(parseScanFailureDiagnostic({
      stage: "executor",
      code: "executor_response_too_large",
    })).toEqual({ stage: "executor", code: "executor_response_too_large" });
  });

  it.each([
    "privacy_browser_observation",
    "privacy_assessment",
    "cookie_legal_findings",
    "service_comparison",
    "first_entry_policy_access",
    "response_validation",
    "runtime_session_create",
    "executor_execution",
    "runtime_session_cleanup",
  ] as const)("accepts bounded pipeline phase %s", (stage) => {
    expect(parseScanFailureDiagnostic({
      stage,
      code: "executor_application_failed",
    })).toEqual({ stage, code: "executor_application_failed" });
  });
});
