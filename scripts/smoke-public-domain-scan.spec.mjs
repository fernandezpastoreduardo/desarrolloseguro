import assert from "node:assert/strict";
import { test } from "node:test";
import {
  SCAN_TIMEOUT_MS,
  validateWwwRedirect,
  validateCompletedReport,
  validateReusableAdmission,
  describeNonBlockingDiagnostics,
  validateTerminalFailure,
  describeTerminalFailure,
  describeStatusProgress,
  waitForPublicScanReport,
  requestPublicScanWhenAvailable,
} from "./smoke-public-domain-scan.mjs";

function completedStatus() {
  const checks = [
    { controlId: "DS-DNS-01", status: "pass", summary: "DNS válido" },
    { controlId: "DS-TLS-01", status: "pass", summary: "TLS válido" },
    { controlId: "DS-TLS-02", status: "pass", summary: "Versiones TLS comprobadas", evidence: { tls10Accepted: false, tls11Accepted: false, tls12Accepted: true, tls13Accepted: true } },
    { controlId: "DS-HTTP-01", status: "pass", summary: "HTTP válido" },
    { controlId: "DS-HTTP-01", status: "pass", summary: "HTTP válido" },
    { controlId: "DS-HDR-01", status: "fail", summary: "Faltan cabeceras" },
    { controlId: "DS-PRIV-04", status: "pass", summary: "Política pública revisada", evidence: { inspected: true, privacyPolicyLinksFound: 1, policyLinksFound: 1, sitePrivacyPolicyFetched: true, policyPagesFetched: 1, policyPagesMissing: 0, policyPagesDenied: 0, policyRecipientsMentioned: true, policyPurposesMentioned: true, policyTextBlocked: false, policyProbeFailed: false, policyLanguageCatalogVersion: "public-policy-language-eea-v1" } },
    { controlId: "DS-PRIV-05", status: "pass", summary: "Sin cookies conocidas" },
    { controlId: "DS-PRIV-06", status: "pass", summary: "No hay referencias a rastreadores conocidos" },
    { controlId: "DS-QUAL-02", status: "pass", summary: "Métricas completas en móvil y escritorio", evidence: {
      mobileFcpMs: 900, mobileLcpMs: 1_200, mobileClsMilli: 10, mobileTbtMs: 50, mobileTtfbMs: 300, mobileTransferBytes: 400_000, mobileScore: 100,
      desktopFcpMs: 500, desktopLcpMs: 800, desktopClsMilli: 10, desktopTbtMs: 10, desktopTtfbMs: 200, desktopTransferBytes: 400_000, desktopScore: 100,
    } },
  ];
  const criteria = [
    { id: "dns-integrity", status: "pass" },
    { id: "transport-security", status: "pass" },
    { id: "http-availability", status: "pass" },
    { id: "security-headers", status: "fail" },
    { id: "external-service-transparency", status: "pass" },
    { id: "initial-cookie-risk", status: "pass" },
    { id: "tracking", status: "pass" },
    { id: "performance", status: "pass" },
  ];
  return {
    hostname: "grumphya.com",
    lastReport: {
      id: "f7490d2d-2976-4a89-a9a7-001690e873ef",
      profileVersion: "domain-v5",
      scannerVersion: "domain-v5-network-adapter-2",
      completedAt: "2026-11-11T20:00:00.000Z",
      checks,
      ethicsAssessment: {
        policyVersion: "domain-ethics-v6",
        score: 75,
        assessedCriteria: 8,
        totalCriteria: 8,
        criteria,
      },
      processorTransparencyAssessment: {
        policyVersion: "processor-inventory-v1",
        status: "pass",
        reasonCode: "inventory_complete_empty",
      },
      publicPolicyTransparencyAssessment: {
        policyVersion: "public-policy-v1",
        status: "pass",
        reasonCode: "disclosure_found",
      },
      publicServiceComparison: {
        policyVersion: "public-service-comparison-v1",
        status: "pass",
        reasonCode: "services_disclosed",
        items: [],
      },
    },
  };
}

