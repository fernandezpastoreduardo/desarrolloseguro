import { Pool } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  PostgresScanStore,
  ScanLeaseLostError,
  type ClaimedScanJob,
  type ScanCheck,
} from "./scan-store.js";
import { runDevelopmentSecurityMigrations } from "./run-migrations.js";
import { isSafePostgresTestTarget } from "./postgres-test-safety.js";

const TEST_DATABASE_URL = process.env.DS_TEST_DATABASE_URL;
const TEST_POSTGRES_ISOLATED = process.env.DS_TEST_POSTGRES_ISOLATED;
const TEST_HOSTNAME = "sample.example.net";
const TEST_PROFILE = "controls-v1";
const TEST_SCANNER = "scanner-test-version";
const TEST_NOW = new Date();
const TEST_START = new Date(TEST_NOW.getTime() - 60_000);
const TEST_LEASE_MS = 30_000;
const MAX_ATTEMPTS = 2;

const describePostgres = isSafePostgresTestTarget(
  TEST_DATABASE_URL,
  TEST_POSTGRES_ISOLATED,
)
  ? describe
  : describe.skip;

describePostgres.sequential("PostgresScanStore", () => {
  let pool: Pool;
  let store: PostgresScanStore;

  beforeAll(async () => {
    if (!TEST_DATABASE_URL) return;
    pool = new Pool({ connectionString: TEST_DATABASE_URL });
    store = new PostgresScanStore(pool);
    await runDevelopmentSecurityMigrations(pool);
  });

  beforeEach(async () => {
    if (!pool) return;
    await pool.query(
      `TRUNCATE ds_scan_metrics, ds_check_results, ds_scan_runs,
       ds_scan_jobs, ds_domains CASCADE`,
    );
    await store.ensureDomain(TEST_HOSTNAME, "monitored", TEST_PROFILE);
  });

  afterAll(async () => {
    await pool?.end();
  });

  it("keeps domain enrollment stable when on-demand requests repeat", async () => {
    await store.ensureDomain(TEST_HOSTNAME, "on_demand", "new-profile");
    const result = await pool.query(
      "SELECT enrollment, profile_version FROM ds_domains WHERE hostname = $1",
      [TEST_HOSTNAME],
    );

    expect(result.rows[0]).toEqual({
      enrollment: "monitored",
      profile_version: TEST_PROFILE,
    });
  });

  it("issues report badges only for a matching domain-v1 report and supports binding and revocation", async () => {
    const hostname = "grumphya.com";
    await store.ensureDomain(hostname, "on_demand", "domain-v1");
    const job = await pool.query<{ id: string }>(
      `INSERT INTO ds_scan_jobs(hostname, profile_version, trigger, state)
       VALUES ($1, 'domain-v1', 'requested', 'completed') RETURNING id`,
      [hostname],
    );
    const run = await pool.query<{ id: string }>(
      `INSERT INTO ds_scan_runs(job_id, hostname, profile_version, scanner_version,
        vantage, trigger, started_at, completed_at, expires_at, verdict, scope_json)
       VALUES ($1, $2, 'domain-v1', 'test', 'same_vps', 'requested', now(), now(),
        now() + interval '60 minutes', 'pass', '[]'::jsonb) RETURNING id`,
      [job.rows[0].id, hostname],
    );
    const tokenHash = "a".repeat(64);
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);

    await expect(store.issueReportBadge({ hostname, reportId: run.rows[0].id, tokenHash, expiresAt })).resolves.toBe(true);
    await expect(store.issueReportBadge({ hostname: "other.example", reportId: run.rows[0].id, tokenHash: "b".repeat(64), expiresAt })).resolves.toBe(false);
    await expect(store.verifyReportBadge({ hostname: "other.example", reportId: run.rows[0].id, tokenHash, at: new Date() })).resolves.toBe(false);
    await expect(store.verifyReportBadge({ hostname, reportId: run.rows[0].id, tokenHash, at: new Date() })).resolves.toBe(true);
    await expect(store.verifyReportBadge({ hostname, reportId: run.rows[0].id, tokenHash, at: new Date(expiresAt.getTime() + 1) })).resolves.toBe(false);
    await expect(store.revokeReportBadge({ hostname, reportId: run.rows[0].id, tokenHash, at: new Date() })).resolves.toBe(true);
    await expect(store.verifyReportBadge({ hostname, reportId: run.rows[0].id, tokenHash, at: new Date() })).resolves.toBe(false);
  });

  it("shares one active job across concurrent requests", async () => {
    const requests = Array.from({ length: 10 }, () =>
      store.ensureFreshScan({
        hostname: TEST_HOSTNAME,
        profileVersion: TEST_PROFILE,
        trigger: "requested",
      }),
    );
    const results = await Promise.all(requests);
    const jobIds = new Set(
      results.flatMap((result) =>
        result.kind === "queued" || result.kind === "running"
          ? [result.jobId]
          : [],
      ),
    );

    expect(jobIds.size).toBe(1);
    expect([...jobIds][0]).toBeTruthy();
    expect(results.every((result) => result.kind === "queued")).toBe(true);
  });

  it("caps the shared waiting queue when callers race across domains", async () => {
    const hostnames = Array.from(
      { length: 12 },
      (_, index) => `quota-${index}.example.net`,
    );
    await Promise.all(
      hostnames.map((hostname) =>
        store.ensureDomain(hostname, "on_demand", TEST_PROFILE),
      ),
    );

    const results = await Promise.all(
      hostnames.map((hostname) =>
        store.ensureFreshScan({
          hostname,
          profileVersion: TEST_PROFILE,
          trigger: "requested",
        }),
      ),
    );
    const queuedCount = await pool.query<{ count: number }>(
      "SELECT count(*)::integer AS count FROM ds_scan_jobs WHERE state = 'queued'",
    );

    expect(results.map(({ kind }) => kind)).toContain("capacity_reached");
    expect(results.filter(({ kind }) => kind === "queued")).toHaveLength(10);
    expect(queuedCount.rows[0]?.count).toBe(10);
  });

  it("admits a repeat scan immediately after a prior report", async () => {
    const job = await queueAndClaim();
    await complete(job);

    const repeatedScan = await store.ensureFreshScan({
      hostname: TEST_HOSTNAME,
      profileVersion: TEST_PROFILE,
      trigger: "requested",
    });

    expect(repeatedScan.kind).toBe("queued");
  });

  it("retains only a safe terminal failure category and prioritizes a fresh retry", async () => {
    const job = await queueAndClaim();
    await expect(
      store.failScan(job.id, job.leaseToken, "broker_failed", 1),
    ).resolves.toBe("failed");

    const failed = await store.readPublicDomainSnapshot(TEST_HOSTNAME);
    expect(failed?.lastFailure?.code).toBe("broker_failed");
    expect(failed?.lastFailure?.failedAt).toBeInstanceOf(Date);

    const retry = await store.requestOnDemandScan(TEST_HOSTNAME);
    const updating = await store.readPublicDomainSnapshot(TEST_HOSTNAME);
    expect(retry.kind).toBe("queued");
    expect(updating?.activeJobId).toBe(retry.kind === "queued" ? retry.jobId : null);
    expect(updating?.lastFailure?.code).toBe("broker_failed");
  });

  it("does not admit scans for unknown or opted-out domains", async () => {
    const unknown = await store.ensureFreshScan({
      hostname: "not-enrolled.example.net",
      profileVersion: TEST_PROFILE,
      trigger: "requested",
    });
    await pool.query(
      "UPDATE ds_domains SET opted_out_at = clock_timestamp() WHERE hostname = $1",
      [TEST_HOSTNAME],
    );
    const optedOut = await store.ensureFreshScan({
      hostname: TEST_HOSTNAME,
      profileVersion: TEST_PROFILE,
      trigger: "requested",
    });

    expect(unknown).toEqual({ kind: "unavailable" });
    expect(optedOut).toEqual({ kind: "unavailable" });
    const queued = await pool.query(
      "SELECT count(*)::integer AS count FROM ds_scan_jobs WHERE state = 'queued'",
    );
    expect(queued.rows[0]?.count).toBe(0);
  });

  it("admits requested scans for on-demand domains but not scheduled scans", async () => {
    const hostname = "on-demand.example.net";
    await store.ensureDomain(hostname, "on_demand", TEST_PROFILE);

    const scheduled = await store.ensureFreshScan({
      hostname,
      profileVersion: TEST_PROFILE,
      trigger: "scheduled",
    });
    const requested = await store.ensureFreshScan({
      hostname,
      profileVersion: TEST_PROFILE,
      trigger: "requested",
    });

    expect(scheduled).toEqual({ kind: "unavailable" });
    expect(requested.kind).toBe("queued");
  });

  it("enrolls a new domain and admits it atomically as on-demand", async () => {
    const hostname = "new-on-demand.example.net";

    const requested = await store.requestOnDemandScan(hostname);
    const snapshot = await store.readPublicDomainSnapshot(hostname);
    const repeated = await store.requestOnDemandScan(hostname);

    expect(requested.kind).toBe("queued");
    expect(snapshot).toMatchObject({
      hostname,
      enrollment: "on_demand",
      profileVersion: "domain-v1",
      optedOut: false,
    });
    expect(repeated).toEqual(requested);
  });

  it("does not reactivate a domain that opted out of analysis", async () => {
    await pool.query(
      "UPDATE ds_domains SET opted_out_at = clock_timestamp() WHERE hostname = $1",
      [TEST_HOSTNAME],
    );

    await expect(store.requestOnDemandScan(TEST_HOSTNAME)).resolves.toEqual({
      kind: "unavailable",
    });
  });

  it("caps the number of on-demand domains stored in PostgreSQL", async () => {
    await pool.query(
      `INSERT INTO ds_domains(hostname, enrollment, profile_version)
       SELECT 'stored-' || number::text || '.example.net', 'on_demand', 'transport-v1'
       FROM generate_series(1, 1000) AS number`,
    );

    const result = await store.requestOnDemandScan("overflow.example.net");
    const overflowRow = await pool.query(
      "SELECT count(*)::integer AS count FROM ds_domains WHERE hostname = $1",
      ["overflow.example.net"],
    );

    expect(result).toEqual({ kind: "capacity_reached" });
    expect(overflowRow.rows[0]?.count).toBe(0);
  });

  it("gives a queued job to only one concurrent worker", async () => {
    await store.ensureFreshScan({
      hostname: TEST_HOSTNAME,
      profileVersion: TEST_PROFILE,
      trigger: "requested",
    });
    const claims = await Promise.all(
      Array.from({ length: 10 }, () =>
        store.claimNextScan(TEST_NOW, TEST_LEASE_MS),
      ),
    );

    expect(claims.filter(Boolean)).toHaveLength(1);
  });

  it("enforces one global running scan across different domains", async () => {
    const otherHostname = "other.sample.example.net";
    await store.ensureDomain(otherHostname, "monitored", TEST_PROFILE);
    await Promise.all(
      [TEST_HOSTNAME, otherHostname].map((hostname) =>
        store.ensureFreshScan({
          hostname,
          profileVersion: TEST_PROFILE,
          trigger: "requested",
        }),
      ),
    );

    const claims = await Promise.all(
      Array.from({ length: 8 }, () =>
        store.claimNextScan(TEST_NOW, TEST_LEASE_MS),
      ),
    );
    expect(claims.filter(Boolean)).toHaveLength(1);

    const running = await pool.query(
      "SELECT count(*)::integer AS count FROM ds_scan_jobs WHERE state = 'running'",
    );
    expect(running.rows[0].count).toBe(1);
  });

  it("queues a new scan even when a recent report exists during development", async () => {
    const first = await queueAndClaim();
    const reportId = await complete(first);

    const fresh = await store.ensureFreshScan({
      hostname: TEST_HOSTNAME,
      profileVersion: TEST_PROFILE,
      trigger: "requested",
    });

    expect(fresh.kind).toBe("queued");
    expect(fresh).not.toEqual({ kind: "cached", reportId });
  });

  it("does not reuse reports at least 60 minutes old", async () => {
    const job = await queueAndClaim();
    const staleCompletedAt = new Date(Date.now() - 61 * 60 * 1000);
    await complete(
      job,
      [CHECK],
      new Date(staleCompletedAt.getTime() - 60_000),
      staleCompletedAt,
    );

    const expired = await store.ensureFreshScan({
      hostname: TEST_HOSTNAME,
      profileVersion: TEST_PROFILE,
      trigger: "requested",
    });

    expect(expired.kind).toBe("queued");
  });

  it("reads a public domain report without returning persisted evidence", async () => {
    const job = await queueAndClaim();
    const reportId = await complete(job);

    const snapshot = await store.readPublicDomainSnapshot(TEST_HOSTNAME);
    const report = await store.readPublicReport(reportId);

    expect(snapshot).toMatchObject({
      hostname: TEST_HOSTNAME,
      enrollment: "monitored",
      profileVersion: TEST_PROFILE,
      optedOut: false,
      activeJobId: null,
      lastReport: {
        id: reportId,
        verdict: "inconclusive",
        vantage: "same_vps",
      },
    });
    expect(snapshot?.lastReport?.checks[0]).not.toHaveProperty("evidence");
    expect(report).toMatchObject({ id: reportId, hostname: TEST_HOSTNAME });
    expect(report?.checks[0]).not.toHaveProperty("evidence");
    await expect(
      store.readPublicDomainSnapshot("unregistered.example.net"),
    ).resolves.toBeNull();
    await expect(
      store.readPublicReport("00000000-0000-4000-8000-000000000000"),
    ).resolves.toBeNull();
  });

  it("hides reports when an operator opts a domain out of public reporting", async () => {
    const job = await queueAndClaim();
    const reportId = await complete(job);
    await pool.query(
      "UPDATE ds_domains SET opted_out_at = now() WHERE hostname = $1",
      [TEST_HOSTNAME],
    );

    await expect(store.readPublicReport(reportId)).resolves.toBeNull();
    await expect(
      store.readPublicDomainSnapshot(TEST_HOSTNAME),
    ).resolves.toMatchObject({ optedOut: true });
  });

  it("does not reuse a fresh report when the profile version changes", async () => {
    const job = await queueAndClaim();
    const reportId = await complete(job);
    const changedProfile = await store.ensureFreshScan({
      hostname: TEST_HOSTNAME,
      profileVersion: "controls-v2",
      trigger: "requested",
    });

    expect(reportId).toBeTruthy();
    expect(changedProfile.kind).toBe("queued");
  });

  it("rejects a direct database completion outside the profile path allowlist", async () => {
    const job = await queueAndClaim();

    await expect(
      completeDirectly(job, ["/", "/admin"], [safeDnsCheck()]),
    ).rejects.toThrow("scan_scope_not_allowlisted");
  });

  it("accepts exact transport-v1 root coverage with five checks", async () => {
    const job = await queueAndClaim("transport-v1");

    const reportId = await completeDirectly(
      job,
      ["/"],
      makeTransportV1Checks(),
    );

    const result = await pool.query(
      `SELECT control_id, target_path, method
       FROM ds_check_results
       WHERE run_id = (
         SELECT id FROM ds_scan_runs
         WHERE hostname = $1 AND profile_version = 'transport-v1'
       )
       ORDER BY control_id, method`,
      [TEST_HOSTNAME],
    );
    expect(result.rows).toEqual([
      { control_id: "DS-DNS-01", target_path: "/", method: "DNS" },
      { control_id: "DS-HDR-01", target_path: "/", method: "GET" },
      { control_id: "DS-HTTP-01", target_path: "/", method: "GET" },
      { control_id: "DS-HTTP-01", target_path: "/", method: "HEAD" },
      { control_id: "DS-TLS-01", target_path: "/", method: "TLS" },
    ]);

    const publicReport = await store.readPublicReport(reportId);
    expect(publicReport).toMatchObject({
      id: reportId,
      profileVersion: "transport-v1",
      scope: ["/"],
    });
    expect(publicReport?.checks).toHaveLength(5);
    expect(publicReport?.checks[0]).not.toHaveProperty("evidence");
  });

  it("accepts domain-v1 root coverage and evaluates its initial cookie check", async () => {
    const job = await queueAndClaim("domain-v1");
    const reportId = await completeDirectly(job, ["/"], makeDomainV1Checks());
    const publicReport = await store.readPublicReport(reportId);

    expect(publicReport).toMatchObject({
      profileVersion: "domain-v1",
      scope: ["/"],
    });
    expect(publicReport?.checks).toHaveLength(6);
    expect(publicReport?.checks.find(({ controlId }) => controlId === "DS-PRIV-05"))
      .toMatchObject({
        status: "pass",
        summary: "Cookies en respuesta inicial: 0; coincidencias con la tabla local Analytics/Marketing: 0; sin atributo Secure: 0. No se interactuó con el banner de consentimiento.",
      });
    expect(publicReport?.checks.find(({ controlId }) => controlId === "DS-PRIV-05"))
      .not.toHaveProperty("evidence");
  });

  it("rejects non-root scope for transport-v1", async () => {
    const job = await queueAndClaim("transport-v1");

    await expect(
      completeDirectly(job, ["/", "/precios"], makeTransportV1Checks()),
    ).rejects.toThrow("scan_scope_not_allowlisted");
  });

  it("rejects controls outside the transport-v1 profile", async () => {
    const job = await queueAndClaim("transport-v1");
    const unsupportedCheck: ScanCheck = {
      ...CHECK,
      controlId: "DS-PRIV-01",
      method: "GET",
      summary: "Comprobación DS-PRIV-01: unknown.",
      limitation: "Resultado limitado a las rutas públicas declaradas del perfil transport-v1.",
      evidence: { thirdPartyAttempts: 0, blockedRequests: 0 },
    };

    await expect(
      completeDirectly(job, ["/"], [
        ...makeTransportV1Checks(),
        unsupportedCheck,
      ]),
    ).rejects.toThrow("scan_check_scope_not_allowlisted");
  });

  it("allows reviewed route paths for every domain", async () => {
    const job = await queueAndClaim();

    await expect(
      completeDirectly(job, ["/", "/precios"], [safeDnsCheck()]),
    ).resolves.toBeDefined();
  });

  it("rejects raw evidence sent directly to the database function", async () => {
    const job = await queueAndClaim();

    await expect(
      completeDirectly(
        job,
        ["/"],
        [safeDnsCheck({ html: "<html>private page</html>" })],
      ),
    ).rejects.toThrow("scan_evidence_not_allowlisted");
  });

  it("rejects a method that is outside the control contract when bypassing the sanitizer", async () => {
    const job = await queueAndClaim();

    await expect(
      completeDirectly(job, ["/"], [{ ...safeDnsCheck(), method: "POST" }]),
    ).rejects.toThrow("scan_check_scope_not_allowlisted");
  });

  it("rejects an allowlisted evidence key with an invalid value when bypassing the sanitizer", async () => {
    const job = await queueAndClaim();

    await expect(
      completeDirectly(
        job,
        ["/"],
        [safeDnsCheck({ addressClass: "public", aRecordCount: -1 })],
      ),
    ).rejects.toThrow("scan_evidence_invalid");
  });

  it("accepts structured enum and count evidence allowed by the control contract", async () => {
    const job = await queueAndClaim();

    await expect(
      completeDirectly(
        job,
        ["/"],
        [
          safeDnsCheck({
            addressClass: "public",
            aRecordCount: 1,
            aaaaRecordCount: 0,
          }),
        ],
      ),
    ).resolves.toBeDefined();
  });

  it("rejects TLS expiry metadata sent directly to SQL because it is not allowlisted", async () => {
    const job = await queueAndClaim();
    const check: ScanCheck = {
      ...CHECK,
      controlId: "DS-TLS-01",
      summary: "Comprobación DS-TLS-01: unknown.",
      method: "TLS",
      evidence: {
        protocol: "TLSv1.3",
        certificateValid: true,
        hostnameMatches: true,
        expiresAt: "2027-04-05T06:07:08.000Z",
      },
    };

    await expect(completeDirectly(job, ["/"], [check])).rejects.toThrow(
      "scan_evidence_not_allowlisted",
    );
  });

  it("enforces the HTTP status range on direct SQL writes", async () => {
    const job = await queueAndClaim();
    const makeHttpCheck = (statusCode: number): ScanCheck => ({
      ...CHECK,
      controlId: "DS-HTTP-01",
      summary: "Comprobación DS-HTTP-01: unknown.",
      method: "GET",
      evidence: { statusCode },
    });

    await expect(
      completeDirectly(job, ["/"], [makeHttpCheck(599)]),
    ).resolves.toBeDefined();

    const invalidHostname = "invalid-status.example.net";
    await store.ensureDomain(invalidHostname, "on_demand", TEST_PROFILE);
    await store.ensureFreshScan({
      hostname: invalidHostname,
      profileVersion: TEST_PROFILE,
      trigger: "requested",
    });
    const claimedJob = await store.claimNextScan(TEST_NOW, TEST_LEASE_MS);
    if (!claimedJob) throw new Error("expected_claimed_scan");
    await expect(
      completeDirectly(claimedJob, ["/"], [makeHttpCheck(600)]),
    ).rejects.toThrow("scan_evidence_invalid");
  });

  it("rejects pass with missing minimum evidence for any required control", async () => {
    const job = await queueAndClaim();
    const checks = makePassingControls();

    for (const check of checks) {
      check.evidence = {};
    }

    await expect(
      completeDirectly(job, ["/"], checks, "pass"),
    ).rejects.toThrow();
  });

  it.each([
    [
      "DS-DNS-01",
      { addressClass: "private", aRecordCount: 1, aaaaRecordCount: 0 },
    ],
    [
      "DS-DNS-01",
      { addressClass: "reserved", aRecordCount: 1, aaaaRecordCount: 0 },
    ],
    [
      "DS-TLS-01",
      { protocol: "TLSv1.3", certificateValid: false, hostnameMatches: true },
    ],
    [
      "DS-TLS-01",
      { protocol: "TLSv1.3", certificateValid: true, hostnameMatches: false },
    ],
    [
      "DS-TLS-02",
      {
        tls10Accepted: true,
        tls11Accepted: false,
        tls12Accepted: true,
        tls13Accepted: true,
      },
    ],
    [
      "DS-TLS-02",
      {
        tls10Accepted: false,
        tls11Accepted: true,
        tls12Accepted: true,
        tls13Accepted: true,
      },
    ],
    [
      "DS-HTTP-01",
      { statusCode: 500, redirectedToHttps: true, finalScheme: "https" },
    ],
    [
      "DS-HTTP-01",
      { statusCode: 200, redirectedToHttps: false, finalScheme: "https" },
    ],
    [
      "DS-HTTP-01",
      { statusCode: 200, redirectedToHttps: true, finalScheme: "http" },
    ],
    ["DS-PRIV-01", { thirdPartyAttempts: 1, blockedRequests: 1 }],
    [
      "DS-PRIV-02",
      {
        cookieCount: 1,
        insecureCookieCount: 1,
        thirdPartyCookieCount: 0,
        inspected: true,
      },
    ],
    [
      "DS-PRIV-02",
      {
        cookieCount: 1,
        insecureCookieCount: 0,
        thirdPartyCookieCount: 1,
        inspected: true,
      },
    ],
    ["DS-PRIV-03", { mixedContentCount: 1, insecureNavigationCount: 0 }],
    ["DS-PRIV-03", { mixedContentCount: 0, insecureNavigationCount: 1 }],
    [
      "DS-QUAL-01",
      { documentStatusCode: 500, failedEssentialResourceCount: 0 },
    ],
    [
      "DS-QUAL-01",
      { documentStatusCode: 200, failedEssentialResourceCount: 1 },
    ],
  ])(
    "rejects pass with contradictory %s evidence through direct SQL",
    async (controlId, evidence) => {
      const job = await queueAndClaim();
      const checks = makePassingControls();
      const targetCheck = checks.find((check) => check.controlId === controlId);
      if (!targetCheck) throw new Error("expected_control_in_fixture");
      targetCheck.evidence = evidence;

      await expect(
        completeDirectly(job, ["/"], checks, "pass"),
      ).rejects.toThrow();
    },
  );

  it("accepts a complete pass through direct SQL when every control has safe evidence", async () => {
    const job = await queueAndClaim();

    await expect(
      completeDirectly(job, ["/"], makePassingControls(), "pass"),
    ).resolves.toBeDefined();
  });

  it("recovers expired leases and fails after the retry limit", async () => {
    const first = await queueAndClaim();
    await pool.query(
      "UPDATE ds_scan_jobs SET lease_until = clock_timestamp() - interval '1 second' WHERE id = $1",
      [first.id],
    );
    expect(await store.recoverExpiredLeases(new Date(), MAX_ATTEMPTS)).toBe(1);

    const second = await store.claimNextScan(new Date(), TEST_LEASE_MS);
    expect(second?.attempts).toBe(2);
    if (!second) throw new Error("expected_claimed_scan");

    await pool.query(
      "UPDATE ds_scan_jobs SET lease_until = clock_timestamp() - interval '1 second' WHERE id = $1",
      [second.id],
    );
    expect(await store.recoverExpiredLeases(new Date(), MAX_ATTEMPTS)).toBe(1);
    const result = await pool.query(
      "SELECT state, public_error_code FROM ds_scan_jobs WHERE id = $1",
      [first.id],
    );
    expect(result.rows[0]).toEqual({
      state: "failed",
      public_error_code: "worker_lease_expired",
    });
  });

  it("releases executor failures into bounded backoff and rejects stale leases", async () => {
    const first = await queueAndClaim();
    await expect(
      store.failScan(first.id, first.leaseToken, "executor_failed", MAX_ATTEMPTS),
    ).resolves.toBe("retrying");
    const queued = await pool.query(
      "SELECT state, lease_token, available_at, public_error_code FROM ds_scan_jobs WHERE id = $1",
      [first.id],
    );
    expect(queued.rows[0].state).toBe("queued");
    expect(queued.rows[0].lease_token).toBeNull();
    expect(new Date(queued.rows[0].available_at).getTime()).toBeGreaterThan(Date.now());
    expect(queued.rows[0].public_error_code).toBeNull();

    await expect(
      store.failScan(first.id, first.leaseToken, "executor_failed", MAX_ATTEMPTS),
    ).rejects.toThrow(ScanLeaseLostError);

    await pool.query("UPDATE ds_scan_jobs SET available_at = clock_timestamp() WHERE id = $1", [first.id]);
    const second = await store.claimNextScan(new Date(), TEST_LEASE_MS);
    if (!second) throw new Error("expected_retry_claim");
    await expect(
      store.failScan(second.id, second.leaseToken, "executor_failed", MAX_ATTEMPTS),
    ).resolves.toBe("failed");
    const failed = await pool.query(
      "SELECT state, public_error_code FROM ds_scan_jobs WHERE id = $1",
      [first.id],
    );
    expect(failed.rows[0]).toEqual({
      state: "failed",
      public_error_code: "executor_failed",
    });
  });

  it("renews only a current unexpired lease", async () => {
    const job = await queueAndClaim();
    const renewRequestedAt = new Date();
    const earliestExpiry = renewRequestedAt.getTime() + TEST_LEASE_MS - 2_000;

    await expect(
      store.renewScanLease(
        job.id,
        job.leaseToken,
        renewRequestedAt,
        TEST_LEASE_MS,
      ),
    ).resolves.toBe(true);
    await expect(
      store.renewScanLease(
        job.id,
        "e2e2e2e2-e2e2-42e2-82e2-e2e2e2e2e2e2",
        renewRequestedAt,
        TEST_LEASE_MS,
      ),
    ).resolves.toBe(false);
    const result = await pool.query(
      "SELECT lease_until FROM ds_scan_jobs WHERE id = $1",
      [job.id],
    );
    expect(
      new Date(result.rows[0].lease_until).getTime(),
    ).toBeGreaterThanOrEqual(earliestExpiry);
  });

  it("commits a report atomically and rejects stale lease holders", async () => {
    const job = await queueAndClaim();
    const reportId = await complete(job);
    const counts = await pool.query(
      `SELECT
         (SELECT count(*) FROM ds_scan_runs WHERE id = $1)::integer AS runs,
         (SELECT count(*) FROM ds_check_results WHERE run_id = $1)::integer AS checks,
         (SELECT count(*) FROM ds_scan_metrics WHERE run_id = $1)::integer AS metrics`,
      [reportId],
    );

    expect(counts.rows[0]).toEqual({ runs: 1, checks: 1, metrics: 1 });
    await expect(complete(job)).rejects.toBeInstanceOf(ScanLeaseLostError);
    await expect(
      pool.query("UPDATE ds_scan_runs SET verdict = 'pass' WHERE id = $1", [
        reportId,
      ]),
    ).rejects.toThrow("Development Security reports are immutable");
  });

  it("rolls back a partially inserted report when a check violates uniqueness", async () => {
    const job = await queueAndClaim();
    const duplicateChecks = [CHECK, { ...CHECK }];

    await expect(complete(job, duplicateChecks)).rejects.toThrow();
    const afterFailure = await pool.query(
      `SELECT
         (SELECT count(*) FROM ds_scan_runs)::integer AS runs,
         (SELECT count(*) FROM ds_check_results)::integer AS checks,
         (SELECT count(*) FROM ds_scan_metrics)::integer AS metrics`,
    );
    expect(afterFailure.rows[0]).toEqual({ runs: 0, checks: 0, metrics: 0 });
    await expect(complete(job)).resolves.toBeTruthy();
  });

  it("retains reports for 90 days and purges older rows through the owner function", async () => {
    const oldStartedAt = new Date("2026-06-01T10:00:00.000Z");
    const oldCompletedAt = new Date(oldStartedAt.getTime() + 15_000);
    const job = await queueAndClaim();
    const runId = await complete(job, [CHECK], oldStartedAt, oldCompletedAt);
    const tooRecentCutoff = new Date(Date.now() - 89 * 24 * 60 * 60 * 1000);

    await expect(
      pool.query("SELECT ds_purge_expired_reports($1)", [tooRecentCutoff]),
    ).rejects.toThrow("report_retention_window_not_reached");

    const retentionCutoff = new Date(Date.now() - 91 * 24 * 60 * 60 * 1000);
    const purge = await pool.query<{ ds_purge_expired_reports: number }>(
      "SELECT ds_purge_expired_reports($1)",
      [retentionCutoff],
    );
    const remaining = await pool.query(
      `SELECT
         (SELECT count(*) FROM ds_scan_runs WHERE id = $1)::integer AS runs,
         (SELECT count(*) FROM ds_check_results WHERE run_id = $1)::integer AS checks,
         (SELECT count(*) FROM ds_scan_metrics WHERE run_id = $1)::integer AS metrics`,
      [runId],
    );

    expect(purge.rows[0].ds_purge_expired_reports).toBe(3);
    expect(remaining.rows[0]).toEqual({ runs: 0, checks: 0, metrics: 0 });
  });

  async function queueAndClaim(
    profileVersion: string = TEST_PROFILE,
  ): Promise<ClaimedScanJob> {
    await store.ensureFreshScan({
      hostname: TEST_HOSTNAME,
      profileVersion,
      trigger: "requested",
    });
    const job = await store.claimNextScan(TEST_NOW, TEST_LEASE_MS);
    if (!job) throw new Error("expected_claimed_scan");
    return job;
  }

  async function complete(
    job: ClaimedScanJob,
    checks: readonly ScanCheck[] = [CHECK],
    startedAt: Date = TEST_START,
    completedAt: Date = TEST_NOW,
  ): Promise<string> {
    return store.completeScan({
      jobId: job.id,
      leaseToken: job.leaseToken,
      hostname: job.hostname,
      profileVersion: job.profileVersion,
      scannerVersion: TEST_SCANNER,
      startedAt,
      completedAt,
      verdict: "inconclusive",
      scope: ["/"],
      checks,
      metrics: {
        requestsCount: 0,
        bytesCount: 0,
        durationMs: 0,
        pagesCount: 0,
      },
    });
  }

  function completeDirectly(
    job: ClaimedScanJob,
    scope: readonly string[],
    checks: readonly ScanCheck[],
    verdict: "pass" | "inconclusive" = "inconclusive",
  ): Promise<string> {
    const startedAt = new Date();
    const completedAt = new Date(startedAt.getTime() + 1);
    return pool
      .query<{ ds_complete_scan: string }>(
      `SELECT ds_complete_scan(
        $1, $2, $3, $4, $5, $6, $7::jsonb, $8::jsonb, $9::jsonb
      )`,
      [
        job.id,
        job.leaseToken,
        completedAt,
        TEST_SCANNER,
        startedAt,
        verdict,
        JSON.stringify(scope),
        JSON.stringify(checks),
        JSON.stringify({
          requestsCount: 0,
          bytesCount: 0,
          durationMs: 1,
          pagesCount: 0,
        }),
      ],
      )
      .then((result) => {
        const reportId = result.rows[0]?.ds_complete_scan;
        if (!reportId) throw new Error("expected_completed_scan_report_id");
        return reportId;
      });
  }

  function makeTransportV1Checks(): ScanCheck[] {
    const limitation =
      "Resultado limitado a las rutas públicas declaradas del perfil transport-v1.";
    const makeCheck = (
      controlId: string,
      method: string,
      evidence: Record<string, unknown>,
    ): ScanCheck => ({
      ...CHECK,
      controlId,
      method,
      summary: `Comprobación ${controlId}: unknown.`,
      limitation,
      evidence,
    });
    return [
      makeCheck("DS-DNS-01", "DNS", {
        addressClass: "public",
        aRecordCount: 1,
        aaaaRecordCount: 0,
      }),
      makeCheck("DS-TLS-01", "TLS", {
        protocol: "TLSv1.3",
        certificateValid: true,
        hostnameMatches: true,
      }),
      ...(["HEAD", "GET"] as const).map((method) =>
        makeCheck("DS-HTTP-01", method, {
          statusCode: 200,
          redirectedToHttps: true,
          finalScheme: "https",
        }),
      ),
      makeCheck("DS-HDR-01", "GET", {
        finalScheme: "https",
        hsts: true,
        nosniff: true,
        frameProtection: true,
        referrerPolicy: true,
        csp: true,
      }),
    ];
  }

  function makeDomainV1Checks(): ScanCheck[] {
    const checks = makeTransportV1Checks().map((check) => ({
      ...check,
      limitation:
        "Resultado limitado a las rutas públicas declaradas del perfil domain-v1.",
    }));
    checks.push({
      ...CHECK,
      controlId: "DS-PRIV-05",
      method: "GET",
      status: "pass",
      summary: "Cookies en respuesta inicial: 0; coincidencias con la tabla local Analytics/Marketing: 0; sin atributo Secure: 0. No se interactuó con el banner de consentimiento.",
      limitation:
        "Resultado limitado a las rutas públicas declaradas del perfil domain-v1.",
      evidence: {
        inspected: true,
        cookieCount: 0,
        insecureCookieCount: 0,
        catalogMatchCount: 0,
        consentPromptDetected: true,
      },
    });
    return checks;
  }

  function safeDnsCheck(evidence: Record<string, unknown> = {}): ScanCheck {
    return {
      ...CHECK,
      summary: "Comprobación DS-DNS-01: unknown.",
      limitation:
        "Resultado limitado a las rutas públicas declaradas del perfil controls-v1.",
      evidence,
    };
  }

  function makePassingControls(): ScanCheck[] {
    const evidenceByControl: Record<string, Record<string, unknown>> = {
      "DS-DNS-01": {
        addressClass: "public",
        aRecordCount: 1,
        aaaaRecordCount: 0,
      },
      "DS-TLS-01": {
        protocol: "TLSv1.3",
        certificateValid: true,
        hostnameMatches: true,
      },
      "DS-TLS-02": {
        tls10Accepted: false,
        tls11Accepted: false,
        tls12Accepted: true,
        tls13Accepted: true,
      },
      "DS-HTTP-01": {
        statusCode: 200,
        redirectedToHttps: true,
        finalScheme: "https",
      },
      "DS-HDR-01": {
        hsts: true,
        nosniff: true,
        frameProtection: true,
        referrerPolicy: true,
        csp: true,
      },
      "DS-PRIV-01": { thirdPartyAttempts: 0, blockedRequests: 0 },
      "DS-PRIV-02": {
        cookieCount: 0,
        insecureCookieCount: 0,
        thirdPartyCookieCount: 0,
        inspected: true,
      },
      "DS-PRIV-03": { mixedContentCount: 0, insecureNavigationCount: 0 },
      "DS-QUAL-01": {
        documentStatusCode: 200,
        failedEssentialResourceCount: 0,
      },
    };
    const methodByControl: Record<string, string> = {
      "DS-DNS-01": "DNS",
      "DS-TLS-01": "TLS",
      "DS-TLS-02": "TLS",
    };
    return Object.entries(evidenceByControl).map(([controlId, evidence]) => ({
      ...CHECK,
      controlId,
      status: "pass",
      summary: `Comprobación ${controlId}: pass.`,
      method: methodByControl[controlId] ?? "GET",
      evidence,
    }));
  }

  const CHECK: ScanCheck = {
    controlId: "DS-DNS-01",
    status: "unknown",
    required: true,
    severity: "high",
    observedAt: TEST_NOW,
    targetPath: "/",
    method: "DNS",
    summary: "Comprobación DS-DNS-01: unknown.",
    limitation:
      "Resultado limitado a las rutas públicas declaradas del perfil controls-v1.",
    evidence: {},
  };
});
