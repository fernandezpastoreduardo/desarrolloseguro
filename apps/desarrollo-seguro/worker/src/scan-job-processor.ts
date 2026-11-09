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

export type ScanExecutor = {
  execute(
    job: ClaimedScanJob,
    signal: AbortSignal,
  ): Promise<
    Omit<ScanRunInput, "jobId" | "leaseToken" | "hostname" | "profileVersion">
  >;
};

const DEFAULT_LEASE_DURATION_MS = 30_000;
const HEARTBEAT_INTERVAL_MS = 10_000;

export class ScanJobProcessor {
  constructor(
    private readonly store: ScanJobStore,
    private readonly executor: ScanExecutor,
    private readonly now: () => Date = () => new Date(),
    private readonly heartbeatIntervalMs = HEARTBEAT_INTERVAL_MS,
  ) {}

  async processNext(): Promise<"idle" | "completed" | "lease_lost"> {
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
    >;
    try {
      result = await this.executor.execute(claimed, abortController.signal);
    } finally {
      clearInterval(heartbeatTimer);
      await heartbeatInFlight;
    }
    if (leaseLost) return "lease_lost";
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
}