test("bounds the live scan smoke wait to fifteen minutes for the serial queue", () => {
  assert.equal(SCAN_TIMEOUT_MS, 15 * 60 * 1000);
});

test("accepts a refreshed report with all eight v6 ethics criteria and service evidence", () => {
  const status = completedStatus();
  const report = validateCompletedReport(
    status,
    "previous-report-id",
  );
  assert.equal(report.ethicsAssessment.score, 75);
  assert.equal(report.ethicsAssessment.assessedCriteria, 8);
  assert.equal(report.processorTransparencyAssessment.status, "pass");
  assert.equal(report.publicPolicyTransparencyAssessment.status, "pass");
  assert.equal(report.checks.length, 10);
});

test("blocks deployment when the live report lacks a mobile or desktop performance metric", () => {
  const status = completedStatus();
  const performanceCheck = status.lastReport.checks.find(({ controlId }) => controlId === "DS-QUAL-02");
  delete performanceCheck.evidence.mobileLcpMs;
  assert.throws(
    () => validateCompletedReport(status, "previous-report-id"),
    /public_scan_performance_metrics_incomplete/u,
  );
});

test("requires 100/100 and source-registry evidence for the self-domain report", () => {
  const status = structuredClone(completedStatus());
  status.hostname = "desarrolloseguro.org";
  status.lastReport.hostname = "desarrolloseguro.org";
  status.lastReport.ethicsAssessment.score = 100;
  status.lastReport.privacyAssessment = { score: 100, unknownCriteria: 0 };
  status.lastReport.globalAssessment = { status: "scored", score: 100 };
  status.lastReport.processorTransparencyAssessment.inventory = {
    hostname: "desarrolloseguro.org",
    evidenceSource: "desarrolloseguro_source_registry",
    inventoryStatus: "complete",
    deploymentDigest: `sha256:${"a".repeat(64)}`,
    attestation: { verified: true },
  };

  const report = validateCompletedReport(status, "previous-report-id", "desarrolloseguro.org");
  assert.equal(report.ethicsAssessment.score, 100);
  assert.equal(report.globalAssessment.score, 100);

  status.lastReport.processorTransparencyAssessment.inventory.evidenceSource = "untrusted_source";
  assert.throws(
    () => validateCompletedReport(status, "previous-report-id", "desarrolloseguro.org"),
    { message: "self_domain_report_score_or_evidence_invalid" },
  );
});

test("accepts a cached or rate-limited admission when the existing report is valid", () => {
  const status = completedStatus();
  assert.equal(
    validateReusableAdmission({ hostname: "grumphya.com", state: "cached" }, status).id,
    status.lastReport.id,
  );
  assert.equal(
    validateReusableAdmission({ hostname: "grumphya.com", state: "rate_limited" }, status).id,
    status.lastReport.id,
  );
});

test("rejects a reusable admission without a valid existing report", () => {
  assert.throws(
    () => validateReusableAdmission(
      { hostname: "grumphya.com", state: "rate_limited" },
      { hostname: "grumphya.com", lastReport: null },
    ),
    { message: "public_scan_report_missing" },
  );
});

test("retries a hostname slot held by a different URL until the requested URL is admitted", async () => {
  let currentTime = 0;
  let requests = 0;
  let statusReads = 0;
  const result = await requestPublicScanWhenAvailable({
    timeoutMs: 90_000,
    retryIntervalMs: 30_000,
    now: () => currentTime,
    wait: async (milliseconds) => { currentTime += milliseconds; },
    requestAnalysis: async () => {
      requests += 1;
      return {
        hostname: "grumphya.com",
        state: requests === 1 ? "rate_limited" : "queued",
      };
    },
    getStatus: async () => {
      statusReads += 1;
      return { hostname: "grumphya.com", lastReport: null };
    },
  });

  assert.equal(result.admission.state, "queued");
  assert.equal(result.report, null);
  assert.equal(requests, 2);
  assert.equal(statusReads, 1);
});

