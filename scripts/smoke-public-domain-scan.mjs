import { setTimeout as delay } from "node:timers/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const API_BASE_URL = "https://desarrolloseguro.org/api/desarrollo-seguro/v1";
const VALIDATION_HOSTNAME = "grumphya.com";
const CANONICAL_DOMAIN = "desarrolloseguro.org";
const SCAN_TIMEOUT_MS = 4 * 60 * 1000;
const POLL_INTERVAL_MS = 5_000;

export function validateCompletedReport(status, previousReportId) {
  const report = status?.lastReport;
  if (!report || status.hostname !== VALIDATION_HOSTNAME) {
    throw new Error("public_scan_report_missing");
  }
  if (report.id === previousReportId) {
    throw new Error("public_scan_report_not_refreshed");
  }
  if (
    report.profileVersion !== "domain-v1" ||
    report.scannerVersion !== "domain-v1-network-adapter-1" ||
    !Array.isArray(report.checks) ||
    report.checks.length !== 6
  ) {
    throw new Error("public_scan_profile_or_coverage_invalid");
  }

  const conclusiveChecks = report.checks.filter(
    ({ status: checkStatus }) => checkStatus === "pass" || checkStatus === "fail",
  );
  if (conclusiveChecks.length < 4) {
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
  if (
    !assessment ||
    !Number.isInteger(assessment.score) ||
    assessment.score < 0 ||
    assessment.score > 100 ||
    assessment.assessedCriteria < 4 ||
    assessment.totalCriteria !== 8 ||
    assessment.criteria.find(({ id }) => id === "initial-cookie-risk")?.status ===
      "unknown"
  ) {
    throw new Error("public_scan_ethics_assessment_incomplete");
  }
  return report;
}

export function validateCanonicalRedirect(responseStatus, location) {
  if (![301, 302, 307, 308].includes(responseStatus) || typeof location !== "string") {
    throw new Error("development_security_com_redirect_missing");
  }
  let destination;
  try {
    destination = new URL(location, "https://desarrolloseguro.com/");
  } catch {
    throw new Error("development_security_com_redirect_invalid");
  }
  if (
    destination.protocol !== "https:" ||
    destination.hostname !== CANONICAL_DOMAIN ||
    destination.port !== "" ||
    destination.pathname !== "/desarrollo-seguro/"
  ) {
    throw new Error("development_security_com_redirect_bad_target");
  }
  return destination;
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
  const comResponse = await fetch("https://desarrolloseguro.com/", {
    redirect: "manual",
    signal: AbortSignal.timeout(15_000),
  });
  validateCanonicalRedirect(comResponse.status, comResponse.headers.get("location"));

  const initialStatus = await fetchJson(`domains/${VALIDATION_HOSTNAME}/status`);
  const previousReportId = initialStatus?.lastReport?.id ?? null;
  const admission = await fetchJson(
    `domains/${VALIDATION_HOSTNAME}/analysis-requests`,
    { method: "POST", body: JSON.stringify({ authorized: true }) },
  );
  if (
    admission.hostname !== VALIDATION_HOSTNAME ||
    !["queued", "running", "cached"].includes(admission.state)
  ) {
    throw new Error("public_scan_admission_invalid");
  }

  const deadline = Date.now() + SCAN_TIMEOUT_MS;
  while (Date.now() < deadline) {
    await delay(POLL_INTERVAL_MS);
    const status = await fetchJson(`domains/${VALIDATION_HOSTNAME}/status`);
    if (status.state === "updating") continue;
    if (!status.lastReport || status.lastReport.id === previousReportId) {
      continue;
    }
    const report = validateCompletedReport(status, previousReportId);
    process.stdout.write(
      `Live domain scan passed: ${report.checks.filter(({ status: value }) => value !== "unknown").length}/6 checks conclusive; score ${report.ethicsAssessment.score}/100.\n`,
    );
    return;
  }
  throw new Error("public_scan_completion_timeout");
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
