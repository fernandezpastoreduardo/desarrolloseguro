import type { Pool, PoolClient } from "pg";
import {
  evaluateVerdict,
  sanitizeScanObservations,
} from "@desarrolloseguro/core";

const ACTIVE_JOB_STATES = ["queued", "running"] as const;
const MAX_LEASE_DURATION_MS = 5 * 60 * 1000;
const PROFILE_VERSIONS = [
  "controls-v1",
  "controls-v2",
  "controls-v3",
  "transport-v1",
] as const;
const CHECK_STATUSES = ["pass", "fail", "unknown", "not_applicable"] as const;
const ENROLLMENTS = ["monitored", "on_demand"] as const;
const TRIGGERS = ["scheduled", "requested"] as const;
const VERDICTS = ["pass", "fail", "inconclusive"] as const;
const SEVERITIES = ["critical", "high", "medium", "low", "info"] as const;
const INVALID_PUBLIC_REPORT_ROW = "invalid_public_report_row";
const PUBLIC_REPORT_COLUMNS = `
  reports.id AS report_id,
  reports.hostname AS report_hostname,
  reports.profile_version AS report_profile_version,
  reports.scanner_version AS report_scanner_version,
  reports.vantage AS report_vantage,
  reports.trigger AS report_trigger,
  reports.started_at AS report_started_at,
  reports.completed_at AS report_completed_at,
  reports.expires_at AS report_expires_at,
  reports.verdict AS report_verdict,
  reports.scope_json AS report_scope`;
const PUBLIC_CHECKS_LATERAL = `LEFT JOIN LATERAL (
  SELECT jsonb_agg(jsonb_build_object(
    'controlId', control_id,
    'status', status,
    'required', required,
    'severity', severity,
    'observedAt', observed_at,
    'targetPath', target_path,
    'method', method,
    'summary', summary,
    'limitation', limitation
  ) ORDER BY target_path, control_id, method) AS checks
  FROM public.ds_check_results WHERE run_id = reports.id
) AS check_rows ON true`;

export type ScanTrigger = "scheduled" | "requested";
export type ScanEnrollment = "monitored" | "on_demand";
export type ScanJobState = "queued" | "running" | "completed" | "failed";
export type ScanVerdict = "pass" | "fail" | "inconclusive";
export type CheckStatus = "pass" | "fail" | "unknown" | "not_applicable";
export type PublicScanStatus = CheckStatus;
export type PublicScanSeverity = (typeof SEVERITIES)[number];

export type PublicScanReportCheck = {
  controlId: string;
  status: PublicScanStatus;
  required: boolean;
  severity: PublicScanSeverity;
  observedAt: Date;
  targetPath: string;
  method: string;
  summary: string;
  limitation: string;
};

export type PublicScanReport = {
  id: string;
  hostname: string;
  profileVersion: string;
  scannerVersion: string;
  vantage: "same_vps";
  trigger: ScanTrigger;
  startedAt: Date;
  completedAt: Date;
  expiresAt: Date;
  verdict: ScanVerdict;
  scope: string[];
  checks: PublicScanReportCheck[];
};

export type PublicDomainSnapshot = {
  hostname: string;
  enrollment: ScanEnrollment;
  profileVersion: string;
  optedOut: boolean;
  activeJobId: string | null;
  lastReport: PublicScanReport | null;
};

export type EnsureScanInput = {
  hostname: string;
  profileVersion: string;
  trigger: ScanTrigger;
  now: Date;
};

export type EnsureScanResult =
  | { kind: "cached"; reportId: string }
  | { kind: "queued" | "running"; jobId: string };

export type ClaimedScanJob = {
  id: string;
  hostname: string;
  profileVersion: string;
  trigger: ScanTrigger;
  attempts: number;
  leaseToken: string;
  leaseUntil: Date;
};

export type ScanCheck = {
  controlId: string;
  status: CheckStatus;
  required: boolean;
  severity: string;
  observedAt: Date;
  targetPath: string;
  method: string;
  summary: string;
  limitation: string;
  evidence: Record<string, unknown>;
};