test("reuses a valid matching-scope report when an admission is rate-limited", async () => {
  const report = await requestPublicScanWhenAvailable({
    requestAnalysis: async () => ({ hostname: "grumphya.com", state: "rate_limited" }),
    getStatus: async () => completedStatus(),
  });
  assert.equal(report.report.id, completedStatus().lastReport.id);
});

test("does not treat a cached admission without its matching report as reusable", async () => {
  await assert.rejects(
    requestPublicScanWhenAvailable({
      requestAnalysis: async () => ({ hostname: "grumphya.com", state: "cached" }),
      getStatus: async () => ({ hostname: "grumphya.com", lastReport: null }),
    }),
    { message: "public_scan_cached_report_missing" },
  );
});

test("does not reuse a pre-deploy report when another URL temporarily holds the hostname slot", async () => {
  let currentTime = 0;
  let requests = 0;
  const previousReportId = completedStatus().lastReport.id;
  const result = await requestPublicScanWhenAvailable({
    previousReportId,
    timeoutMs: 90_000,
    retryIntervalMs: 30_000,
    now: () => currentTime,
    wait: async (milliseconds) => { currentTime += milliseconds; },
    requestAnalysis: async () => ({
      hostname: "grumphya.com",
      state: requests++ === 0 ? "rate_limited" : "queued",
    }),
    getStatus: async () => completedStatus(),
  });

  assert.equal(result.admission.state, "queued");
  assert.equal(result.report, null);
  assert.equal(requests, 2);
});

test("blocks deployment when the cache still returns the pre-deploy report", async () => {
  const previousReportId = completedStatus().lastReport.id;
  await assert.rejects(
    requestPublicScanWhenAvailable({
      previousReportId,
      requestAnalysis: async () => ({ hostname: "grumphya.com", state: "cached" }),
      getStatus: async () => completedStatus(),
    }),
    { message: "public_scan_cached_report_not_refreshed" },
  );
});

test("keeps eight-criterion coverage required when TLS has a diagnostic unknown", () => {
  const status = completedStatus();
  const tlsCheck = status.lastReport.checks.find(({ controlId }) => controlId === "DS-TLS-02");
  if (!tlsCheck) throw new Error("tls_fixture_missing");
  tlsCheck.status = "unknown";
  tlsCheck.summary = "No se pudieron completar todas las pruebas de TLS. TLS 1.0: falló la solicitud HTTPS.";
  tlsCheck.evidence = {
    tls10ProbeError: "https_request_failed",
    tls11ProbeError: "https_request_failed",
    tls12Accepted: true,
    tls13Accepted: true,
  };
  const transportCriterion = status.lastReport.ethicsAssessment.criteria.find(({ id }) => id === "transport-security");
  if (!transportCriterion) throw new Error("transport_criterion_missing");
  transportCriterion.status = "unknown";
  status.lastReport.ethicsAssessment.assessedCriteria = 7;

  assert.throws(
    () => validateCompletedReport(status, "previous-report-id"),
    /public_scan_ethics_assessment_incomplete_.*coverage_incomplete/u,
  );
});

test("rejects a TLS unknown without a complete boolean-or-diagnostic matrix", () => {
  const status = completedStatus();
  const tlsCheck = status.lastReport.checks.find(({ controlId }) => controlId === "DS-TLS-02");
  if (!tlsCheck) throw new Error("tls_fixture_missing");
  tlsCheck.status = "unknown";
  tlsCheck.summary = "No se pudieron completar todas las pruebas de TLS.";
  tlsCheck.evidence = { tls12Accepted: true };
  const transportCriterion = status.lastReport.ethicsAssessment.criteria.find(({ id }) => id === "transport-security");
  if (!transportCriterion) throw new Error("transport_criterion_missing");
  transportCriterion.status = "unknown";
  status.lastReport.ethicsAssessment.assessedCriteria = 7;

  assert.throws(
    () => validateCompletedReport(status, "previous-report-id"),
    /public_scan_ethics_assessment_incomplete_.*(?:coverage_incomplete|tls_matrix_incomplete|transport_diagnostic_incomplete)/u,
  );
});

