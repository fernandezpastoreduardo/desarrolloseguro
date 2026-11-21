import type { Pool } from "pg";
import {
  SCAN_FAILURE_CODES,
  evaluateVerdict,
  projectPublicEvidence,
  sanitizeScanObservations,
  parseScanFailureDiagnostic,
  type ScanFailureDiagnostic,
} from "@desarrolloseguro/core";
import type { ScanFailureCode } from "@desarrolloseguro/core";
export { SCAN_FAILURE_CODES };
export type { ScanFailureCode };

const MAX_LEASE_DURATION_MS = 5 * 60 * 1000;
const MAX_SCAN_ATTEMPTS = 10;
const PROFILE_VERSIONS = [
  "controls-v1",
  "controls-v2",
  "controls-v3",
  "transport-v1",
  "domain-v1",
  "domain-v2",
  "domain-v3",
] as const;
const CHECK_STATUSES = ["pass", "fail", "unknown", "not_applicable"] as const;
const ENROLLMENTS = ["monitored", "on_demand"] as const;
const TRIGGERS = ["scheduled", "requested"] as const;
const VERDICTS = ["pass", "fail", "inconclusive"] as const;
const SEVERITIES = ["critical", "high", "medium", "low", "info"] as const;
const INVALID_PUBLIC_REPORT_ROW = "invalid_public_report_row";
const MAX_PUBLIC_HISTORY_LIMIT = 12;
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
  reports.scope_json AS report_scope,
  (SELECT c.state FROM public.ds_beta_certifications AS c
   WHERE c.hostname = reports.hostname AND c.policy_version = 'beta-0.1') AS certification_state,
  (SELECT c.latest_assessment_status FROM public.ds_beta_certifications AS c
   WHERE c.hostname = reports.hostname AND c.policy_version = 'beta-0.1') AS certification_assessment_status,
  (SELECT c.latest_assessment FROM public.ds_beta_certifications AS c
   WHERE c.hostname = reports.hostname AND c.policy_version = 'beta-0.1') AS certification_assessment,
  (SELECT c.last_checked_at FROM public.ds_beta_certifications AS c
   WHERE c.hostname = reports.hostname AND c.policy_version = 'beta-0.1') AS certification_last_checked_at,
  (SELECT c.certified_report_id FROM public.ds_beta_certifications AS c
   WHERE c.hostname = reports.hostname AND c.policy_version = 'beta-0.1') AS certification_report_id`;
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
    'limitation', limitation,
    'evidence', evidence_json
  ) ORDER BY target_path, control_id, method) AS checks
  FROM public.ds_public_check_results WHERE run_id = reports.id
) AS check_rows ON true`;

export type ScanTrigger = "scheduled" | "requested";
export type ScanEnrollment = "monitored" | "on_demand";
export type ScanJobState = "queued" | "running" | "completed" | "failed";
export type ScanFailureDisposition = "retrying" | "failed";
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
  evidence: Record<string, unknown>;
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
  certification: PublicBetaCertification | null;
};

export type PublicBetaCertification = {
  policyVersion: "beta-0.1";
  state: "pending" | "active" | "suspended";
  latestAssessmentStatus: "eligible" | "pending" | "blocked";
  score: number | null;
  lastCheckedAt: Date;
  certifiedReportId: string | null;
};

export type ReportBadgeRecord = {
  hostname: string;
  reportId: string;
  tokenHash: string;
  expiresAt: Date;
};

export type PublicDomainSnapshot = {
  hostname: string;
  enrollment: ScanEnrollment;
  profileVersion: string;
  optedOut: boolean;
  activeJobId: string | null;
  lastReport: PublicScanReport | null;
  lastFailure?: { code: ScanFailureCode; failedAt: Date; diagnostic?: ScanFailureDiagnostic | null } | null;
  hostnameResolution?: {
    observedReportId: string;
    requestedHostname: string;
    canonicalHostname: string;
    statusCode: 301 | 308;
    responseStatusCode: number;
    fromHostname: string;
    toHostname: string;
  };
};

export type EnsureScanInput = {
  hostname: string;
  profileVersion: string;
  trigger: ScanTrigger;
};

