import assert from "node:assert/strict";
import { test } from "node:test";
import {
  SCAN_TIMEOUT_MS,
  validateWwwRedirect,
  validateCompletedReport,
  validateReusableAdmission,
  validateTerminalFailure,
  describeTerminalFailure,
  describeStatusProgress,
  waitForPublicScanReport,
} from "./smoke-public-domain-scan.mjs";

function completedStatus() {
  const checks = [
    { controlId: "DS-DNS-01", status: "pass", summary: "DNS válido" },
    { controlId: "DS-TLS-01", status: "pass", summary: "TLS válido" },
    { controlId: "DS-TLS-02", status: "pass", summary: "Versiones TLS comprobadas", evidence: { tls10Accepted: false, tls11Accepted: false, tls12Accepted: true, tls13Accepted: true } },
    { controlId: "DS-HTTP-01", status: "pass", summary: "HTTP válido" },
    { controlId: "DS-HTTP-01", status: "pass", summary: "HTTP válido" },
    { controlId: "DS-HDR-01", status: "fail", summary: "Faltan cabeceras" },
    { controlId: "DS-PRIV-05", status: "pass", summary: "Sin cookies conocidas" },
    { controlId: "DS-PRIV-06", status: "pass", summary: "No hay referencias a rastreadores conocidos" },
    { controlId: "DS-QUAL-02", status: "pass", summary: "Respuesta inicial inferior a 2,5 segundos" },
  ];
  const criteria = [
    { id: "dns-integrity", status: "pass" },
    { id: "transport-security", status: "pass" },
    { id: "http-availability", status: "pass" },
    { id: "security-headers", status: "fail" },
    { id: "backend-processor-transparency", status: "pass" },
    { id: "initial-cookie-risk", status: "pass" },
    { id: "tracking", status: "pass" },
    { id: "performance", status: "pass" },
  ];
  return {
    hostname: "grumphya.com",
    lastReport: {
      id: "f7490d2d-2976-4a89-a9a7-001690e873ef",
      profileVersion: "domain-v3",
      scannerVersion: "domain-v3-network-adapter-1",
      completedAt: "2026-11-11T20:00:00.000Z",
      checks,
      ethicsAssessment: {
        policyVersion: "domain-ethics-v4",
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
    },
  };
}

test("bounds the live scan smoke wait to fifteen minutes for the serial queue", () => {
  assert.equal(SCAN_TIMEOUT_MS, 15 * 60 * 1000);
});

test("accepts a refreshed report with all eight v4 ethics criteria and a conclusive processor inventory", () => {
  const status = completedStatus();
  const report = validateCompletedReport(
    status,
    "previous-report-id",
  );
  assert.equal(report.ethicsAssessment.score, 75);
  assert.equal(report.ethicsAssessment.assessedCriteria, 8);
  assert.equal(report.processorTransparencyAssessment.status, "pass");
  assert.equal(report.checks.length, 9);
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
    { message: "public_scan_ethics_assessment_incomplete" },
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
    { message: "public_scan_ethics_assessment_incomplete" },
  );
});

test("rejects an auditor-owned unknown for the backend inventory criterion", () => {
  const status = completedStatus();
  status.lastReport.processorTransparencyAssessment.status = "unknown";
  status.lastReport.ethicsAssessment.assessedCriteria = 7;
  assert.throws(
    () => validateCompletedReport(status, "previous-report-id"),
    { message: "public_scan_ethics_assessment_incomplete" },
  );
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
    { message: "public_scan_ethics_assessment_incomplete" },
  );
});
