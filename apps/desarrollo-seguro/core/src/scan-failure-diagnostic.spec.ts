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
});
