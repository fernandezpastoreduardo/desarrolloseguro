import { setTimeout as delay } from "node:timers/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const API_BASE_URL = "https://desarrolloseguro.org/api/desarrollo-seguro/v1";
const CANONICAL_DOMAIN = "desarrolloseguro.org";
const VALIDATION_HOSTNAMES = new Set(["grumphya.com", CANONICAL_DOMAIN]);
const VALIDATION_HOSTNAME = process.env.DS_SMOKE_HOSTNAME ?? "grumphya.com";
const SCAN_FAILURE_CODES = new Set([
  "coordinator_unavailable",
  "coordinator_socket_untrusted",
  "runtime_volume_failed",
  "broker_failed",
  "egress_failed",
  "executor_failed",
  "transport_failed",
]);
export const SCAN_TIMEOUT_MS = 15 * 60 * 1000;
const POLL_INTERVAL_MS = 5_000;
const PROGRESS_INTERVAL_MS = 30_000;

export function validateCompletedReport(status, previousReportId, hostname = VALIDATION_HOSTNAME) {
  const report = status?.lastReport;
  if (!VALIDATION_HOSTNAMES.has(hostname)) throw new Error("public_scan_hostname_invalid");
  if (!report || status.hostname !== hostname) {
    throw new Error("public_scan_report_missing");
  }
  if (report.id === previousReportId) {
    throw new Error("public_scan_report_not_refreshed");
  }
  if (
    report.profileVersion !== "domain-v3" ||
    report.scannerVersion !== "domain-v3-network-adapter-1" ||
    !Array.isArray(report.checks) ||
    report.checks.length !== 9
  ) {
    throw new Error("public_scan_profile_or_coverage_invalid");
  }

  const conclusiveChecks = report.checks.filter(
    ({ status: checkStatus }) => checkStatus === "pass" || checkStatus === "fail",
  );
  if (conclusiveChecks.length < 5) {
    throw new Error("public_scan_insufficient_observations");
  }
  const inconclusiveWithoutReason = report.checks.some(
    ({ status: checkStatus, summary }) =>
      checkStatus === "unknown" &&
      (typeof summary !== "string" || summary.includes(": unknown.")),
  );
  if (inconclusiveWithoutReason) {
    throw new Error("public_scan_inconclusive_without_diagnostic");
  }

  const assessment = report.ethicsAssessment;
  const processorAssessment = report.processorTransparencyAssessment;
  const tlsMatrix = report.checks.find(({ controlId }) => controlId === "DS-TLS-02")?.evidence;
  const transportCriterion = assessment?.criteria.find(({ id }) => id === "transport-security");
  const tlsMatrixFields = [
    { accepted: "tls10Accepted", probeError: "tls10ProbeError" },
    { accepted: "tls11Accepted", probeError: "tls11ProbeError" },
    { accepted: "tls12Accepted", probeError: "tls12ProbeError" },
    { accepted: "tls13Accepted", probeError: "tls13ProbeError" },
  ];
  const completeTlsMatrix = tlsMatrix && tlsMatrixFields.every(({ accepted, probeError }) => {
    const acceptedValue = tlsMatrix[accepted];
    const probeErrorValue = tlsMatrix[probeError];
    return typeof acceptedValue === "boolean" ||
      (typeof probeErrorValue === "string" && /^[a-z0-9_]+$/u.test(probeErrorValue));
  });
  const transportDiagnosticIsBounded = transportCriterion?.status !== "unknown" ||
    Boolean(completeTlsMatrix);
  if (
    !assessment ||
    assessment.policyVersion !== "domain-ethics-v4" ||
    !Number.isInteger(assessment.score) ||
    assessment.score < 0 ||
    assessment.score > 100 ||
    assessment.assessedCriteria !== 8 ||
    assessment.totalCriteria !== 8 ||
    !processorAssessment ||
    !["pass", "fail"].includes(processorAssessment.status) ||
    assessment.criteria.find(({ id }) => id === "initial-cookie-risk")?.status ===
      "unknown" ||
    assessment.criteria.find(({ id }) => id === "tracking")?.status === "unknown" ||
    assessment.criteria.find(({ id }) => id === "performance")?.status === "unknown"
    || !transportDiagnosticIsBounded
    || !completeTlsMatrix
  ) {
    throw new Error("public_scan_ethics_assessment_incomplete");
  }
  if (hostname === CANONICAL_DOMAIN) {
    const privacy = report.privacyAssessment;
    const global = report.globalAssessment;
    const ownInventory = processorAssessment.inventory;
    if (
      assessment.score !== 100 ||
      !privacy || privacy.score !== 100 || privacy.unknownCriteria !== 0 ||
      !global || global.status !== "scored" || global.score !== 100 ||
      ownInventory?.hostname !== CANONICAL_DOMAIN ||
      ownInventory.evidenceSource !== "desarrolloseguro_source_registry" ||
      ownInventory.inventoryStatus !== "complete" ||
      ownInventory.attestation?.verified !== true ||
      !/^sha256:[a-f0-9]{64}$/u.test(ownInventory.deploymentDigest ?? "")
    ) {
      throw new Error("self_domain_report_score_or_evidence_invalid");
    }
  }
  return report;
}

