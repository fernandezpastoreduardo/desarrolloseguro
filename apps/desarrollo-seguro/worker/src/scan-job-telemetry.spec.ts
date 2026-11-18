import { describe, expect, it, vi } from "vitest";
import type { ScanJobTelemetryEvent } from "./scan-job-processor.js";
import { createJsonLineScanJobTelemetry } from "./scan-job-telemetry.js";

describe("createJsonLineScanJobTelemetry", () => {
  it("writes to stdout when no writer is provided", () => {
    const write = vi.spyOn(process.stdout, "write").mockReturnValue(true);
    try {
      createJsonLineScanJobTelemetry()({
        type: "scan_job_outcome",
        outcome: "idle",
        durationMs: 0,
      });

      expect(write).toHaveBeenCalledExactlyOnceWith(
        '{"type":"scan_job_outcome","outcome":"idle","durationMs":0}\n',
      );
    } finally {
      write.mockRestore();
    }
  });

  it("writes only the fixed outcome and duration fields as one JSON line", () => {
    const write = vi.fn();
    const telemetry = createJsonLineScanJobTelemetry(write);
    const event = {
      type: "scan_job_outcome",
      outcome: "completed",
      durationMs: 17,
      hostname: "private.example.net",
      jobId: "private-job-id",
    } as ScanJobTelemetryEvent;

    telemetry(event);

    expect(write).toHaveBeenCalledExactlyOnceWith(
      '{"type":"scan_job_outcome","outcome":"completed","durationMs":17}\n',
    );
    expect(write.mock.calls[0]?.[0]).not.toContain("private.example.net");
    expect(write.mock.calls[0]?.[0]).not.toContain("private-job-id");
  });

  it("writes a safe processing error category without private context", () => {
    const write = vi.fn();
    const telemetry = createJsonLineScanJobTelemetry(write);

    telemetry({
      type: "scan_job_error",
      code: "scan_verdict_does_not_match_checks",
      durationMs: 23,
    });

    expect(write).toHaveBeenCalledExactlyOnceWith(
      '{"type":"scan_job_error","code":"scan_verdict_does_not_match_checks","durationMs":23}\n',
    );
  });

  it.each([
    ["unexpected event type", { type: "scan_job_private", outcome: "completed", durationMs: 3 }],
    ["unknown outcome", { outcome: "other", durationMs: 3 }],
    ["negative duration", { outcome: "completed", durationMs: -1 }],
    ["fractional duration", { outcome: "completed", durationMs: 1.5 }],
    ["unsafe duration", { outcome: "completed", durationMs: Number.MAX_SAFE_INTEGER + 1 }],
    ["non-finite duration", { outcome: "completed", durationMs: Number.NaN }],
    ["unknown error code", { code: "private_error" }],
  ])("drops events with %s", (_label, event) => {
    const write = vi.fn();
    const telemetry = createJsonLineScanJobTelemetry(write);

    telemetry({ type: "scan_job_outcome", ...event } as ScanJobTelemetryEvent);

    expect(write).not.toHaveBeenCalled();
  });
});