test("accepts and reports an external processor auditor error without blocking the deploy", () => {
  const status = completedStatus();
  status.lastReport.processorTransparencyAssessment.status = "unknown";
  status.lastReport.processorTransparencyAssessment.reasonCode = "auditor_error";
  status.lastReport.processorTransparencyAssessment.inventory = null;
  const report = validateCompletedReport(status, "previous-report-id");
  assert.equal(report.processorTransparencyAssessment.status, "unknown");
  assert.deepEqual(
    describeNonBlockingDiagnostics(report, "grumphya.com"),
    ["processor_inventory_unknown_auditor_error"],
  );
});

test("keeps an auditor-owned unknown blocking the self-domain report", () => {
  const status = completedStatus();
  status.hostname = "desarrolloseguro.org";
  status.lastReport.hostname = "desarrolloseguro.org";
  status.lastReport.processorTransparencyAssessment.status = "unknown";
  status.lastReport.processorTransparencyAssessment.reasonCode = "auditor_error";
  status.lastReport.processorTransparencyAssessment.inventory = null;
  assert.throws(
    () => validateCompletedReport(status, "previous-report-id", "desarrolloseguro.org"),
    /public_scan_ethics_assessment_incomplete_.*processor_assessment_invalid/u,
  );
  assert.deepEqual(describeNonBlockingDiagnostics(status.lastReport, "desarrolloseguro.org"), []);
});

test("accepts www HTTPS redirect to the canonical domain without an exposed port", () => {
  assert.equal(
    validateWwwRedirect(301, "https://desarrolloseguro.org/").href,
    "https://desarrolloseguro.org/",
  );
  assert.throws(
    () => validateWwwRedirect(301, "https://desarrolloseguro.org:8080/"),
    { message: "development_security_www_redirect_bad_target" },
  );
  assert.throws(
    () => validateWwwRedirect(200, null),
    { message: "development_security_www_redirect_missing" },
  );
});

test("returns a safe terminal scan failure category to the deploy smoke", () => {
  assert.equal(
    validateTerminalFailure({ state: "failed", failureCode: "broker_failed" }),
    "broker_failed",
  );
  assert.throws(
    () => validateTerminalFailure({ state: "failed", failureCode: "permission denied /secret" }),
    { message: "public_scan_failure_code_invalid" },
  );
  assert.equal(validateTerminalFailure({ state: "updating", failureCode: null }), null);
  assert.equal(describeTerminalFailure({
    state: "failed",
    failureCode: "executor_failed",
    failureDiagnostic: {
      stage: "executor",
      code: "executor_application_failed",
      probeFailures: [
        { operation: "dns", code: "dns_resolution_failed" },
        { operation: "http-get", code: "connection_failed" },
      ],
    },
  }), "public_scan_terminal_executor_failed_executor_executor_application_failed_dns_dns_resolution_failed_http_get_connection_failed");
  assert.equal(describeTerminalFailure({
    state: "failed",
    failureCode: "executor_failed",
    failureDiagnostic: { stage: "executor", code: "secret /path" },
  }), "executor_failed");
});

test("formats bounded state diagnostics without exposing job or report identifiers", () => {
  assert.equal(describeStatusProgress({
    state: "failed",
    activeJobId: "job-secret-id",
    lastReport: { id: "report-secret-id" },
    failureCode: "executor_failed",
    failureDiagnostic: {
      stage: "executor",
      code: "executor_application_failed",
      probeFailures: [
        { operation: "dns", code: "dns_resolution_failed" },
        { operation: "http-get", code: "connection_failed" },
        { operation: "tls", code: "tls_failed" },
        { operation: "headers", code: "headers_failed" },
        { operation: "extra", code: "ignored" },
      ],
    },
  }), "public_scan_wait state=failed active_job=active last_report=present failure=executor_failed diagnostic_stage=executor diagnostic_code=executor_application_failed probe_failures=5");
  assert.doesNotMatch(describeStatusProgress({ activeJobId: "job-secret-id" }), /job-secret-id|report-secret-id/u);
});

