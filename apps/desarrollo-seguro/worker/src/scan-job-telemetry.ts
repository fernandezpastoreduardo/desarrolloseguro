import type {
  ScanJobOutcome,
  ScanJobErrorCode,
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
const SCAN_JOB_ERROR_CODES: ReadonlySet<ScanJobErrorCode> = new Set([
  "invalid_hostname",
  "scan_check_coverage_incomplete",
  "scan_check_duplicate",
  "scan_check_invalid",
  "scan_control_not_allowlisted",
  "scan_evidence_invalid",
  "scan_lease_lost",
  "scan_profile_controls_incomplete",
  "scan_profile_not_catalogued",
  "scan_scope_not_allowlisted",
  "scan_check_payload_not_allowlisted",
  "scan_verdict_does_not_match_checks",
  "invalid_scan_checks",
  "invalid_scan_report",
  "scan_run_insert_failed",
  "worker_processing_failed",
]);

export type ScanJobTelemetryWriter = (line: string) => void;

/** Emits low-cardinality scan diagnostics and outcomes as one JSON line to stdout. */
export function createJsonLineScanJobTelemetry(
  write: ScanJobTelemetryWriter = (line) => {
    process.stdout.write(line);
  },
): ScanJobTelemetry {
  return (event) => {
    if (!isSafeTelemetryEvent(event)) return;

    if (event.type === "scan_job_error") {
      write(`${JSON.stringify({
        type: "scan_job_error",
        code: event.code,
        durationMs: event.durationMs,
      })}\n`);
      return;
    }
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
    Number.isSafeInteger(event.durationMs) &&
    event.durationMs >= 0 &&
    ((event.type === "scan_job_outcome" &&
      event.outcome !== undefined &&
      SCAN_JOB_OUTCOMES.has(event.outcome)) ||
      (event.type === "scan_job_error" &&
        event.code !== undefined &&
        SCAN_JOB_ERROR_CODES.has(event.code)))
  );
}
