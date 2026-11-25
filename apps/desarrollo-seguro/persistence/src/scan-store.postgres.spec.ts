import { Pool } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  assessDevelopmentSecurityProcessorRegistry,
  assessFirstEntryPolicyAccess,
  SCAN_FAILURE_DIAGNOSTIC_CODES,
  SCAN_FAILURE_DIAGNOSTIC_STAGES,
  type FirstEntryPolicyAccess,
} from "@desarrolloseguro/core";
import {
  PostgresScanStore,
  ScanLeaseLostError,
  type ClaimedScanJob,
  type ScanCheck,
} from "./scan-store.js";
import { runDevelopmentSecurityMigrations } from "./run-migrations.js";
import { isSafePostgresTestTarget } from "./postgres-test-safety.js";
import { PostgresProviderCatalogStore } from "./provider-catalog-store.js";

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
       ds_scan_jobs, ds_domains, ds_scan_provider_catalog_versions,
       ds_provider_catalog_active, ds_provider_catalog_refresh_runs CASCADE`,
    );
    await store.ensureDomain(TEST_HOSTNAME, "monitored", TEST_PROFILE);
  });

  it("keeps check payload SQL failures separated into bounded diagnostic codes", async () => {
    const result = await pool.query<{ definition: string }>(
      "SELECT pg_get_functiondef('public.ds_validate_check_result_before_insert()'::regprocedure) AS definition",
    );
    const definition = result.rows[0]?.definition ?? "";

    for (const code of [
      "scan_check_required_invalid",
      "scan_check_severity_not_allowlisted",
      "scan_check_summary_not_allowlisted",
      "scan_check_limitation_not_allowlisted",
      "scan_check_evidence_payload_not_allowlisted",
      "scan_check_evidence_size_exceeded",
    ]) {
      expect(definition).toContain(code);
    }
    expect(definition).not.toContain("scan_check_payload_not_allowlisted");
  });

  it("accepts first-entry policy evidence linked from an informational notice", async () => {
    const policyLinkVisit = {
      status: "evaluated",
      link: { hostname: "example.org", path: "/privacy", kind: "privacy" },
      documentAccess: "accessible",
      navigationStartedAtMs: 20,
      beforeNavigation: {
        capturedAtMs: 10,
        cookies: [],
        storageKeys: [],
        cookieReadComplete: true,
        storageReadComplete: true,
      },
      afterNavigation: {
        capturedAtMs: 30,
        cookies: [],
        storageKeys: [],
        cookieReadComplete: true,
        storageReadComplete: true,
      },
    } as const;
    const assessments = [
      {
        policyVersion: "first-entry-policy-access-v1",
        status: "pass",
        reasonCode: "information_notice_link_accessible_without_consent",
        consentPromptDetected: false,
        thirdPartyCookieDetected: false,
        nonEssentialThirdPartyStorageDetected: false,
        linkLocation: "information_notice",
        link: { hostname: "example.org", path: "/privacy", kind: "privacy" },
        documentAccess: "accessible",
        policyLinkVisit,
      },
      {
        policyVersion: "first-entry-policy-access-v1",
        status: "fail",
        reasonCode: "information_notice_insufficient_with_third_party_cookies",
        consentPromptDetected: false,
        thirdPartyCookieDetected: true,
        nonEssentialThirdPartyStorageDetected: true,
        linkLocation: "information_notice",
        link: { hostname: "example.org", path: "/privacy", kind: "privacy" },
        documentAccess: "accessible",
      },
    ];

    const result = await pool.query<{ valid: boolean }>(
      "SELECT public.ds_valid_first_entry_policy_access($1::jsonb) AS valid",
      [JSON.stringify(assessments[0])],
    );
    const insufficient = await pool.query<{ valid: boolean }>(
      "SELECT public.ds_valid_first_entry_policy_access($1::jsonb) AS valid",
      [JSON.stringify(assessments[1])],
    );
    const malformedVisit = await pool.query<{ valid: boolean }>(
      "SELECT public.ds_valid_first_entry_policy_access($1::jsonb) AS valid",
      [JSON.stringify({ ...assessments[0], policyLinkVisit: { ...policyLinkVisit, afterNavigation: null } })],
    );

    expect(result.rows[0]?.valid).toBe(true);
    expect(insufficient.rows[0]?.valid).toBe(true);
    expect(malformedVisit.rows[0]?.valid).toBe(false);
  });

  it("persists domain-v4 first-entry snapshots and transport-failure summaries together", async () => {
    const link = { hostname: TEST_HOSTNAME, path: "/privacy", kind: "privacy" } as const;
    const assessment: FirstEntryPolicyAccess = {
      ...assessFirstEntryPolicyAccess({
        consentPromptDetected: false,
        thirdPartyCookieDetected: false,
        nonEssentialThirdPartyStorageDetected: false,
        consentComponentLink: null,
        informationNoticeLink: link,
        footerLink: null,
        componentLinkDocumentAccess: "not_checked",
        informationNoticeDocumentAccess: "accessible",
        footerLinkDocumentAccess: "not_checked",
      }),
      policyLinkVisit: {
        status: "evaluated",
        link,
        documentAccess: "accessible",
        navigationStartedAtMs: 20,
        beforeNavigation: {
          capturedAtMs: 10,
          cookies: [],
          storageKeys: [],
          cookieReadComplete: true,
          storageReadComplete: true,
        },
        afterNavigation: {
          capturedAtMs: 30,
          cookies: [],
          storageKeys: [],
          cookieReadComplete: true,
          storageReadComplete: true,
        },
      },
    };
    await store.ensureFreshScan({ hostname: TEST_HOSTNAME, profileVersion: "domain-v4", trigger: "requested" });
    const job = await store.claimNextScan(new Date(), TEST_LEASE_MS);
    if (!job) throw new Error("expected_claimed_first_entry_policy_scan");
    const reportId = await store.completeScan({
      jobId: job.id,
      leaseToken: job.leaseToken,
      hostname: TEST_HOSTNAME,
      profileVersion: "domain-v4",
      scannerVersion: TEST_SCANNER,
      startedAt: TEST_START,
      completedAt: TEST_NOW,
      verdict: "inconclusive",
      scope: ["/"],
      checks: [
        ...makeEligibleDomainV3Checks().map((check) => {
          const base = {
            ...check,
            limitation: "Resultado limitado a las rutas públicas declaradas del perfil domain-v4.",
          };
          if (["DS-HDR-01", "DS-PRIV-05", "DS-PRIV-06", "DS-QUAL-02"].includes(check.controlId)) {
            return {
              ...base,
              status: "unknown" as const,
              evidence: { ...check.evidence, probeErrorCode: "transport_failed" },
            };
          }
          if (check.controlId === "DS-TLS-02") {
            return {
              ...base,
              status: "unknown" as const,
              evidence: { ...check.evidence, tls10ProbeError: "transport_failed" },
            };
          }
          return base;
        }),
        {
          ...CHECK,
          controlId: "DS-PRIV-04",
          method: "GET",
          status: "unknown",
          summary: "El lector no pudo completar esta comprobación: se produjo un error de transporte.",
          limitation: "Resultado limitado a las rutas públicas declaradas del perfil domain-v4.",
          evidence: {
            inspected: true,
            privacyPolicyLinksFound: 1,
            policyLinksFound: 1,
            sitePrivacyPolicyFetched: true,
            policyPagesFetched: 1,
            policyPagesMissing: 0,
            policyPagesDenied: 0,
            policyRecipientsMentioned: true,
            policyPurposesMentioned: true,
            policyTextBlocked: false,
            policyProbeFailed: true,
            policyLanguageCatalogVersion: "public-policy-language-eea-v1",
            probeErrorCode: "transport_failed",
          },
        },
      ],
      metrics: { requestsCount: 0, bytesCount: 0, durationMs: 1, pagesCount: 0 },
      firstEntryPolicyAccess: assessment,
    });

    const report = await store.readPublicReport(reportId);
    expect(report?.firstEntryPolicyAccess).toEqual(assessment);
    expect(report).toMatchObject({ profileVersion: "domain-v4", verdict: "inconclusive" });
    expect(report?.checks).toHaveLength(10);
    for (const controlId of ["DS-HDR-01", "DS-PRIV-04", "DS-PRIV-05", "DS-PRIV-06", "DS-QUAL-02"]) {
      expect(report?.checks.find((check) => check.controlId === controlId))
        .toMatchObject({ status: "unknown", summary: "El lector no pudo completar esta comprobación: se produjo un error de transporte." });
    }
    expect(report?.checks.find((check) => check.controlId === "DS-TLS-02")?.summary)
      .toContain("TLS 1.0: se produjo un error de transporte.");
  });

  afterAll(async () => {
    await pool?.end();
  });

  it("persists source-registry processor evidence for desarrolloseguro.org", async () => {
    const hostname = "desarrolloseguro.org";
    await store.ensureDomain(hostname, "on_demand", "domain-v3");
    await store.ensureFreshScan({ hostname, profileVersion: "domain-v3", trigger: "requested" });
    const job = await store.claimNextScan(new Date(), TEST_LEASE_MS);
    if (!job) throw new Error("expected_claimed_self_domain_processor_scan");
    const processorTransparencyAssessment = assessDevelopmentSecurityProcessorRegistry({
      deploymentRevision: "a".repeat(40),
      registryRevision: "v1",
      processors: [],
      now: new Date(),
    });
    const publicPolicyTransparencyAssessment = {
      policyVersion: "public-policy-v1",
      status: "pass",
      reasonCode: "disclosure_found",
      evidence: {
        linksFound: 1,
        pagesInspected: 1,
        unavailablePages: 0,
        accessDeniedPages: 0,
        providerMentions: 1,
        providersMissingPurpose: 0,
        categories: ["analytics"],
      },
    } satisfies import("@desarrolloseguro/core").PublicPolicyTransparencyAssessment;

    const reportId = await store.completeScan({
      jobId: job.id,
      leaseToken: job.leaseToken,
      hostname,
      profileVersion: "domain-v3",
      scannerVersion: TEST_SCANNER,
      startedAt: new Date(Date.now() - 1_000),
      completedAt: new Date(),
      verdict: "pass",
      scope: ["/"],
      checks: makeEligibleDomainV3Checks(),
      metrics: { requestsCount: 0, bytesCount: 0, durationMs: 1, pagesCount: 0 },
      processorTransparencyAssessment,
      publicPolicyTransparencyAssessment,
    });

    const report = await store.readPublicReport(reportId);
    expect(report?.hostname).toBe(hostname);
    expect(report?.processorTransparencyAssessment).toEqual(processorTransparencyAssessment);
    expect(report?.publicPolicyTransparencyAssessment).toEqual(publicPolicyTransparencyAssessment);
  });

  it("persists public-policy evidence atomically with a non-client report", async () => {
    const hostname = "policy.example.net";
    await store.ensureDomain(hostname, "on_demand", "domain-v3");
    await store.ensureFreshScan({ hostname, profileVersion: "domain-v3", trigger: "requested" });
    const job = await store.claimNextScan(new Date(), TEST_LEASE_MS);
    if (!job) throw new Error("expected_claimed_public_policy_scan");
    const assessment = {
      policyVersion: "public-policy-v1",
      status: "pass",
      reasonCode: "disclosure_found",
      evidence: {
        linksFound: 2,
        pagesInspected: 2,
        unavailablePages: 0,
        accessDeniedPages: 0,
        providerMentions: 2,
        providersMissingPurpose: 0,
        categories: ["analytics", "advertising"],
      },
    } satisfies import("@desarrolloseguro/core").PublicPolicyTransparencyAssessment;
    const siteSource = {
      sourceId: "site-policy",
      version: "scan-1",
      title: "Privacy notice",
      url: "https://policy.example.net/privacy",
      capturedAt: new Date().toISOString(),
      excerpt: "The site says it does not send idea text to OpenAI.",
      documentKind: "privacy",
      sourceKind: "audited_site",
    } as const;
    const providerSource = {
      sourceId: "openai-data-controls",
      version: "catalog-1",
      title: "API data controls",
      url: "https://developers.openai.com/api/docs/guides/your-data",
      capturedAt: new Date().toISOString(),
      excerpt: "OpenAI documents processing submitted API content.",
      documentKind: "service",
      sourceKind: "provider_official",
    } as const;
    const serviceComparison = {
      policyVersion: "public-service-comparison-v1",
      status: "fail",
      reasonCode: "provider_documentation_contradiction",
      items: [{
        providerId: "openai-api",
        observation: "declared",
        observedDomains: [],
        declaredPurposes: ["ai_processing"],
      }],
      providerDocumentation: [{
        providerId: "openai-api",
        status: "contradiction_confirmed",
        reasonCode: "opposing_explicit_statements",
        comparisons: [{
          factId: "provider_receives_content",
          siteStatement: siteSource,
          siteValue: false,
          providerFact: providerSource,
          providerValue: true,
          relation: "opposes",
        }],
      }],
    } satisfies import("@desarrolloseguro/core").PublicServiceComparison;
    const reportId = await store.completeScan({
      jobId: job.id,
      leaseToken: job.leaseToken,
      hostname,
      profileVersion: "domain-v3",
      scannerVersion: TEST_SCANNER,
      startedAt: new Date(Date.now() - 1_000),
      completedAt: new Date(),
      verdict: "pass",
      scope: ["/"],
      checks: makeEligibleDomainV3Checks(),
      metrics: { requestsCount: 0, bytesCount: 0, durationMs: 1, pagesCount: 0 },
      publicPolicyTransparencyAssessment: assessment,
      publicServiceComparison: serviceComparison,
    });

    const report = await store.readPublicReport(reportId);
    expect(report?.publicPolicyTransparencyAssessment).toEqual(assessment);
    expect(report?.publicServiceComparison).toEqual(serviceComparison);
    const persisted = await pool.query<{ assessment_json: unknown }>(
      "SELECT assessment_json FROM ds_scan_public_policy_transparency WHERE run_id = $1",
      [reportId],
    );
    expect(persisted.rows[0]?.assessment_json).toEqual(assessment);
    const persistedComparison = await pool.query<{ comparison_json: unknown }>(
      "SELECT comparison_json FROM ds_scan_public_service_comparisons WHERE run_id = $1",
      [reportId],
    );
    expect(persistedComparison.rows[0]?.comparison_json).toEqual(serviceComparison);
  });

  it("pins each report to the active provider catalog version", async () => {
    const catalog = new PostgresProviderCatalogStore(pool);
    const scheduledAt = new Date("2026-11-01T02:00:00.000Z");
    expect(await catalog.beginRefresh(scheduledAt)).toBe(true);
    const version = await catalog.activate({
      providerFacts: [{ providerId: "sample-provider", facts: [] }],
      legalRules: [],
      sources: [{
        providerId: "sample-provider",
        documentId: "sample-privacy",
        title: "Sample privacy documentation",
        url: "https://sample-provider.example/privacy",
        status: "fetched",
        sha256: "a".repeat(64),
        checkedAt: "2026-11-01T02:00:00.000Z",
      }],
      scheduledAt,
    });
    expect((await catalog.readActive())?.catalogVersion).toBe(version);

    await store.ensureFreshScan({ hostname: TEST_HOSTNAME, profileVersion: TEST_PROFILE, trigger: "requested" });
    const job = await store.claimNextScan(new Date(), TEST_LEASE_MS);
    if (!job) throw new Error("expected_claimed_catalog_scan");
    const reportId = await store.completeScan({
      jobId: job.id,
      leaseToken: job.leaseToken,
      hostname: TEST_HOSTNAME,
      profileVersion: TEST_PROFILE,
      scannerVersion: TEST_SCANNER,
      startedAt: TEST_START,
      completedAt: TEST_NOW,
      verdict: "pass",
      scope: ["/"],
      checks: makePassingControls(),
      metrics: { requestsCount: 0, bytesCount: 0, durationMs: 1, pagesCount: 0 },
      providerCatalogVersion: version,
    });
    expect((await store.readPublicReport(reportId))?.providerCatalogVersion).toBe(version);
    const link = await pool.query<{ catalog_version: string }>(
      "SELECT catalog_version FROM ds_scan_provider_catalog_versions WHERE run_id = $1",
      [reportId],
    );
    expect(link.rows[0]?.catalog_version).toBe(version);
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

  it("issues report badges only for a matching eligible report and supports binding and revocation", async () => {
    const hostname = "grumphya.com";
    await store.ensureDomain(hostname, "on_demand", "domain-v3");
    await store.ensureFreshScan({
      hostname,
      profileVersion: "domain-v3",
      trigger: "requested",
    });
    const job = await store.claimNextScan(new Date(), TEST_LEASE_MS);
    if (!job) throw new Error("expected_claimed_badge_test_scan");
    const reportId = await store.completeScan({
      jobId: job.id,
      leaseToken: job.leaseToken,
      hostname,
      profileVersion: "domain-v3",
      scannerVersion: "test",
      startedAt: new Date(Date.now() - 1000),
      completedAt: new Date(),
      verdict: "pass",
      scope: ["/"],
      checks: makeEligibleDomainV3Checks(),
      metrics: {
        requestsCount: 0,
        bytesCount: 0,
        durationMs: 1,
        pagesCount: 0,
      },
    });
    const tokenHash = "a".repeat(64);
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);

    await expect(store.issueReportBadge({ hostname, reportId, tokenHash, expiresAt })).resolves.toBe(true);
    await expect(store.issueReportBadge({ hostname: "other.example", reportId, tokenHash: "b".repeat(64), expiresAt })).resolves.toBe(false);
    await expect(store.verifyReportBadge({ hostname: "other.example", reportId, tokenHash, at: new Date() })).resolves.toBe("redirect_not_valid");
    await expect(store.verifyReportBadge({ hostname, reportId, tokenHash, at: new Date() })).resolves.toBe("verified");
    await expect(store.verifyReportBadge({ hostname, reportId, tokenHash, at: new Date(expiresAt.getTime() + 1) })).resolves.toBe("badge_expired");
    await expect(store.revokeReportBadge({ hostname, reportId, tokenHash, at: new Date() })).resolves.toBe(true);
    await expect(store.verifyReportBadge({ hostname, reportId, tokenHash, at: new Date() })).resolves.toBe("badge_revoked");
  });

  it("resolves a fresh www report to the permanent redirect destination and its certified report", async () => {
    const completeDomainReport = async (hostname: string, checks: ScanCheck[]) => {
      await store.ensureDomain(hostname, "on_demand", "domain-v3");
      await store.ensureFreshScan({ hostname, profileVersion: "domain-v3", trigger: "requested" });
      const job = await store.claimNextScan(new Date(), TEST_LEASE_MS);
      if (!job) throw new Error("expected_claimed_hostname_resolution_scan");
      return store.completeScan({
        jobId: job.id,
        leaseToken: job.leaseToken,
        hostname,
        profileVersion: "domain-v3",
        scannerVersion: TEST_SCANNER,
        startedAt: new Date(Date.now() - 1_000),
        completedAt: new Date(),
        verdict: "pass",
        scope: ["/"],
        checks,
        metrics: { requestsCount: 0, bytesCount: 0, durationMs: 1, pagesCount: 0 },
      });
    };
    const canonicalReportId = await completeDomainReport("grumphya.com", makeEligibleDomainV3Checks());
    const aliasChecks = makeEligibleDomainV3Checks().map((check) =>
      check.controlId === "DS-HTTP-01" && check.method === "GET"
        ? {
            ...check,
            evidence: {
              ...check.evidence,
              requestedHostname: "www.grumphya.com",
              finalHostname: "grumphya.com",
              canonicalHostname: "grumphya.com",
              redirectStatusCode: 301,
              redirectFromHostname: "www.grumphya.com",
              redirectToHostname: "grumphya.com",
            },
          }
        : check,
    );
    const aliasReportId = await completeDomainReport("www.grumphya.com", aliasChecks);

    await expect(store.resolveCanonicalHostname("www.grumphya.com")).resolves.toBe("grumphya.com");
    const snapshot = await store.readPublicDomainSnapshot("www.grumphya.com");
    expect(snapshot?.hostnameResolution).toMatchObject({
      observedReportId: aliasReportId,
      requestedHostname: "www.grumphya.com",
      canonicalHostname: "grumphya.com",
      statusCode: 301,
    });
    expect(snapshot?.lastReport?.id).toBe(canonicalReportId);
    expect((await store.readPublicReport(aliasReportId))?.certification).toBeNull();

    const temporaryChecks = makeEligibleDomainV3Checks().map((check) =>
      check.controlId === "DS-HTTP-01" && check.method === "GET"
        ? { ...check, evidence: { ...check.evidence, requestedHostname: "www.grumphya.com", finalHostname: "grumphya.com", redirectStatusCode: 302, redirectFromHostname: "www.grumphya.com", redirectToHostname: "grumphya.com" } }
        : check,
    );
    await completeDomainReport("www.grumphya.com", temporaryChecks);
    await expect(store.resolveCanonicalHostname("www.grumphya.com")).resolves.toBeNull();

    const wwwCurrentSnapshot = await store.readPublicDomainSnapshot("www.grumphya.com");
    const reverseChecks = makeEligibleDomainV3Checks().map((check) =>
      check.controlId === "DS-HTTP-01" && check.method === "GET"
        ? {
            ...check,
            evidence: {
              ...check.evidence,
              requestedHostname: "grumphya.com",
              finalHostname: "www.grumphya.com",
              canonicalHostname: "www.grumphya.com",
              redirectStatusCode: 308,
              redirectFromHostname: "grumphya.com",
              redirectToHostname: "www.grumphya.com",
            },
          }
        : check,
    );
    await completeDomainReport("grumphya.com", reverseChecks);
    await expect(store.resolveCanonicalHostname("grumphya.com")).resolves.toBe("www.grumphya.com");
    await expect(store.readPublicDomainSnapshot("grumphya.com")).resolves.toMatchObject({
      hostnameResolution: { canonicalHostname: "www.grumphya.com", statusCode: 308 },
      lastReport: { id: wwwCurrentSnapshot?.lastReport?.id, hostname: "www.grumphya.com" },
    });
  });

  it("does not issue a badge while the certification is pending", async () => {
    const hostname = "pending.example.net";
    await store.ensureDomain(hostname, "on_demand", "domain-v1");
    await store.ensureFreshScan({ hostname, profileVersion: "domain-v1", trigger: "requested" });
    const job = await store.claimNextScan(new Date(), TEST_LEASE_MS);
    if (!job) throw new Error("expected_claimed_pending_scan");
    const reportId = await store.completeScan({
      jobId: job.id,
      leaseToken: job.leaseToken,
      hostname,
      profileVersion: "domain-v1",
      scannerVersion: "test",
      startedAt: new Date(Date.now() - 1000),
      completedAt: new Date(),
      verdict: "inconclusive",
      scope: ["/"],
      checks: makeDomainV1Checks(),
      metrics: { requestsCount: 0, bytesCount: 0, durationMs: 1, pagesCount: 0 },
    });

    const certification = await pool.query(
      "SELECT state, latest_assessment_status FROM ds_beta_certifications WHERE hostname = $1",
      [hostname],
    );
    expect(certification.rows[0]).toEqual({ state: "pending", latest_assessment_status: "pending" });
    await expect(
      store.issueReportBadge({ hostname, reportId, tokenHash: "c".repeat(64), expiresAt: new Date(Date.now() + 86_400_000) }),
    ).resolves.toBe(false);
  });

  it("suspends and reactivates the certification across eligible reports", async () => {
    const hostname = "lifecycle.example.net";
    await store.ensureDomain(hostname, "on_demand", "domain-v3");

    const completeLifecycleScan = async (
      checks: ScanCheck[],
      verdict: "pass" | "fail",
    ): Promise<string> => {
      await store.ensureFreshScan({ hostname, profileVersion: "domain-v3", trigger: "requested" });
      const job = await store.claimNextScan(new Date(), TEST_LEASE_MS);
      if (!job) throw new Error("expected_claimed_lifecycle_scan");
      const completedAt = new Date(Date.now() - 5 * 60 * 1000);
      const reportId = await store.completeScan({
        jobId: job.id,
        leaseToken: job.leaseToken,
        hostname,
        profileVersion: "domain-v3",
        scannerVersion: "test",
        startedAt: new Date(completedAt.getTime() - 1000),
        completedAt,
        verdict,
        scope: ["/"],
        checks,
        metrics: { requestsCount: 0, bytesCount: 0, durationMs: 1, pagesCount: 0 },
      });
      // Beta scan admission has no report cache, so lifecycle assertions can
      // request the next audit immediately after completion.
      await pool.query(
        "UPDATE ds_scan_jobs SET queued_at = clock_timestamp() - interval '25 hours' WHERE id = $1",
        [job.id],
      );
      return reportId;
    };

    const eligibleReportId = await completeLifecycleScan(makeEligibleDomainV3Checks(), "pass");
    await expect(
      pool.query("SELECT state FROM ds_beta_certifications WHERE hostname = $1", [hostname]),
    ).resolves.toMatchObject({ rows: [{ state: "active" }] });
    await expect(
      pool.query(
        "SELECT from_state, to_state, report_id, reason_code FROM ds_beta_certification_events WHERE hostname = $1 ORDER BY created_at",
        [hostname],
      ),
    ).resolves.toMatchObject({
      rows: [{ from_state: null, to_state: "active", report_id: eligibleReportId, reason_code: "eligible_assessment" }],
    });

    const tokenHash = "d".repeat(64);
    const expiresAt = new Date(Date.now() + 86_400_000);
    await expect(store.issueReportBadge({ hostname, reportId: eligibleReportId, tokenHash, expiresAt })).resolves.toBe(true);

    const blockedChecks = makeEligibleDomainV3Checks().map((check) =>
      check.controlId === "DS-TLS-01"
        ? { ...check, status: "fail" as const, summary: "Comprobación DS-TLS-01: fail.", evidence: { protocol: "TLSv1.3", certificateValid: false, hostnameMatches: true } }
        : check,
    );
    const blockedReportId = await completeLifecycleScan(blockedChecks, "fail");
    expect(blockedReportId).not.toBe(eligibleReportId);
    await expect(
      pool.query("SELECT state FROM ds_beta_certifications WHERE hostname = $1", [hostname]),
    ).resolves.toMatchObject({ rows: [{ state: "suspended" }] });
    await expect(
      pool.query(
        "SELECT from_state, to_state, report_id, reason_code FROM ds_beta_certification_events WHERE hostname = $1 ORDER BY created_at",
        [hostname],
      ),
    ).resolves.toMatchObject({
      rows: [
        { from_state: null, to_state: "active", report_id: eligibleReportId, reason_code: "eligible_assessment" },
        { from_state: "active", to_state: "suspended", report_id: blockedReportId, reason_code: "blocked_assessment" },
      ],
    });
    await expect(store.verifyReportBadge({ hostname, reportId: eligibleReportId, tokenHash, at: new Date() })).resolves.toBe("report_not_current");

    const reactivatedReportId = await completeLifecycleScan(makeEligibleDomainV3Checks(), "pass");
    await expect(
      pool.query("SELECT state, certified_report_id FROM ds_beta_certifications WHERE hostname = $1", [hostname]),
    ).resolves.toMatchObject({ rows: [{ state: "active", certified_report_id: reactivatedReportId }] });
    await expect(
      pool.query(
        "SELECT from_state, to_state, report_id, reason_code FROM ds_beta_certification_events WHERE hostname = $1 ORDER BY created_at",
        [hostname],
      ),
    ).resolves.toMatchObject({
      rows: [
        { from_state: null, to_state: "active", report_id: eligibleReportId, reason_code: "eligible_assessment" },
        { from_state: "active", to_state: "suspended", report_id: blockedReportId, reason_code: "blocked_assessment" },
        { from_state: "suspended", to_state: "active", report_id: reactivatedReportId, reason_code: "eligible_assessment" },
      ],
    });
    await expect(
      store.verifyReportBadge({ hostname, reportId: eligibleReportId, tokenHash, at: new Date() }),
    ).resolves.toBe("report_not_current");
    await expect(
      store.verifyReportBadge({ hostname, reportId: reactivatedReportId, tokenHash, at: new Date() }),
    ).resolves.toBe("verified");
    await expect(store.issueReportBadge({ hostname, reportId: reactivatedReportId, tokenHash: "e".repeat(64), expiresAt })).resolves.toBe(true);
  });

  it("keeps an active certification and badge during a pending reassessment", async () => {
    const hostname = "pending-reassessment.example.net";
    await store.ensureDomain(hostname, "on_demand", "domain-v3");
    const completeAt = async (completedAt: Date, checks: ScanCheck[], verdict: "pass" | "inconclusive") => {
      await store.ensureFreshScan({ hostname, profileVersion: "domain-v3", trigger: "requested" });
      const job = await store.claimNextScan(new Date(), TEST_LEASE_MS);
      if (!job) throw new Error("expected_claimed_pending_reassessment_scan");
      const reportId = await store.completeScan({
        jobId: job.id,
        leaseToken: job.leaseToken,
        hostname,
        profileVersion: "domain-v3",
        scannerVersion: TEST_SCANNER,
        startedAt: new Date(completedAt.getTime() - 1_000),
        completedAt,
        verdict,
        scope: ["/"],
        checks,
        metrics: { requestsCount: 0, bytesCount: 0, durationMs: 1, pagesCount: 0 },
      });
      await pool.query(
        "UPDATE ds_scan_jobs SET queued_at = clock_timestamp() - interval '25 hours' WHERE id = $1",
        [job.id],
      );
      return reportId;
    };

    const eligibleReportId = await completeAt(new Date(Date.now() - 30 * 60 * 1000), makeEligibleDomainV3Checks(), "pass");
    const pendingChecks = makeEligibleDomainV3Checks().map((check) =>
      check.controlId === "DS-HDR-01"
        ? { ...check, status: "unknown" as const, summary: "Comprobación DS-HDR-01: unknown." }
        : check,
    );
    const pendingReportId = await completeAt(new Date(Date.now() - 10 * 60 * 1000), pendingChecks, "inconclusive");
    const tokenHash = "f".repeat(64);
    const expiresAt = new Date(Date.now() + 86_400_000);

    await expect(
      pool.query("SELECT state, latest_assessment_status, certified_report_id FROM ds_beta_certifications WHERE hostname = $1", [hostname]),
    ).resolves.toMatchObject({
      rows: [{ state: "active", latest_assessment_status: "pending", certified_report_id: eligibleReportId }],
    });
    expect(pendingReportId).not.toBe(eligibleReportId);
    await expect(store.issueReportBadge({ hostname, reportId: eligibleReportId, tokenHash, expiresAt })).resolves.toBe(true);
    await expect(store.verifyReportBadge({ hostname, reportId: eligibleReportId, tokenHash, at: new Date() })).resolves.toBe("verified");
    await expect(
      store.verifyReportBadge({
        hostname,
        reportId: eligibleReportId,
        tokenHash,
        at: new Date(Date.now() + 2 * 60 * 60 * 1000),
      }),
    ).resolves.toBe("report_not_current");
  });

  it("does not let an older report overwrite a newer certification state", async () => {
    const hostname = "ordered-certification.example.net";
    await store.ensureDomain(hostname, "on_demand", "domain-v3");

    const completeScanAt = async (completedAt: Date, checks: ScanCheck[], verdict: "pass" | "fail") => {
      await store.ensureFreshScan({ hostname, profileVersion: "domain-v3", trigger: "requested" });
      const job = await store.claimNextScan(new Date(), TEST_LEASE_MS);
      if (!job) throw new Error("expected_claimed_ordered_scan");
      const reportId = await store.completeScan({
        jobId: job.id,
        leaseToken: job.leaseToken,
        hostname,
        profileVersion: "domain-v3",
        scannerVersion: TEST_SCANNER,
        startedAt: new Date(completedAt.getTime() - 1_000),
        completedAt,
        verdict,
        scope: ["/"],
        checks,
        metrics: { requestsCount: 0, bytesCount: 0, durationMs: 1, pagesCount: 0 },
      });
      await pool.query(
        "UPDATE ds_scan_jobs SET queued_at = clock_timestamp() - interval '25 hours' WHERE id = $1",
        [job.id],
      );
      return reportId;
    };

    const newerCompletedAt = new Date(Date.now() - 60 * 60 * 1000);
    const eligibleReportId = await completeScanAt(newerCompletedAt, makeEligibleDomainV3Checks(), "pass");
    const olderChecks = makeEligibleDomainV3Checks().map((check) =>
      check.controlId === "DS-TLS-01"
        ? {
          ...check,
          status: "fail" as const,
          summary: "Comprobación DS-TLS-01: fail.",
          evidence: { protocol: "TLSv1.3", certificateValid: false, hostnameMatches: true },
        }
        : check,
    );
    const olderReportId = await completeScanAt(
      new Date(newerCompletedAt.getTime() - 60 * 60 * 1000),
      olderChecks,
      "fail",
    );

    await expect(
      pool.query(
        "SELECT state, latest_report_id, certified_report_id FROM ds_beta_certifications WHERE hostname = $1",
        [hostname],
      ),
    ).resolves.toMatchObject({
      rows: [{ state: "active", latest_report_id: eligibleReportId, certified_report_id: eligibleReportId }],
    });
    expect(olderReportId).not.toBe(eligibleReportId);
  });

  it("queues due certified audits and gives manual requests priority", async () => {
    const hostname = "scheduled-certification.example.net";
    const completedAt = new Date(Date.now() - 45 * 60 * 1000);
    await store.ensureDomain(hostname, "on_demand", "domain-v3");
    await store.ensureFreshScan({ hostname, profileVersion: "domain-v3", trigger: "requested" });
    const certificationJob = await store.claimNextScan(new Date(), TEST_LEASE_MS);
    if (!certificationJob) throw new Error("expected_claimed_certification_scan");
    await store.completeScan({
      jobId: certificationJob.id,
      leaseToken: certificationJob.leaseToken,
      hostname,
      profileVersion: "domain-v3",
      scannerVersion: TEST_SCANNER,
      startedAt: new Date(completedAt.getTime() - 1_000),
      completedAt,
      verdict: "pass",
      scope: ["/"],
      checks: makeEligibleDomainV3Checks(),
      metrics: { requestsCount: 0, bytesCount: 0, durationMs: 1, pagesCount: 0 },
    });
    await expect(
      pool.query("SELECT state FROM ds_beta_certifications WHERE hostname = $1", [hostname]),
    ).resolves.toMatchObject({ rows: [{ state: "active" }] });

    const notDue = await pool.query<{ ds_enqueue_due_certification_scans: number }>(
      "SELECT public.ds_enqueue_due_certification_scans($1)",
      [new Date(completedAt.getTime() + 39 * 60 * 1000)],
    );
    expect(notDue.rows[0].ds_enqueue_due_certification_scans).toBe(0);

    const audit = await pool.query<{ ds_enqueue_due_certification_scans: number }>(
      "SELECT public.ds_enqueue_due_certification_scans($1)",
      [new Date(completedAt.getTime() + 40 * 60 * 1000)],
    );
    expect(audit.rows[0].ds_enqueue_due_certification_scans).toBe(1);

    const manual = await store.requestOnDemandScan("manual-priority.example.net");
    expect(manual.kind).toBe("queued");
    const claimed = await store.claimNextScan(new Date(), TEST_LEASE_MS);
    expect(claimed?.trigger).toBe("requested");
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

  it("queues a new scan immediately after a recent report during beta", async () => {
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
      profileVersion: "domain-v4",
      optedOut: false,
    });
    expect(snapshot?.activeJobId).toBeTruthy();
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

  it("reads public reports with only persisted allowlisted evidence", async () => {
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
    expect(snapshot?.lastReport?.checks[0].evidence).toEqual({});
    expect(report).toMatchObject({ id: reportId, hostname: TEST_HOSTNAME });
    expect(report?.checks[0].evidence).toEqual({});
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
    await pool.query(
      "UPDATE ds_scan_jobs SET queued_at = clock_timestamp() - interval '25 hours' WHERE id = $1",
      [job.id],
    );
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
    expect(publicReport?.checks[0].evidence).toEqual({
      addressClass: "public",
      aRecordCount: 1,
      aaaaRecordCount: 0,
    });
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
    expect(publicReport?.checks.find(({ controlId }) => controlId === "DS-PRIV-05")?.evidence)
      .toMatchObject({ cookieCount: 0, catalogMatchCount: 0 });
  });

  it("accepts domain-v2 tracking and initial-response measurements in PostgreSQL", async () => {
    const job = await queueAndClaim("domain-v2");
    const reportId = await completeDirectly(job, ["/"], makeDomainV2Checks(), "pass");
    const publicReport = await store.readPublicReport(reportId);

    expect(publicReport).toMatchObject({ profileVersion: "domain-v2", verdict: "pass" });
    expect(publicReport?.checks).toHaveLength(8);
    expect(publicReport?.checks.find(({ controlId }) => controlId === "DS-PRIV-06")?.evidence)
      .toMatchObject({ thirdPartyResourceReferences: 2, knownTrackingResourceReferences: 0 });
    expect(publicReport?.checks.find(({ controlId }) => controlId === "DS-QUAL-02")?.evidence)
      .toMatchObject({ responseTimeMs: 800, responseBytes: 40_000 });
  });

  it("stores and returns the complete TLS version matrix for domain-v3", async () => {
    const job = await queueAndClaim("domain-v3");
    const checks = [
      ...makeDomainV2Checks().map((check) => ({
        ...check,
        limitation: "Resultado limitado a las rutas públicas declaradas del perfil domain-v3.",
      })),
      {
        ...makeDomainV2Checks()[1],
        controlId: "DS-TLS-02",
        method: "TLS",
        summary: "Comprobación DS-TLS-02: pass.",
        limitation: "Resultado limitado a las rutas públicas declaradas del perfil domain-v3.",
        evidence: { tls10Accepted: false, tls11Accepted: false, tls12Accepted: true, tls13Accepted: true },
      },
    ];
    const reportId = await completeDirectly(job, ["/"], checks, "pass");
    const report = await store.readPublicReport(reportId);

    expect(report).toMatchObject({ profileVersion: "domain-v3", scannerVersion: expect.any(String) });
    expect(report?.checks).toHaveLength(9);
    expect(report?.checks.find(({ controlId }) => controlId === "DS-TLS-02"))
      .toMatchObject({ status: "pass", evidence: { tls10Accepted: false, tls11Accepted: false, tls12Accepted: true, tls13Accepted: true } });
  });

  it("stores public-policy evidence for domain-v4 without exposing policy URLs or text", async () => {
    const job = await queueAndClaim("domain-v4");
    const checks: ScanCheck[] = [
      ...makeEligibleDomainV3Checks().map((check) => ({
        ...check,
        limitation: "Resultado limitado a las rutas públicas declaradas del perfil domain-v4.",
      })),
      {
        ...CHECK,
        controlId: "DS-PRIV-04",
        method: "GET",
        status: "pass",
        summary: "Comprobación DS-PRIV-04: pass.",
        limitation: "Resultado limitado a las rutas públicas declaradas del perfil domain-v4.",
        evidence: {
          inspected: true,
          privacyPolicyLinksFound: 1,
          policyLinksFound: 2,
          sitePrivacyPolicyFetched: true,
          policyPagesFetched: 2,
          policyPagesMissing: 0,
          policyPagesDenied: 0,
          policyRecipientsMentioned: true,
          policyPurposesMentioned: true,
          policyTextBlocked: false,
          policyProbeFailed: false,
          policyLanguageCatalogVersion: "public-policy-language-eea-v1",
        },
      },
    ];
    const reportId = await completeDirectly(job, ["/"], checks, "pass");
    const report = await store.readPublicReport(reportId);
    const policyCheck = report?.checks.find(({ controlId }) => controlId === "DS-PRIV-04");

    expect(report).toMatchObject({ profileVersion: "domain-v4", verdict: "pass" });
    expect(report?.checks).toHaveLength(10);
    expect(policyCheck?.status).toBe("pass");
    expect(policyCheck?.evidence).toMatchObject({
      privacyPolicyLinksFound: 1,
      policyPagesFetched: 2,
      policyLanguageCatalogVersion: "public-policy-language-eea-v1",
    });
    expect(JSON.stringify(report)).not.toContain("vendor.example");
    expect(JSON.stringify(report)).not.toContain("token=private");
  });

  it("persists and publicly projects bounded page-probe diagnostics for domain-v4", async () => {
    const job = await queueAndClaim("domain-v4");
    const checks = [
      ...makeEligibleDomainV3Checks().map((check) => {
        const base = {
          ...check,
          limitation: "Resultado limitado a las rutas públicas declaradas del perfil domain-v4.",
        };
        if (check.controlId === "DS-HDR-01") {
          return {
            ...base,
            status: "unknown" as const,
            summary: "El lector no pudo completar esta comprobación: no se pudo completar la conexión.",
            evidence: { finalScheme: "https", probeErrorCode: "connection_failed" },
          };
        }
        if (check.controlId === "DS-PRIV-05") {
          return {
            ...base,
            status: "unknown" as const,
            summary: "El lector no pudo completar esta comprobación: se agotó el tiempo de espera.",
            evidence: { ...check.evidence, probeErrorCode: "request_timeout" },
          };
        }
        return base;
      }),
      {
        ...CHECK,
        controlId: "DS-PRIV-04",
        method: "GET",
        status: "pass" as const,
        summary: "Comprobación DS-PRIV-04: pass.",
        limitation: "Resultado limitado a las rutas públicas declaradas del perfil domain-v4.",
        evidence: {
          inspected: true,
          privacyPolicyLinksFound: 1,
          policyLinksFound: 1,
          sitePrivacyPolicyFetched: true,
          policyPagesFetched: 1,
          policyPagesMissing: 0,
          policyPagesDenied: 0,
          policyRecipientsMentioned: true,
          policyPurposesMentioned: true,
          policyTextBlocked: false,
          policyProbeFailed: false,
          policyLanguageCatalogVersion: "public-policy-language-eea-v1",
        },
      },
    ];

    const reportId = await completeDirectly(job, ["/"], checks, "inconclusive");
    const report = await store.readPublicReport(reportId);

    expect(report?.checks.find(({ controlId }) => controlId === "DS-HDR-01"))
      .toMatchObject({
        status: "unknown",
        summary: "El lector no pudo completar esta comprobación: no se pudo completar la conexión.",
        evidence: { probeErrorCode: "connection_failed" },
      });
    expect(report?.checks.find(({ controlId }) => controlId === "DS-PRIV-05"))
      .toMatchObject({
        status: "unknown",
        summary: "El lector no pudo completar esta comprobación: se agotó el tiempo de espera.",
        evidence: { probeErrorCode: "request_timeout" },
      });

    const invalidJob = await queueAndClaim("domain-v4");
    const invalidChecks = checks.map((check) =>
      check.controlId === "DS-HDR-01"
        ? {
            ...check,
            summary: "El lector no pudo completar esta comprobación: la prueba no pudo completarse.",
            evidence: { finalScheme: "https", probeErrorCode: "unexpected_value" },
          }
        : check,
    );
    await expect(completeDirectly(invalidJob, ["/"], invalidChecks, "inconclusive"))
      .rejects.toThrow("scan_evidence_invalid");
  });

  it("stores bounded TLS probe diagnostics for an inconclusive domain-v3 check", async () => {
    const job = await queueAndClaim("domain-v3");
    const checks = [
      ...makeDomainV2Checks().map((check) => ({
        ...check,
        limitation: "Resultado limitado a las rutas públicas declaradas del perfil domain-v3.",
      })),
      {
        ...makeDomainV2Checks()[1],
        controlId: "DS-TLS-02",
        method: "TLS",
        status: "unknown" as const,
        summary: "No se pudieron completar todas las pruebas de TLS. TLS 1.2: no se pudo completar la conexión. TLS 1.3: se agotó el tiempo de espera.",
        limitation: "Resultado limitado a las rutas públicas declaradas del perfil domain-v3.",
        evidence: { tls12ProbeError: "connection_failed", tls13ProbeError: "request_timeout" },
      },
    ];

    const reportId = await completeDirectly(job, ["/"], checks, "inconclusive");
    const report = await store.readPublicReport(reportId);

    expect(report?.checks.find(({ controlId }) => controlId === "DS-TLS-02"))
      .toMatchObject({
        status: "unknown",
        summary: "No se pudieron completar todas las pruebas de TLS. TLS 1.2: no se pudo completar la conexión. TLS 1.3: se agotó el tiempo de espera.",
        evidence: { tls12ProbeError: "connection_failed", tls13ProbeError: "request_timeout" },
      });
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
      store.failScan(second.id, second.leaseToken, "executor_failed", MAX_ATTEMPTS, {
        stage: "executor",
        code: "executor_application_failed",
        probeFailures: [{ operation: "dns", code: "dns_resolution_failed" }],
      }),
    ).resolves.toBe("failed");
    const failed = await pool.query(
      "SELECT state, public_error_code, failure_diagnostic FROM ds_scan_jobs WHERE id = $1",
      [first.id],
    );
    expect(failed.rows[0]).toEqual({
      state: "failed",
      public_error_code: "executor_failed",
      failure_diagnostic: {
        stage: "executor",
        code: "executor_application_failed",
        probeFailures: [{ operation: "dns", code: "dns_resolution_failed" }],
      },
    });
  });

  it("persists coordinator timeout diagnostics allowed by the migration", async () => {
    const job = await queueAndClaim();
    await expect(
      store.failScan(job.id, job.leaseToken, "executor_failed", 1, {
        stage: "executor",
        code: "runtime_execution_timeout",
      }),
    ).resolves.toBe("failed");
    const failed = await pool.query(
      "SELECT failure_diagnostic FROM ds_scan_jobs WHERE id = $1",
      [job.id],
    );
    expect(failed.rows[0].failure_diagnostic).toEqual({
      stage: "executor",
      code: "runtime_execution_timeout",
    });
  });

  it.each(SCAN_FAILURE_DIAGNOSTIC_STAGES)("persists the allowlisted runtime phase %s", async (stage) => {
    const job = await queueAndClaim();
    await expect(
      store.failScan(job.id, job.leaseToken, "executor_failed", 1, {
        stage,
        code: "executor_application_failed",
      }),
    ).resolves.toBe("failed");
    const failed = await pool.query(
      "SELECT failure_diagnostic FROM ds_scan_jobs WHERE id = $1",
      [job.id],
    );
    expect(failed.rows[0].failure_diagnostic).toEqual({
      stage,
      code: "executor_application_failed",
    });
  });

  it.each(SCAN_FAILURE_DIAGNOSTIC_CODES)("persists the allowlisted runtime failure code %s", async (code) => {
    const job = await queueAndClaim();
    await expect(
      store.failScan(job.id, job.leaseToken, "executor_failed", 1, {
        stage: "provider_document_catalog_record",
        code,
      }),
    ).resolves.toBe("failed");
    const failed = await pool.query(
      "SELECT failure_diagnostic FROM ds_scan_jobs WHERE id = $1",
      [job.id],
    );
    expect(failed.rows[0].failure_diagnostic).toEqual({
      stage: "provider_document_catalog_record",
      code,
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

  it("purges inactive public reports while preserving monitored and certified domains", async () => {
    const completedAt = new Date(Date.now() - 31 * 24 * 60 * 60 * 1000);
    const completeOldReport = async (
      hostname: string,
      enrollment: "monitored" | "on_demand",
      profileVersion: "domain-v1" | "domain-v3",
      checks: ScanCheck[],
      verdict: "pass" | "inconclusive",
    ): Promise<string> => {
      await store.ensureDomain(hostname, enrollment, profileVersion);
      await store.ensureFreshScan({ hostname, profileVersion, trigger: "requested" });
      const job = await store.claimNextScan(new Date(), TEST_LEASE_MS);
      if (!job) throw new Error("expected_claimed_inactivity_scan");
      return store.completeScan({
        jobId: job.id,
        leaseToken: job.leaseToken,
        hostname,
        profileVersion,
        scannerVersion: TEST_SCANNER,
        startedAt: new Date(completedAt.getTime() - 1_000),
        completedAt,
        verdict,
        scope: ["/"],
        checks,
        metrics: { requestsCount: 0, bytesCount: 0, durationMs: 1, pagesCount: 0 },
      });
    };

    const inactiveReport = await completeOldReport(
      "inactive-public.example.net",
      "on_demand",
      "domain-v1",
      makeDomainV1Checks(),
      "inconclusive",
    );
    const monitoredReport = await completeOldReport(
      "monitored-public.example.net",
      "monitored",
      "domain-v1",
      makeDomainV1Checks(),
      "inconclusive",
    );
    const certifiedReport = await completeOldReport(
      "certified-public.example.net",
      "on_demand",
      "domain-v3",
      makeEligibleDomainV3Checks(),
      "pass",
    );
    const tooRecentCutoff = new Date(Date.now() - 29 * 24 * 60 * 60 * 1000);
    await expect(
      pool.query("SELECT public.ds_purge_inactive_public_reports($1)", [tooRecentCutoff]),
    ).rejects.toThrow("public_report_inactivity_window_not_reached");

    const purge = await pool.query<{ ds_purge_inactive_public_reports: number }>(
      "SELECT public.ds_purge_inactive_public_reports($1)",
      [new Date(Date.now() - 30 * 24 * 60 * 60 * 1000 - 60_000)],
    );
    expect(purge.rows[0].ds_purge_inactive_public_reports).toBe(9);
    const remaining = await pool.query(
      `SELECT
         (SELECT count(*) FROM ds_scan_runs WHERE id = $1)::integer AS inactive_runs,
         (SELECT count(*) FROM ds_scan_runs WHERE id IN ($2, $3))::integer AS preserved_runs,
         (SELECT count(*) FROM ds_scan_jobs WHERE id IN (
           SELECT job_id FROM ds_scan_runs WHERE id IN ($2, $3)
         ))::integer AS preserved_jobs`,
      [inactiveReport, monitoredReport, certifiedReport],
    );
    expect(remaining.rows[0]).toEqual({ inactive_runs: 0, preserved_runs: 2, preserved_jobs: 2 });
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

  function makeDomainV2Checks(): ScanCheck[] {
    const checks = makeDomainV1Checks().map((check) => ({
      ...check,
      status: "pass" as const,
      summary: check.controlId === "DS-PRIV-05"
        ? check.summary
        : `Comprobación ${check.controlId}: pass.`,
      limitation: "Resultado limitado a las rutas públicas declaradas del perfil domain-v2.",
    }));
    checks.push(
      {
        ...CHECK,
        controlId: "DS-PRIV-06",
        method: "GET",
        status: "pass",
        summary: "Comprobación DS-PRIV-06: pass.",
        limitation: "Resultado limitado a las rutas públicas declaradas del perfil domain-v2.",
        evidence: { inspected: true, thirdPartyResourceReferences: 2, knownTrackingResourceReferences: 0 },
      },
      {
        ...CHECK,
        controlId: "DS-QUAL-02",
        method: "GET",
        status: "pass",
        summary: "Comprobación DS-QUAL-02: pass.",
        limitation: "Resultado limitado a las rutas públicas declaradas del perfil domain-v2.",
        evidence: { inspected: true, responseTimeMs: 800, responseBytes: 40_000 },
      },
    );
    return checks;
  }

  function makeEligibleDomainV3Checks(): ScanCheck[] {
    return [
      ...makeDomainV2Checks(),
      {
        ...CHECK,
        controlId: "DS-TLS-02",
        method: "TLS",
        status: "pass",
        summary: "Comprobación DS-TLS-02: pass.",
        limitation: "Resultado limitado a las rutas públicas declaradas del perfil domain-v3.",
        evidence: { tls10Accepted: false, tls11Accepted: false, tls12Accepted: true, tls13Accepted: true },
      },
    ];
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
