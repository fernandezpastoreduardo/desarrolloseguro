import {
  evaluateVerdict,
  normalizeHostname,
  sanitizeScanObservations,
  SCAN_FAILURE_CODES,
  parseScanFailureDiagnostic,
  type ScanFailureCode,
} from "@desarrolloseguro/core";
import {
  ScanLeaseLostError,
  type ClaimedScanJob,
  type ScanJobStore,
  type ScanRunInput,
} from "@desarrolloseguro/persistence";
import { performance } from "node:perf_hooks";

export type ScanExecutor = {
  assertReady?(): Promise<void>;
  execute(
    job: ClaimedScanJob,
    signal: AbortSignal,
  ): Promise<
    Omit<ScanRunInput, "jobId" | "leaseToken" | "hostname" | "profileVersion">
  >;
};

export type ScanJobOutcome =
  | "idle"
  | "completed"
  | "lease_lost"
  | "retrying"
  | "failed";

export type ScanJobTelemetryEvent = {
  type: "scan_job_outcome" | "scan_job_error";
  outcome?: ScanJobOutcome;
  code?: ScanJobErrorCode;
  durationMs: number;
};

export type ScanJobErrorCode =
  | "invalid_hostname"
  | "scan_check_coverage_incomplete"
  | "scan_check_duplicate"
  | "scan_check_invalid"
  | "scan_control_not_allowlisted"
  | "scan_evidence_invalid"
  | "scan_lease_lost"
  | "scan_profile_controls_incomplete"
  | "scan_profile_not_catalogued"
  | "scan_scope_not_allowlisted"
  | "scan_check_payload_not_allowlisted"
  | "scan_verdict_does_not_match_checks"
  | "invalid_scan_checks"
  | "invalid_scan_report"
  | "scan_run_insert_failed"
  | "worker_processing_failed";

export type ScanJobTelemetry = (event: ScanJobTelemetryEvent) => void;

const DEFAULT_LEASE_DURATION_MS = 30_000;
const HEARTBEAT_INTERVAL_MS = 10_000;
const MAX_EXECUTOR_ATTEMPTS = 3;
const DEFAULT_LEASE_RECOVERY_INTERVAL_MS = 15_000;

export class ScanJobProcessor {
  private lastLeaseRecoveryAt: number | null = null;
  private leaseRecoveryInFlight: Promise<void> | null = null;

  constructor(
    private readonly store: ScanJobStore,
    private readonly executor: ScanExecutor,
    private readonly now: () => Date = () => new Date(),
    private readonly heartbeatIntervalMs = HEARTBEAT_INTERVAL_MS,
    private readonly telemetry?: ScanJobTelemetry,
    private readonly leaseRecoveryIntervalMs = DEFAULT_LEASE_RECOVERY_INTERVAL_MS,
  ) {}

  async processNext(): Promise<ScanJobOutcome> {
    const startedAt = performance.now();
    try {
      const outcome = await this.processNextInternal();
      this.emitOutcome(outcome, startedAt);
      return outcome;
    } catch (error) {
      this.emitError(error, startedAt);
      this.emitOutcome("failed", startedAt);
      throw error;
    }
  }

