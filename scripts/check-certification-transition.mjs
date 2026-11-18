import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const CERTIFICATION_API_URL =
  "https://desarrolloseguro.org/api/desarrollo-seguro/v1/domains/grumphya.com/status";

export function validateCertificationTransition(status, previousReportId = null) {
  if (!status || status.hostname !== "grumphya.com") {
    throw new Error("certification_hostname_invalid");
  }
  const report = status.lastReport;
  const certification = status.certification;
  if (!report || typeof report.id !== "string") {
    throw new Error("certification_report_missing");
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
  const result = validateCertificationTransition(await readStatus());
  process.stdout.write(`Certification transition passed: score ${result.score}/100.\n`);
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
