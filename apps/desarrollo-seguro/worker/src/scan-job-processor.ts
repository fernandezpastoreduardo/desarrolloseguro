import {
  evaluateVerdict,
  normalizeHostname,
  sanitizeScanObservations,
} from "@desarrolloseguro/core";
import {
  ScanLeaseLostError,
  type ClaimedScanJob,
  type ScanJobStore,
  type ScanRunInput,
} from "@desarrolloseguro/persistence";
import { performance } from "node:perf_hooks";

export type ScanExecutor = {
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
  type: "scan_job_outcome";
  outcome: ScanJobOutcome;
  durationMs: number;
};

export type ScanJobTelemetry = (event: ScanJobTelemetryEvent) => void;

const DEFAULT_LEASE_DURATION_MS = 30_000;
const HEARTBEAT_INTERVAL_MS = 10_000;
const MAX_EXECUTOR_ATTEMPTS = 3;

export class ScanJobProcessor {
  constructor(
    private readonly store: ScanJobStore,
    private readonly executor: ScanExecutor,
    private readonly now: () => Date = () => new Date(),
    private readonly heartbeatIntervalMs = HEARTBEAT_INTERVAL_MS,
    private readonly telemetry?: ScanJobTelemetry,
  ) {}

  async processNext(): Promise<ScanJobOutcome> {
    const startedAt = performance.now();
    try {
      const outcome = await this.processNextInternal();
      this.emitOutcome(outcome, startedAt);
      return outcome;
    } catch (error) {
      this.emitOutcome("failed", startedAt);
      throw error;
    }
  }

  private async processNextInternal(): Promise<ScanJobOutcome> {
    const claimed = await this.store.claimNextScan(
      this.now(),
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
    try {
      result = await this.executor.execute(claimed, abortController.signal);
    } catch {
      executorFailed = true;
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
          "executor_failed",
          MAX_EXECUTOR_ATTEMPTS,
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

  private emitOutcome(outcome: ScanJobOutcome, startedAt: number): void {
    if (!this.telemetry) return;
    const durationMs = Math.max(0, Math.round(performance.now() - startedAt));
    try {
      this.telemetry({ type: "scan_job_outcome", outcome, durationMs });
    } catch {
      // Telemetry must never change scan processing or expose private errors.
    }
  }
}