  private async processNextInternal(): Promise<ScanJobOutcome> {
    await this.executor.assertReady?.();
    const claimedAt = this.now();
    await this.recoverExpiredLeasesIfDue(claimedAt);
    const claimed = await this.store.claimNextScan(
      claimedAt,
      DEFAULT_LEASE_DURATION_MS,
    );
    if (!claimed) return "idle";

    if (normalizeHostname(claimed.hostname) !== claimed.hostname) {
      throw new Error("invalid_hostname");
    }

    const abortController = new AbortController();
    let leaseLost = false;
    let heartbeatInFlight: Promise<void> | null = null;
    const heartbeatTimer = setInterval(() => {
      if (heartbeatInFlight) return;
      heartbeatInFlight = this.store
        .renewScanLease(
          claimed.id,
          claimed.leaseToken,
          this.now(),
          DEFAULT_LEASE_DURATION_MS,
        )
        .then((renewed) => {
          if (renewed) return;
          leaseLost = true;
          abortController.abort();
        })
        .catch(() => {
          leaseLost = true;
          abortController.abort();
        })
        .finally(() => {
          heartbeatInFlight = null;
        });
    }, this.heartbeatIntervalMs);
    heartbeatTimer.unref?.();

    let result: Omit<
      ScanRunInput,
      "jobId" | "leaseToken" | "hostname" | "profileVersion"
    > | undefined;
    let executorFailed = false;
    let executorError: unknown;
    try {
      result = await this.executor.execute(claimed, abortController.signal);
    } catch (error: unknown) {
      executorFailed = true;
      executorError = error;
    } finally {
      clearInterval(heartbeatTimer);
      await heartbeatInFlight;
    }
    if (leaseLost) return "lease_lost";
    if (executorFailed || result === undefined) {
      try {
        return await this.store.failScan(
          claimed.id,
          claimed.leaseToken,
          getFailureCode(executorError),
          MAX_EXECUTOR_ATTEMPTS,
          getFailureDiagnostic(executorError),
        );
      } catch (error) {
        if (error instanceof ScanLeaseLostError) return "lease_lost";
        throw error;
      }
    }
    const observations = sanitizeScanObservations(
      claimed.hostname,
      claimed.profileVersion,
      result.scope,
      result.checks,
    );
    if (evaluateVerdict(observations.checks) !== result.verdict) {
      throw new Error("scan_verdict_does_not_match_checks");
    }

    try {
      await this.store.completeScan({
        ...result,
        ...observations,
        jobId: claimed.id,
        leaseToken: claimed.leaseToken,
        hostname: claimed.hostname,
        profileVersion: claimed.profileVersion,
      });
      return "completed";
    } catch (error) {
      if (error instanceof ScanLeaseLostError) {
        return "lease_lost";
      }
      throw error;
    }
  }

  private async recoverExpiredLeasesIfDue(now: Date): Promise<void> {
    const nowMs = now.getTime();
    if (
      !Number.isSafeInteger(nowMs) ||
      !Number.isSafeInteger(this.leaseRecoveryIntervalMs) ||
      this.leaseRecoveryIntervalMs < 1
    ) {
      throw new Error("scan_lease_recovery_configuration_invalid");
    }

    if (this.leaseRecoveryInFlight) await this.leaseRecoveryInFlight;
    if (
      this.lastLeaseRecoveryAt !== null &&
      nowMs - this.lastLeaseRecoveryAt < this.leaseRecoveryIntervalMs
    ) {
      return;
    }

    const recovery = this.store
      .recoverExpiredLeases(now, MAX_EXECUTOR_ATTEMPTS)
      .then(() => {
        this.lastLeaseRecoveryAt = nowMs;
      })
      .finally(() => {
        if (this.leaseRecoveryInFlight === recovery) {
          this.leaseRecoveryInFlight = null;
        }
      });
    this.leaseRecoveryInFlight = recovery;
    await recovery;
  }

  private emitOutcome(outcome: ScanJobOutcome, startedAt: number): void {
    if (!this.telemetry) return;
    const durationMs = Math.max(0, Math.round(performance.now() - startedAt));
    try {
      this.telemetry({ type: "scan_job_outcome", outcome, durationMs });
    } catch {
      // Telemetry must never change scan processing or expose private errors.
    }
  }

  private emitError(error: unknown, startedAt: number): void {
    if (!this.telemetry) return;
    const durationMs = Math.max(0, Math.round(performance.now() - startedAt));
    try {
      this.telemetry({
        type: "scan_job_error",
        code: getProcessingErrorCode(error),
        durationMs,
      });
    } catch {
      // Telemetry must never change scan processing or expose private errors.
    }
  }
}

const PROCESSING_ERROR_CODES: readonly ScanJobErrorCode[] = [
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
];

function getProcessingErrorCode(error: unknown): ScanJobErrorCode {
  if (
    error instanceof Error &&
    PROCESSING_ERROR_CODES.includes(error.message as ScanJobErrorCode)
  ) {
    return error.message as ScanJobErrorCode;
  }
  return "worker_processing_failed";
}

function getFailureCode(error: unknown): ScanFailureCode {
  if (
    error instanceof Error &&
    SCAN_FAILURE_CODES.includes(error.message as ScanFailureCode)
  ) {
    return error.message as ScanFailureCode;
  }
  return "executor_failed";
}

function getFailureDiagnostic(error: unknown) {
  if (!(error instanceof Error) || !("scanFailureDiagnostic" in error)) return null;
  return parseScanFailureDiagnostic(error.scanFailureDiagnostic);
}