export type ScanRunInput = {
  jobId: string;
  leaseToken: string;
  hostname: string;
  profileVersion: string;
  scannerVersion: string;
  startedAt: Date;
  completedAt: Date;
  verdict: ScanVerdict;
  scope: readonly string[];
  checks: readonly ScanCheck[];
  metrics: {
    requestsCount: number;
    bytesCount: number;
    durationMs: number;
    pagesCount: number;
  };
};

export interface ScanJobStore {
  claimNextScan(
    now: Date,
    leaseDurationMs: number,
  ): Promise<ClaimedScanJob | null>;
  renewScanLease(
    jobId: string,
    leaseToken: string,
    now: Date,
    leaseDurationMs: number,
  ): Promise<boolean>;
  completeScan(input: ScanRunInput): Promise<string>;
}

export class ScanLeaseLostError extends Error {
  constructor() {
    super("scan_lease_lost");
    this.name = "ScanLeaseLostError";
  }
}

export class PostgresScanStore implements ScanJobStore {
  constructor(private readonly pool: Pool) {}

  async healthCheck(): Promise<boolean> {
    try {
      await this.pool.query("SELECT 1");
      return true;
    } catch {
      return false;
    }
  }

  async readPublicDomainSnapshot(
    hostname: string,
  ): Promise<PublicDomainSnapshot | null> {
    const result = await this.pool.query<Record<string, unknown>>(
      `SELECT domains.hostname, domains.enrollment, domains.profile_version,
         domains.opted_out_at, active_job.id AS active_job_id,
         ${PUBLIC_REPORT_COLUMNS}, check_rows.checks
       FROM public.ds_domains AS domains
       LEFT JOIN LATERAL (
         SELECT id FROM public.ds_scan_jobs
         WHERE hostname = domains.hostname
           AND profile_version = domains.profile_version
           AND state IN ('queued', 'running')
         ORDER BY queued_at ASC LIMIT 1
       ) AS active_job ON true
       LEFT JOIN LATERAL (
         SELECT id, hostname, profile_version, scanner_version, vantage,
           trigger, started_at, completed_at, expires_at, verdict, scope_json
         FROM public.ds_scan_runs
         WHERE hostname = domains.hostname
           AND profile_version = domains.profile_version
         ORDER BY completed_at DESC LIMIT 1
       ) AS reports ON true
       ${PUBLIC_CHECKS_LATERAL}
       WHERE domains.hostname = $1`,
      [hostname],
    );
    const row = result.rows[0];
    if (!row) return null;

    const report = row.report_id ? parsePublicScanReport(row) : null;
    return {
      hostname: requireString(row.hostname),
      enrollment: parseEnrollment(row.enrollment),
      profileVersion: parseProfileVersion(row.profile_version),
      optedOut: row.opted_out_at !== null,
      activeJobId: row.active_job_id ? requireString(row.active_job_id) : null,
      lastReport: report,
    };
  }

  async readPublicReport(reportId: string): Promise<PublicScanReport | null> {
    const result = await this.pool.query<Record<string, unknown>>(
      `SELECT ${PUBLIC_REPORT_COLUMNS}, check_rows.checks
       FROM public.ds_scan_runs AS reports
       INNER JOIN public.ds_domains AS domains
         ON domains.hostname = reports.hostname
       ${PUBLIC_CHECKS_LATERAL}
       WHERE reports.id = $1::uuid
         AND domains.opted_out_at IS NULL`,
      [reportId],
    );
    const row = result.rows[0];
    return row ? parsePublicScanReport(row) : null;
  }

  async close(): Promise<void> {
    await this.pool.end();
  }

  async ensureDomain(
    hostname: string,
    enrollment: ScanEnrollment,
    profileVersion: string,
  ): Promise<void> {
    await this.pool.query(
      `INSERT INTO ds_domains(hostname, enrollment, profile_version)
       VALUES($1, $2, $3)
       ON CONFLICT(hostname) DO NOTHING`,
      [hostname, enrollment, profileVersion],
    );
  }

  async ensureFreshScan(input: EnsureScanInput): Promise<EnsureScanResult> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const fresh = await client.query<{ id: string }>(
        `SELECT id FROM ds_scan_runs
         WHERE hostname = $1 AND profile_version = $2
           AND completed_at <= $3
           AND completed_at > $3 - interval '60 minutes'
         ORDER BY completed_at DESC LIMIT 1`,
        [input.hostname, input.profileVersion, input.now],
      );
      if (fresh.rows[0]) {
        await client.query("COMMIT");
        return { kind: "cached", reportId: fresh.rows[0].id };
      }