export function validateReusableAdmission(admission, status, hostname = VALIDATION_HOSTNAME) {
  if (
    !VALIDATION_HOSTNAMES.has(hostname) ||
    admission?.hostname !== hostname ||
    !["cached", "rate_limited"].includes(admission.state)
  ) {
    throw new Error("public_scan_admission_invalid");
  }
  return validateCompletedReport(status, null, hostname);
}

export function validateWwwRedirect(responseStatus, location) {
  if (![301, 302, 307, 308].includes(responseStatus) || typeof location !== "string") {
    throw new Error("development_security_www_redirect_missing");
  }
  let destination;
  try {
    destination = new URL(location, "https://www.desarrolloseguro.org/");
  } catch {
    throw new Error("development_security_www_redirect_invalid");
  }
  if (
    destination.protocol !== "https:" ||
    destination.hostname !== CANONICAL_DOMAIN ||
    destination.port !== "" ||
    destination.pathname !== "/"
  ) {
    throw new Error("development_security_www_redirect_bad_target");
  }
  return destination;
}

export function validateTerminalFailure(status) {
  if (status?.state !== "failed") return null;
  if (typeof status.failureCode !== "string" || !SCAN_FAILURE_CODES.has(status.failureCode)) {
    throw new Error("public_scan_failure_code_invalid");
  }
  return status.failureCode;
}

export function describeTerminalFailure(status) {
  const failureCode = validateTerminalFailure(status);
  if (!failureCode) return null;
  const diagnostic = status.failureDiagnostic;
  if (
    !diagnostic ||
    typeof diagnostic.stage !== "string" ||
    typeof diagnostic.code !== "string" ||
    !/^[a-z0-9_]+$/u.test(diagnostic.stage) ||
    !/^[a-z0-9_]+$/u.test(diagnostic.code)
  ) {
    return failureCode;
  }
  const probeFailures = Array.isArray(diagnostic.probeFailures) ? diagnostic.probeFailures : [];
  if (probeFailures.length > 5 || probeFailures.some((probe) =>
    !probe || typeof probe.operation !== "string" || typeof probe.code !== "string" ||
    !/^[a-z0-9-]+$/u.test(probe.operation) || !/^[a-z0-9_]+$/u.test(probe.code)
  )) return failureCode;
  const probes = probeFailures.map(({ operation, code }) => `${operation}_${code}`).join("_");
  const detail = [failureCode, diagnostic.stage, diagnostic.code, probes]
    .filter(Boolean)
    .join("_")
    .replaceAll("-", "_");
  return `public_scan_terminal_${detail}`;
}

export function describeStatusProgress(status) {
  const allowedStates = new Set([
    "queued",
    "running",
    "updating",
    "fresh",
    "stale",
    "failed",
    "not_scanned",
    "unavailable",
  ]);
  const state = allowedStates.has(status?.state) ? status.state : "unknown";
  const activeJob = status?.activeJobId ? "active" : "none";
  const report = status?.lastReport ? "present" : "missing";
  const failure = typeof status?.failureCode === "string" && SCAN_FAILURE_CODES.has(status.failureCode)
    ? status.failureCode
    : "none";
  const diagnostic = status?.failureDiagnostic;
  const diagnosticStage = diagnostic && typeof diagnostic.stage === "string" && /^[a-z0-9_]+$/u.test(diagnostic.stage)
    ? diagnostic.stage
    : "none";
  const diagnosticCode = diagnostic && typeof diagnostic.code === "string" && /^[a-z0-9_]+$/u.test(diagnostic.code)
    ? diagnostic.code
    : "none";
  const probeCount = diagnostic && Array.isArray(diagnostic.probeFailures)
    ? Math.min(diagnostic.probeFailures.length, 5)
    : 0;
  return `public_scan_wait state=${state} active_job=${activeJob} last_report=${report} failure=${failure} diagnostic_stage=${diagnosticStage} diagnostic_code=${diagnosticCode} probe_failures=${probeCount}`;
}

