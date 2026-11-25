import { describe, expect, it } from "vitest";
import {
  parseScanFailureDiagnostic,
  SCAN_FAILURE_DIAGNOSTIC_CODES,
  SCAN_FAILURE_DIAGNOSTIC_STAGES,
} from "./scan-failure-diagnostic.js";

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

  it.each(SCAN_FAILURE_DIAGNOSTIC_STAGES)("accepts bounded pipeline phase %s", (stage) => {
    expect(parseScanFailureDiagnostic({
      stage,
      code: "executor_application_failed",
    })).toEqual({ stage, code: "executor_application_failed" });
  });

  it.each(SCAN_FAILURE_DIAGNOSTIC_CODES)("accepts only the allowlisted failure code %s", (code) => {
    expect(parseScanFailureDiagnostic({ stage: "provider_document_catalog_record", code }))
      .toEqual({ stage: "provider_document_catalog_record", code });
  });
});