export type EnsureScanResult =
  | { kind: "cached"; reportId: string }
  | { kind: "queued" | "running"; jobId: string }
  | { kind: "rate_limited" | "capacity_reached" | "unavailable" };

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
  recoverExpiredLeases(now: Date, maxAttempts: number): Promise<number>;
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
  failScan(
    jobId: string,
    leaseToken: string,
    failureCode: ScanFailureCode,
    maxAttempts: number,
    diagnostic?: ScanFailureDiagnostic | null,
  ): Promise<ScanFailureDisposition>;
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

  async issueReportBadge(record: ReportBadgeRecord): Promise<boolean> {
    const result = await this.pool.query(
      `INSERT INTO public.ds_report_badges(token_hash, hostname, report_id, expires_at)
       SELECT $1, reports.hostname, reports.id, $4
       FROM public.ds_scan_runs AS reports
       INNER JOIN public.ds_beta_certifications AS certification
         ON certification.hostname = reports.hostname
        AND certification.policy_version = 'beta-0.1'
        AND certification.state = 'active'
        AND certification.certified_report_id = reports.id
       WHERE reports.id = $2 AND reports.hostname = $3
         AND reports.expires_at > now()
         AND reports.profile_version IN ('domain-v1', 'domain-v2', 'domain-v3')
       RETURNING token_hash`,
      [record.tokenHash, record.reportId, record.hostname, record.expiresAt],
    );
    return result.rowCount === 1;
  }

  async resolveCanonicalHostname(hostname: string): Promise<string | null> {
    const result = await this.pool.query<{ canonical_hostname: string }>(
      `SELECT checks.evidence_json->>'canonicalHostname' AS canonical_hostname
       FROM (
         SELECT id, hostname, profile_version, expires_at
         FROM public.ds_scan_runs
         WHERE hostname = $1 AND profile_version IN ('domain-v1', 'domain-v2', 'domain-v3')
         ORDER BY completed_at DESC LIMIT 1
       ) AS reports
       INNER JOIN public.ds_public_check_results AS checks ON checks.run_id = reports.id
       WHERE reports.expires_at > now()
         AND checks.control_id = 'DS-HTTP-01' AND checks.method = 'GET'
         AND checks.evidence_json->>'requestedHostname' = $1
         AND checks.evidence_json->>'redirectStatusCode' IN ('301', '308')
         AND checks.evidence_json->>'redirectFromHostname' = $1
         AND checks.evidence_json->>'redirectToHostname' = checks.evidence_json->>'canonicalHostname'
         AND checks.evidence_json->>'finalHostname' = checks.evidence_json->>'canonicalHostname'
       LIMIT 1`,
      [hostname],
    );
    const canonicalHostname = result.rows[0]?.canonical_hostname;
    return canonicalHostname === "grumphya.com" || canonicalHostname === "www.grumphya.com"
      ? canonicalHostname
      : null;
  }

  async verifyReportBadge(input: { hostname: string; requestedHostname?: string; reportId: string; tokenHash: string; at: Date }): Promise<"verified" | "report_not_current" | "badge_expired" | "badge_revoked" | "redirect_not_valid"> {
    const result = await this.pool.query<Record<string, unknown>>(
      `SELECT badges.hostname AS badge_hostname, badges.expires_at, badges.revoked_at,
         certified_report.id AS current_report_id,
         certified_report.expires_at AS current_report_expires_at,
         certification.state AS certification_state,
         certification.certified_report_id
       FROM public.ds_report_badges AS badges
       LEFT JOIN public.ds_beta_certifications AS certification
         ON certification.hostname = badges.hostname
        AND certification.policy_version = 'beta-0.1'
       LEFT JOIN public.ds_scan_runs AS certified_report
         ON certified_report.id = certification.certified_report_id
        AND certified_report.hostname = certification.hostname
       WHERE badges.token_hash = $1 LIMIT 1`,
      [input.tokenHash],
    );
    const row = result.rows[0];
    if (!row) return "badge_expired";
    const requestedHostname = input.requestedHostname ?? input.hostname;
    const resolvedHostname = requestedHostname === input.hostname
      ? null
      : await this.resolveCanonicalHostname(requestedHostname);
    if (
      (requestedHostname !== input.hostname && resolvedHostname !== input.hostname) ||
      (row.badge_hostname !== requestedHostname && resolvedHostname !== row.badge_hostname)
    ) return "redirect_not_valid";
    if (row.badge_hostname !== input.hostname) {
      return "report_not_current";
    }
    if (row.revoked_at !== null) return "badge_revoked";
    if (!(row.expires_at instanceof Date) || row.expires_at <= input.at) return "badge_expired";
    if (
      row.current_report_id !== input.reportId ||
      row.certification_state !== "active" ||
      row.certified_report_id !== input.reportId ||
      !(row.current_report_expires_at instanceof Date) ||
      row.current_report_expires_at <= input.at
    ) return "report_not_current";
    return "verified";
  }

  async revokeReportBadge(input: { hostname: string; reportId: string; tokenHash: string; at: Date }): Promise<boolean> {
    const result = await this.pool.query(
      `UPDATE public.ds_report_badges
       SET revoked_at = $4
       WHERE token_hash = $1 AND hostname = $2 AND report_id = $3
         AND revoked_at IS NULL
       RETURNING token_hash`,
      [input.tokenHash, input.hostname, input.reportId, input.at],
    );
    return result.rowCount === 1;
  }

  async readPublicDomainSnapshot(
    hostname: string,
    resolveAlias = true,
  ): Promise<PublicDomainSnapshot | null> {
    const result = await this.pool.query<Record<string, unknown>>(
      `SELECT domains.hostname, domains.enrollment, domains.profile_version,
         domains.opted_out_at, active_job.id AS active_job_id,
         failed_job.public_error_code AS last_failure_code,
         failed_job.failure_diagnostic AS last_failure_diagnostic,
         failed_job.finished_at AS last_failure_at,
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
         SELECT public_error_code, failure_diagnostic, finished_at FROM public.ds_scan_jobs
         WHERE hostname = domains.hostname
           AND profile_version = domains.profile_version
           AND state = 'failed'
         ORDER BY finished_at DESC NULLS LAST, queued_at DESC LIMIT 1
       ) AS failed_job ON true
       LEFT JOIN LATERAL (
         SELECT id, hostname, profile_version, scanner_version, vantage,
           trigger, started_at, completed_at, expires_at, verdict, scope_json,
           (SELECT c.state FROM public.ds_beta_certifications AS c
            WHERE c.hostname = ds_scan_runs.hostname AND c.policy_version = 'beta-0.1') AS certification_state,
           (SELECT c.latest_assessment_status FROM public.ds_beta_certifications AS c
            WHERE c.hostname = ds_scan_runs.hostname AND c.policy_version = 'beta-0.1') AS certification_assessment_status,
           (SELECT c.latest_assessment FROM public.ds_beta_certifications AS c
            WHERE c.hostname = ds_scan_runs.hostname AND c.policy_version = 'beta-0.1') AS certification_assessment,
           (SELECT c.last_checked_at FROM public.ds_beta_certifications AS c
            WHERE c.hostname = ds_scan_runs.hostname AND c.policy_version = 'beta-0.1') AS certification_last_checked_at,
           (SELECT c.certified_report_id FROM public.ds_beta_certifications AS c
            WHERE c.hostname = ds_scan_runs.hostname AND c.policy_version = 'beta-0.1') AS certification_report_id
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
    const snapshot: PublicDomainSnapshot = {
      hostname: requireString(row.hostname),
      enrollment: parseEnrollment(row.enrollment),
      profileVersion: parseProfileVersion(row.profile_version),
      optedOut: row.opted_out_at !== null,
      activeJobId: row.active_job_id ? requireString(row.active_job_id) : null,
      lastReport: report,
      lastFailure: parsePublicScanFailure(row),
    };
    if (!resolveAlias || !report) return snapshot;
    const redirect = readGrumphyaRedirect(report, hostname);
    if (!redirect) return snapshot;
    const canonicalSnapshot = await this.readPublicDomainSnapshot(redirect.canonicalHostname, false);
    if (canonicalSnapshot) {
      return {
        ...canonicalSnapshot,
        hostname,
        hostnameResolution: redirect,
      };
    }
    return {
      ...snapshot,
      lastReport: null,
      hostnameResolution: redirect,
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

  async readPublicReportHistory(
    hostname: string,
    limit: number,
  ): Promise<PublicScanReport[]> {
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > MAX_PUBLIC_HISTORY_LIMIT) {
      throw new Error("invalid_public_history_limit");
    }
    const result = await this.pool.query<Record<string, unknown>>(
      `SELECT ${PUBLIC_REPORT_COLUMNS}, check_rows.checks
       FROM public.ds_scan_runs AS reports
       INNER JOIN public.ds_domains AS domains
         ON domains.hostname = reports.hostname
       ${PUBLIC_CHECKS_LATERAL}
       WHERE reports.hostname = $1
         AND reports.profile_version IN ('domain-v1', 'domain-v2', 'domain-v3')
         AND domains.opted_out_at IS NULL
       ORDER BY reports.completed_at DESC
       LIMIT $2`,
      [hostname, limit],
    );
    return result.rows.map(parsePublicScanReport);
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
    const result = await this.pool.query<{
      outcome: string;
      entity_id: string | null;
    }>(
      "SELECT outcome, entity_id FROM ds_ensure_fresh_scan($1, $2, $3)",
      [input.hostname, input.profileVersion, input.trigger],
    );
    return parseScanAdmission(result.rows[0]);
  }

  async requestOnDemandScan(hostname: string): Promise<EnsureScanResult> {
    const result = await this.pool.query<{
      outcome: string;
      entity_id: string | null;
    }>("SELECT outcome, entity_id FROM ds_request_on_demand_scan($1)", [hostname]);
    return parseScanAdmission(result.rows[0]);
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

  async failScan(
    jobId: string,
    leaseToken: string,
    failureCode: ScanFailureCode,
    maxAttempts: number,
    diagnostic: ScanFailureDiagnostic | null = null,
  ): Promise<ScanFailureDisposition> {
    if (!SCAN_FAILURE_CODES.includes(failureCode)) {
      throw new Error("invalid_scan_failure_code");
    }
    if (!Number.isSafeInteger(maxAttempts) || maxAttempts < 1 || maxAttempts > MAX_SCAN_ATTEMPTS) {
      throw new Error("invalid_scan_max_attempts");
    }
    let result: { rows: Array<{ ds_fail_scan: string }> };
    const safeDiagnostic = diagnostic == null ? null : parseScanFailureDiagnostic(diagnostic);
    try {
      result = await this.pool.query<{ ds_fail_scan: string }>(
        "SELECT ds_fail_scan($1, $2, $3, $4, $5::jsonb)",
        [jobId, leaseToken, failureCode, maxAttempts, safeDiagnostic ? JSON.stringify(safeDiagnostic) : null],
      );
    } catch (error) {
      if (error instanceof Error && error.message.includes("scan_lease_lost")) {
        throw new ScanLeaseLostError();
      }
      throw error;
    }
    const disposition = result.rows[0]?.ds_fail_scan;
    if (disposition !== "retrying" && disposition !== "failed") {
      throw new Error("invalid_scan_failure_disposition");
    }
    return disposition;
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

function parseScanAdmission(admission: {
  outcome: string;
  entity_id: string | null;
} | undefined): EnsureScanResult {
  if (!admission) throw new Error("scan_admission_result_missing");
  if (admission.outcome === "cached" && admission.entity_id) {
    return { kind: "cached", reportId: admission.entity_id };
  }
  if (
    (admission.outcome === "queued" || admission.outcome === "running") &&
    admission.entity_id
  ) {
    return { kind: admission.outcome, jobId: admission.entity_id };
  }
  if (
    admission.outcome === "rate_limited" ||
    admission.outcome === "capacity_reached" ||
    admission.outcome === "unavailable"
  ) {
    return { kind: admission.outcome };
  }
  throw new Error("invalid_scan_admission_result");
}

function parsePublicScanReport(row: Record<string, unknown>): PublicScanReport {
  if (row.report_vantage !== "same_vps") {
    throw new Error(INVALID_PUBLIC_REPORT_ROW);
  }
  const checks = parsePublicChecks(row.checks);
  const isAliasReport = checks.some((check) =>
    check.controlId === "DS-HTTP-01" && check.method === "GET" &&
    typeof check.evidence.canonicalHostname === "string",
  );
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
    checks,
    certification: isAliasReport ? null : parsePublicBetaCertification(row),
  };
}

function readGrumphyaRedirect(
  report: PublicScanReport,
  requestedHostname: string,
): NonNullable<PublicDomainSnapshot["hostnameResolution"]> | null {
  if (report.expiresAt.getTime() <= Date.now()) return null;
  const check = report.checks.find((item) =>
    item.controlId === "DS-HTTP-01" && item.method === "GET",
  );
  const evidence = check?.evidence;
  if (
    !evidence ||
    evidence.requestedHostname !== requestedHostname ||
    evidence.canonicalHostname !== evidence.finalHostname ||
    evidence.redirectFromHostname !== requestedHostname ||
    evidence.redirectToHostname !== evidence.canonicalHostname ||
    (evidence.redirectStatusCode !== 301 && evidence.redirectStatusCode !== 308) ||
    typeof evidence.finalHostname !== "string" ||
    typeof evidence.redirectFromHostname !== "string" ||
    typeof evidence.redirectToHostname !== "string" ||
    typeof evidence.canonicalHostname !== "string" ||
    typeof evidence.statusCode !== "number" ||
    evidence.statusCode < 100 || evidence.statusCode > 599 ||
    evidence.finalHostname === requestedHostname
  ) return null;
  return {
    observedReportId: report.id,
    requestedHostname,
    canonicalHostname: evidence.canonicalHostname,
    statusCode: evidence.redirectStatusCode,
    responseStatusCode: evidence.statusCode as number,
    fromHostname: evidence.redirectFromHostname,
    toHostname: evidence.redirectToHostname,
  };
}

function parsePublicBetaCertification(
  row: Record<string, unknown>,
): PublicBetaCertification | null {
  if (row.certification_state === null || row.certification_state === undefined) {
    return null;
  }
  if (
    !["pending", "active", "suspended"].includes(String(row.certification_state)) ||
    !["eligible", "pending", "blocked"].includes(String(row.certification_assessment_status)) ||
    !(row.certification_last_checked_at instanceof Date)
  ) {
    throw new Error(INVALID_PUBLIC_REPORT_ROW);
  }
  const assessment = row.certification_assessment;
  if (!isPlainRecord(assessment)) throw new Error(INVALID_PUBLIC_REPORT_ROW);
  const rawScore = assessment.score;
  if (rawScore !== null && typeof rawScore !== "number") {
    throw new Error(INVALID_PUBLIC_REPORT_ROW);
  }
  return {
    policyVersion: "beta-0.1",
    state: row.certification_state as PublicBetaCertification["state"],
    latestAssessmentStatus:
      row.certification_assessment_status as PublicBetaCertification["latestAssessmentStatus"],
    score: rawScore,
    lastCheckedAt: row.certification_last_checked_at,
    certifiedReportId:
      typeof row.certification_report_id === "string" ? row.certification_report_id : null,
  };
}

function parsePublicScanFailure(
  row: Record<string, unknown>,
): PublicDomainSnapshot["lastFailure"] {
  if (row.last_failure_code == null && row.last_failure_at == null) return null;
  return {
    code: parseOneOf(mapPublicScanFailureCode(row.last_failure_code), SCAN_FAILURE_CODES),
    failedAt: parseDate(row.last_failure_at),
    diagnostic: row.last_failure_diagnostic == null ? null : parseScanFailureDiagnostic(row.last_failure_diagnostic),
  };
}

function mapPublicScanFailureCode(value: unknown): unknown {
  if (value === "worker_lease_expired") return "executor_failed";
  return value;
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
      evidence: projectPublicEvidence(requireString(item.controlId), item.evidence),
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