      const existing = await client.query<{
        id: string;
        state: "queued" | "running";
      }>(
        `SELECT id, state FROM ds_scan_jobs
         WHERE hostname = $1 AND profile_version = $2 AND state = ANY($3)
         LIMIT 1 FOR UPDATE`,
        [input.hostname, input.profileVersion, ACTIVE_JOB_STATES],
      );
      if (existing.rows[0]) {
        await client.query("COMMIT");
        return {
          kind: existing.rows[0].state,
          jobId: existing.rows[0].id,
        };
      }

      const inserted = await client.query<{ id: string }>(
        `INSERT INTO ds_scan_jobs(
           hostname, profile_version, trigger, state, queued_at, available_at
         ) VALUES($1, $2, $3, 'queued', $4, $4)
         ON CONFLICT(hostname, profile_version)
           WHERE state IN ('queued', 'running') DO NOTHING
         RETURNING id`,
        [input.hostname, input.profileVersion, input.trigger, input.now],
      );
      if (inserted.rows[0]) {
        await client.query("COMMIT");
        return { kind: "queued", jobId: inserted.rows[0].id };
      }

      const raced = await findActiveJob(
        client,
        input.hostname,
        input.profileVersion,
      );
      if (!raced) {
        throw new Error("active_scan_job_missing_after_conflict");
      }
      await client.query("COMMIT");
      return { kind: raced.state, jobId: raced.id };
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async claimNextScan(
    _now: Date,
    leaseDurationMs: number,
  ): Promise<ClaimedScanJob | null> {
    if (
      !Number.isSafeInteger(leaseDurationMs) ||
      leaseDurationMs < 1 ||
      leaseDurationMs > MAX_LEASE_DURATION_MS
    ) {
      throw new Error("invalid_scan_lease_duration");
    }

    const result = await this.pool.query<{
      id: string;
      hostname: string;
      profile_version: string;
      trigger: ScanTrigger;
      attempts: number;
      lease_token: string;
      lease_until: Date;
    }>("SELECT * FROM ds_claim_next_scan($1)", [leaseDurationMs]);
    const job = result.rows[0];
    if (!job) return null;

    return {
      id: job.id,
      hostname: job.hostname,
      profileVersion: job.profile_version,
      trigger: job.trigger,
      attempts: job.attempts,
      leaseToken: job.lease_token,
      leaseUntil: job.lease_until,
    };
  }

  async recoverExpiredLeases(_now: Date, maxAttempts: number): Promise<number> {
    if (!Number.isSafeInteger(maxAttempts) || maxAttempts < 1) {
      throw new Error("invalid_scan_max_attempts");
    }

    const result = await this.pool.query<{
      ds_recover_expired_scan_leases: number;
    }>("SELECT ds_recover_expired_scan_leases($1)", [maxAttempts]);
    return result.rows[0]?.ds_recover_expired_scan_leases ?? 0;
  }

  async renewScanLease(
    jobId: string,
    leaseToken: string,
    _now: Date,
    leaseDurationMs: number,
  ): Promise<boolean> {
    if (
      !Number.isSafeInteger(leaseDurationMs) ||
      leaseDurationMs < 1 ||
      leaseDurationMs > MAX_LEASE_DURATION_MS
    ) {
      throw new Error("invalid_scan_lease_duration");
    }
    const result = await this.pool.query<{ ds_renew_scan_lease: boolean }>(
      "SELECT ds_renew_scan_lease($1, $2, $3)",
      [jobId, leaseToken, leaseDurationMs],
    );
    return result.rows[0]?.ds_renew_scan_lease ?? false;
  }

