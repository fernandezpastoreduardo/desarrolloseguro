import { readFile, stat } from "node:fs/promises";
import { pathToFileURL } from "node:url";

const BADGE_ISSUER_SECRET_PATH =
  "/opt/desarrollo-seguro/secrets/development_security_badge_issuer_token";
const BADGE_API_URL =
  "https://desarrolloseguro.org/api/desarrollo-seguro/v1/badges";
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const BADGE_TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/u;

export async function issueReportBadge(reportId, issuerToken, fetchImpl = fetch) {
  if (!UUID_PATTERN.test(reportId) || typeof issuerToken !== "string" || issuerToken.length < 32) {
    throw new Error("invalid_report_badge_issue_input");
  }
  const response = await fetchImpl(BADGE_API_URL, {
    method: "POST",
    headers: {
      Accept: "application/json",
      Authorization: `Bearer ${issuerToken}`,
      "Content-Type": "application/json",
    },
    credentials: "omit",
    cache: "no-store",
    redirect: "error",
    body: JSON.stringify({ hostname: "grumphya.com", reportId }),
  });
  if (!response.ok) throw new Error(`report_badge_issue_failed_${response.status}`);
  const payload = await response.json();
  if (!isIssuedBadge(payload, reportId)) throw new Error("invalid_report_badge_issue_response");
  return payload;
}

async function main() {
  const reportId = process.argv[2];
  if (typeof reportId !== "string" || !UUID_PATTERN.test(reportId)) {
    throw new Error("usage: node scripts/issue-report-badge.mjs <real-report-uuid>");
  }
  const fileStats = await stat(BADGE_ISSUER_SECRET_PATH);
  if (!fileStats.isFile() || fileStats.uid !== 0 || (fileStats.mode & 0o077) !== 0) {
    throw new Error("report_badge_issuer_secret_permissions_invalid");
  }
  const issuerToken = (await readFile(BADGE_ISSUER_SECRET_PATH, "utf8")).trim();
  const badge = await issueReportBadge(reportId, issuerToken);
  process.stdout.write(`${JSON.stringify(badge, null, 2)}\n`);
}

function isIssuedBadge(value, reportId) {
  if (!isRecord(value)) return false;
  let verifyUrl;
  try {
    verifyUrl = new URL(value.verifyUrl);
  } catch {
    return false;
  }
  return value.hostname === "grumphya.com" && value.reportId === reportId &&
    typeof value.token === "string" && BADGE_TOKEN_PATTERN.test(value.token) &&
    verifyUrl.origin === "https://desarrolloseguro.org" &&
    verifyUrl.pathname === "/desarrollo-seguro/verificar.html" &&
    verifyUrl.hash.includes(value.token) && typeof value.expiresAt === "string";
}

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    const code = error instanceof Error && /^[a-z][a-z0-9_]*$/u.test(error.message)
      ? error.message
      : "report_badge_issue_failed";
    process.stderr.write(`${code}\n`);
    process.exitCode = 1;
  });
}
