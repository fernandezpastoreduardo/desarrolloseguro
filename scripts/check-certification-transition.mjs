import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const CERTIFICATION_API_URL =
  "https://desarrolloseguro.org/api/desarrollo-seguro/v1/domains/grumphya.com/status";

const CERTIFICATION_STATES = new Set(["pending", "active", "suspended"]);
const ASSESSMENT_STATUSES = new Set(["pending", "eligible", "blocked"]);
const BETA_CATEGORY_IDS = new Set([
  "transport-security",
  "security-headers",
  "privacy-cookies",
]);

export function validateCertificationTransition(status, previousReportId = null) {
  if (!status || status.hostname !== "grumphya.com") {
    throw new Error("certification_hostname_invalid");
  }
  const report = readRecord(status.lastReport);
  const certification = readRecord(report?.certification);
  if (!report || typeof report.id !== "string") {
    throw new Error("certification_report_missing");
  }
  if (!isEligibleBetaAssessment(report.betaCertification)) {
    throw new Error("certification_assessment_inconsistent");
  }
  if (previousReportId !== null && report.id === previousReportId) {
    throw new Error("certification_report_not_refreshed");
  }
  if (!certification || certification.state !== "active") {
    throw new Error("certification_transition_not_ready");
  }
  if (
    certification.latestAssessmentStatus !== "eligible" ||
    certification.certifiedReportId !== report.id ||
    !Number.isInteger(certification.score) ||
    certification.score < 0 ||
    certification.score > 100
  ) {
    throw new Error("certification_transition_inconsistent");
  }
  return { reportId: report.id, score: certification.score };
}

function isEligibleBetaAssessment(value) {
  const assessment = readRecord(value);
  if (
    !assessment ||
    assessment.policyVersion !== "beta-0.1" ||
    assessment.threshold !== 90 ||
    assessment.eligibility !== "eligible" ||
    assessment.assessedCategories !== 3 ||
    assessment.totalCategories !== 3 ||
    !Number.isInteger(assessment.score) ||
    assessment.score < 90 ||
    assessment.score > 100 ||
    !Array.isArray(assessment.categories) ||
    assessment.categories.length !== BETA_CATEGORY_IDS.size
  ) {
    return false;
  }

  const categoryIds = new Set();
  for (const category of assessment.categories) {
    const record = readRecord(category);
    if (
      !record ||
      typeof record.id !== "string" ||
      !BETA_CATEGORY_IDS.has(record.id) ||
      categoryIds.has(record.id) ||
      record.status !== "pass"
    ) {
      return false;
    }
    categoryIds.add(record.id);
  }
  return categoryIds.size === BETA_CATEGORY_IDS.size;
}

/**
 * Formats only allowlisted, categorical state for an operator.
 * It deliberately omits host data, report contents and arbitrary API strings.
 */
export function describeCertificationTransition(status, previousReportId = null) {
  if (typeof status !== "object" || status === null || Array.isArray(status)) {
    return "status=invalid";
  }
  const report = readRecord(status.lastReport);
  const certification = readRecord(report?.certification);
  const reportPresent = typeof report?.id === "string";
  const state = readKnownValue(certification?.state, CERTIFICATION_STATES);
  const assessment = readKnownValue(certification?.latestAssessmentStatus, ASSESSMENT_STATUSES);
  const certifiedReport = describeCertifiedReport(certification?.certifiedReportId, report?.id);
  const refreshed = describeRefresh(reportPresent, report?.id, previousReportId);
  return `report=${reportPresent ? "present" : "missing"} certification_state=${state} assessment=${assessment} certified_report=${certifiedReport} report_refreshed=${refreshed}`;
}

function readRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value : null;
}

function readKnownValue(value, allowedValues) {
  if (value === undefined || value === null) return "missing";
  return typeof value === "string" && allowedValues.has(value) ? value : "invalid";
}

function describeCertifiedReport(certifiedReportId, reportId) {
  if (typeof certifiedReportId !== "string") return "none";
  return certifiedReportId === reportId ? "matches" : "different";
}

function describeRefresh(reportPresent, reportId, previousReportId) {
  if (!reportPresent || previousReportId === null) return "unknown";
  return reportId === previousReportId ? "no" : "yes";
}

async function readStatus() {
  const response = await fetch(CERTIFICATION_API_URL, {
    method: "GET",
    redirect: "error",
    cache: "no-store",
    headers: { accept: "application/json" },
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw new Error(`certification_status_http_${response.status}`);
  const contentType = response.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase();
  if (contentType !== "application/json") throw new Error("certification_status_not_json");
  return response.json();
}

async function run() {
  const status = await readStatus();
  try {
    const result = validateCertificationTransition(status);
    process.stdout.write(`Certification transition passed: score ${result.score}/100.\n`);
  } catch (error) {
    const code = error instanceof Error && /^[a-z0-9_]+$/u.test(error.message)
      ? error.message
      : "certification_transition_preflight_failed";
    process.stderr.write(`${code} ${describeCertificationTransition(status)}\n`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  run().catch((error) => {
    const code = error instanceof Error && /^[a-z0-9_]+$/u.test(error.message)
      ? error.message
      : "certification_transition_preflight_failed";
    process.stderr.write(`${code}\n`);
    process.exitCode = 1;
  });
}