test("polls through a queued scan and emits safe progress before returning its fresh report", async () => {
  let currentTime = 0;
  let calls = 0;
  const progress = [];
  const report = completedStatus().lastReport;
  const result = await waitForPublicScanReport({
    previousReportId: "previous-report-id",
    timeoutMs: 20_000,
    pollIntervalMs: 5_000,
    progressIntervalMs: 5_000,
    now: () => currentTime,
    wait: async (milliseconds) => { currentTime += milliseconds; },
    onProgress: (message) => progress.push(message),
    getStatus: async () => {
      calls += 1;
      if (calls < 3) return { state: "updating", activeJobId: "job-secret-id", lastReport: null };
      return { state: "fresh", hostname: "grumphya.com", lastReport: report };
    },
  });

  assert.equal(result.id, report.id);
  assert.equal(calls, 3);
  assert.deepEqual(progress, ["public_scan_wait state=updating active_job=active last_report=missing failure=none diagnostic_stage=none diagnostic_code=none probe_failures=0"]);
  assert.doesNotMatch(progress[0], /job-secret-id/u);
});

test("reports the final public scan state when its bounded wait expires", async () => {
  let currentTime = 0;
  const progress = [];
  await assert.rejects(
    waitForPublicScanReport({
      previousReportId: null,
      timeoutMs: 15_000,
      pollIntervalMs: 5_000,
      progressIntervalMs: 5_000,
      now: () => currentTime,
      wait: async (milliseconds) => { currentTime += milliseconds; },
      onProgress: (message) => progress.push(message),
      getStatus: async () => ({ state: "updating", activeJobId: "job-id", lastReport: null }),
    }),
    { message: "public_scan_completion_timeout_state_updating_active_job_active_last_report_missing_failure_none_diagnostic_stage_none_diagnostic_code_none_probe_failures_0" },
  );
  assert.equal(progress.at(-1), "public_scan_wait state=updating active_job=active last_report=missing failure=none diagnostic_stage=none diagnostic_code=none probe_failures=0");
});

test("fails immediately when admission has no visible job or new report", async () => {
  await assert.rejects(
    waitForPublicScanReport({
      previousReportId: "previous-report-id",
      getStatus: async () => ({ state: "stale", activeJobId: null, lastReport: { id: "previous-report-id" } }),
    }),
    { message: "public_scan_active_job_missing" },
  );
});

test("rejects reports where network failures were saved as empty unknowns", () => {
  const status = completedStatus();
  status.lastReport.checks = status.lastReport.checks.map((check) => ({
    ...check,
    status: "unknown",
    summary: `Comprobación ${check.controlId}: unknown.`,
  }));
  status.lastReport.ethicsAssessment.score = null;
  status.lastReport.ethicsAssessment.assessedCriteria = 0;

  assert.throws(
    () => validateCompletedReport(status, "previous-report-id"),
    { message: "public_scan_insufficient_observations" },
  );
});

test("rejects reports missing the initial cookie assessment", () => {
  const status = completedStatus();
  const cookieCriterion = status.lastReport.ethicsAssessment.criteria.find(
    ({ id }) => id === "initial-cookie-risk",
  );
  if (!cookieCriterion) throw new Error("cookie_criterion_fixture_missing");
  cookieCriterion.status = "unknown";

  assert.throws(
    () => validateCompletedReport(status, "previous-report-id"),
    /public_scan_ethics_assessment_incomplete_.*initial_cookie_risk_unknown/u,
  );
});
