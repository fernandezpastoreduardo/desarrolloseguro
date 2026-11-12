import { describe, expect, it, vi } from "vitest";
import { createJsonLineRuntimeDiagnostic } from "./runtime-diagnostics.js";

describe("createJsonLineRuntimeDiagnostic", () => {
  it("writes stage and safe code without accepting request data", () => {
    const write = vi.fn();
    const diagnostic = createJsonLineRuntimeDiagnostic(write);

    diagnostic({
      type: "runtime_diagnostic",
      stage: "broker_ready",
      code: "runtime_broker_ready_timeout",
    });

    expect(write).toHaveBeenCalledExactlyOnceWith(
      '{"type":"runtime_diagnostic","stage":"broker_ready","code":"runtime_broker_ready_timeout"}\n',
    );
  });

  it("writes only allowlisted per-probe failure categories", () => {
    const write = vi.fn();
    const diagnostic = createJsonLineRuntimeDiagnostic(write);

    diagnostic({
      type: "runtime_diagnostic",
      stage: "executor",
      code: "executor_application_failed",
      probeFailures: [
        { operation: "dns", code: "dns_resolution_failed" },
        { operation: "http-get", code: "connection_failed" },
      ],
    });

    expect(write).toHaveBeenCalledExactlyOnceWith(
      '{"type":"runtime_diagnostic","stage":"executor","code":"executor_application_failed","probeFailures":[{"operation":"dns","code":"dns_resolution_failed"},{"operation":"http-get","code":"connection_failed"}]}\n',
    );
  });

  it("rejects unsafe per-probe failure details", () => {
    const write = vi.fn();
    const diagnostic = createJsonLineRuntimeDiagnostic(write);

    diagnostic({
      type: "runtime_diagnostic",
      stage: "executor",
      code: "executor_application_failed",
      probeFailures: [
        { operation: "dns", code: "grumphya.com" },
      ] as never,
    });

    expect(write).not.toHaveBeenCalled();
  });

  it("projects runtime events to the allowlisted fields", () => {
    const write = vi.fn();
    const diagnostic = createJsonLineRuntimeDiagnostic(write);

    diagnostic({
      type: "runtime_diagnostic",
      stage: "broker_ready",
      code: "runtime_broker_ready_timeout",
      hostname: "private.example.net",
    } as Parameters<typeof diagnostic>[0]);

    expect(write).toHaveBeenCalledExactlyOnceWith(
      '{"type":"runtime_diagnostic","stage":"broker_ready","code":"runtime_broker_ready_timeout"}\n',
    );
  });

  it("ignores unsafe diagnostic values and bounded-attempt violations", () => {
    const write = vi.fn();
    const diagnostic = createJsonLineRuntimeDiagnostic(write);

    diagnostic({
      type: "runtime_diagnostic",
      stage: "broker_ready",
      code: "private hostname grumphya.com" as "runtime_broker_ready_timeout",
    });
    diagnostic({
      type: "runtime_diagnostic",
      stage: "broker_ready",
      code: "runtime_cleanup_retry",
      attempt: 4,
    });

    expect(write).not.toHaveBeenCalled();
  });

  it("does not change runtime behavior if the diagnostic sink fails", () => {
    const diagnostic = createJsonLineRuntimeDiagnostic(() => {
      throw new Error("private sink failure");
    });

    expect(() => diagnostic({
      type: "runtime_diagnostic",
      stage: "executor",
      code: "docker_runtime_command_failed",
    })).not.toThrow();
  });
});