  async completeScan(input: ScanRunInput): Promise<string> {
    const observations = sanitizeScanObservations(
      input.hostname,
      input.profileVersion,
      input.scope,
      input.checks,
    );
    if (evaluateVerdict(observations.checks) !== input.verdict) {
      throw new Error("scan_verdict_does_not_match_checks");
    }

    try {
      const result = await this.pool.query<{ ds_complete_scan: string }>(
        `SELECT ds_complete_scan(
          $1, $2, $3, $4, $5, $6, $7::jsonb, $8::jsonb, $9::jsonb
        )`,
        [
          input.jobId,
          input.leaseToken,
          input.completedAt,
          input.scannerVersion,
          input.startedAt,
          input.verdict,
          JSON.stringify(observations.scope),
          JSON.stringify(observations.checks),
          JSON.stringify(input.metrics),
        ],
      );
      const runId = result.rows[0]?.ds_complete_scan;
      if (!runId) throw new Error("scan_run_insert_failed");
      return runId;
    } catch (error) {
      if (error instanceof Error && error.message.includes("scan_lease_lost")) {
        throw new ScanLeaseLostError();
      }
      throw error;
    }
  }
}

async function findActiveJob(
  client: PoolClient,
  hostname: string,
  profileVersion: string,
): Promise<{ id: string; state: "queued" | "running" } | null> {
  const result = await client.query<{
    id: string;
    state: "queued" | "running";
  }>(
    `SELECT id, state FROM ds_scan_jobs
     WHERE hostname = $1 AND profile_version = $2 AND state = ANY($3)
     LIMIT 1`,
    [hostname, profileVersion, ACTIVE_JOB_STATES],
  );
  return result.rows[0] ?? null;
}

function parsePublicScanReport(row: Record<string, unknown>): PublicScanReport {
  if (row.report_vantage !== "same_vps") {
    throw new Error(INVALID_PUBLIC_REPORT_ROW);
  }
  return {
    id: requireString(row.report_id),
    hostname: requireString(row.report_hostname),
    profileVersion: parseProfileVersion(row.report_profile_version),
    scannerVersion: requireString(row.report_scanner_version),
    vantage: "same_vps",
    trigger: parseOneOf(row.report_trigger, TRIGGERS),
    startedAt: parseDate(row.report_started_at),
    completedAt: parseDate(row.report_completed_at),
    expiresAt: parseDate(row.report_expires_at),
    verdict: parseOneOf(row.report_verdict, VERDICTS),
    scope: parseStringArray(row.report_scope),
    checks: parsePublicChecks(row.checks),
  };
}

function parsePublicChecks(value: unknown): PublicScanReportCheck[] {
  if (!Array.isArray(value)) throw new Error(INVALID_PUBLIC_REPORT_ROW);
  return value.map((item) => {
    if (!isPlainRecord(item)) throw new Error(INVALID_PUBLIC_REPORT_ROW);
    return {
      controlId: requireString(item.controlId),
      status: parseOneOf(item.status, CHECK_STATUSES),
      required: requireBoolean(item.required),
      severity: parseOneOf(item.severity, SEVERITIES),
      observedAt: parseDate(item.observedAt),
      targetPath: requireString(item.targetPath),
      method: requireString(item.method),
      summary: requireString(item.summary),
      limitation: requireString(item.limitation),
    };
  });
}

function parseStringArray(value: unknown): string[] {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
    throw new Error(INVALID_PUBLIC_REPORT_ROW);
  }
  return value;
}

function parseDate(value: unknown): Date {
  const date = value instanceof Date ? value : new Date(String(value));
  if (!Number.isFinite(date.getTime())) {
    throw new Error(INVALID_PUBLIC_REPORT_ROW);
  }
  return date;
}

function parseProfileVersion(value: unknown): string {
  return parseOneOf(value, PROFILE_VERSIONS);
}

function parseEnrollment(value: unknown): ScanEnrollment {
  return parseOneOf(value, ENROLLMENTS);
}

function parseOneOf<const T extends readonly string[]>(
  value: unknown,
  allowedValues: T,
): T[number] {
  if (typeof value !== "string" || !allowedValues.includes(value)) {
    throw new Error(INVALID_PUBLIC_REPORT_ROW);
  }
  return value as T[number];
}

function requireString(value: unknown): string {
  if (typeof value !== "string") throw new Error(INVALID_PUBLIC_REPORT_ROW);
  return value;
}

function requireBoolean(value: unknown): boolean {
  if (typeof value !== "boolean") throw new Error(INVALID_PUBLIC_REPORT_ROW);
  return value;
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype
  );
}