export async function waitForPublicScanReport({
  getStatus,
  previousReportId,
  timeoutMs = SCAN_TIMEOUT_MS,
  pollIntervalMs = POLL_INTERVAL_MS,
  progressIntervalMs = PROGRESS_INTERVAL_MS,
  now = Date.now,
  wait = delay,
  onProgress = () => {},
}) {
  const deadline = now() + timeoutMs;
  let nextProgressAt = now() + progressIntervalMs;
  let status;

  while (now() < deadline) {
    status = await getStatus();
    const failure = describeTerminalFailure(status);
    if (failure) throw new Error(failure);
    if (status?.lastReport && status.lastReport.id !== previousReportId) {
      return validateCompletedReport(status, previousReportId);
    }
    emitProgressIfDue(status, now(), nextProgressAt, onProgress);
    if (now() >= nextProgressAt) nextProgressAt = now() + progressIntervalMs;
    if (!status?.activeJobId) {
      throw new Error("public_scan_active_job_missing");
    }
    await wait(Math.min(pollIntervalMs, deadline - now()));
  }
  emitProgressIfDue(status, now(), nextProgressAt, onProgress);
  const diagnostic = describeStatusProgress(status)
    .replace("public_scan_wait ", "")
    .replaceAll("=", "_")
    .replaceAll(" ", "_");
  throw new Error(`public_scan_completion_timeout_${diagnostic}`);
}

function emitProgressIfDue(status, now, nextProgressAt, onProgress) {
  if (now < nextProgressAt) return;
  onProgress(describeStatusProgress(status));
}

async function fetchJson(path, init = {}) {
  const response = await fetch(`${API_BASE_URL}/${path}`, {
    ...init,
    signal: AbortSignal.timeout(15_000),
    headers: { "content-type": "application/json", ...init.headers },
  });
  if (!response.ok) throw new Error(`public_scan_http_${response.status}`);
  return response.json();
}

async function runSmoke() {
  const wwwResponse = await fetch("https://www.desarrolloseguro.org/", {
    redirect: "manual",
    signal: AbortSignal.timeout(15_000),
  });
  validateWwwRedirect(wwwResponse.status, wwwResponse.headers.get("location"));

  const initialStatus = await fetchJson(`domains/${VALIDATION_HOSTNAME}/status`);
  const previousReportId = initialStatus?.lastReport?.id ?? null;
  const admission = await fetchJson(
    `domains/${VALIDATION_HOSTNAME}/analysis-requests`,
    { method: "POST", body: JSON.stringify({ authorized: true }) },
  );
  if (["cached", "rate_limited"].includes(admission.state)) {
    const status = await fetchJson(`domains/${VALIDATION_HOSTNAME}/status`);
    const report = validateReusableAdmission(admission, status);
    process.stdout.write(
      `Live domain scan reused existing report (${admission.state}): ${report.checks.filter(({ status: value }) => value !== "unknown").length}/9 checks conclusive; score ${report.ethicsAssessment.score}/100.\n`,
    );
    return;
  }
  if (
    admission.hostname !== VALIDATION_HOSTNAME ||
    !["queued", "running"].includes(admission.state)
  ) {
    throw new Error("public_scan_admission_invalid");
  }
  const report = await waitForPublicScanReport({
    previousReportId,
    getStatus: () => fetchJson(`domains/${VALIDATION_HOSTNAME}/status`),
    onProgress: (message) => process.stdout.write(`${message}\n`),
  });
  process.stdout.write(
    `Live domain scan passed: ${report.checks.filter(({ status: value }) => value !== "unknown").length}/9 checks conclusive; score ${report.ethicsAssessment.score}/100.\n`,
  );
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  runSmoke().catch((error) => {
    const safeCode = error instanceof Error && /^[a-z0-9_]+$/u.test(error.message)
      ? error.message
      : "public_scan_smoke_failed";
    process.stderr.write(`${safeCode}\n`);
    process.exitCode = 1;
  });
}
