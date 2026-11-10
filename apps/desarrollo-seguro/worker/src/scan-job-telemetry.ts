import type {
  ScanJobOutcome,
  ScanJobTelemetry,
  ScanJobTelemetryEvent,
} from "./scan-job-processor.js";

const SCAN_JOB_OUTCOMES: ReadonlySet<ScanJobOutcome> = new Set([
  "idle",
  "completed",
  "lease_lost",
  "retrying",
  "failed",
]);

export type ScanJobTelemetryWriter = (line: string) => void;

/** Emits low-cardinality scan outcome metrics as one JSON line to stdout. */
export function createJsonLineScanJobTelemetry(
  write: ScanJobTelemetryWriter = (line) => {
    process.stdout.write(line);
  },
): ScanJobTelemetry {
  return (event) => {
    if (!isSafeTelemetryEvent(event)) return;

    write(`${JSON.stringify({
      type: "scan_job_outcome",
      outcome: event.outcome,
      durationMs: event.durationMs,
    })}\n`);
  };
}

function isSafeTelemetryEvent(
  event: ScanJobTelemetryEvent,
): boolean {
  return (
    event.type === "scan_job_outcome" &&
    SCAN_JOB_OUTCOMES.has(event.outcome) &&
    Number.isSafeInteger(event.durationMs) &&
    event.durationMs >= 0
  );
}
