const API_ORIGIN = "https://desarrolloseguro.org";
const API_PATH = "/api/desarrollo-seguro/v1/badges/verify";
const STATUS_PATH = "/api/desarrollo-seguro/v1/domains";
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/u;
const REPORT_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
export const AUTHORIZED_BADGE_HOSTNAMES = new Set(["grumphya.com", "www.grumphya.com"]);
const REQUEST_TIMEOUT_MS = 10_000;

export async function verifyReportBadge(input, fetchImpl = fetch) {
  if (
    typeof input?.token !== "string" || !TOKEN_PATTERN.test(input.token) ||
    !AUTHORIZED_BADGE_HOSTNAMES.has(input.hostname)
  ) {
    return { verified: false, code: "hostname_not_authorized", hostname: safeDisplayValue(input?.hostname), reportId: safeDisplayValue(input?.reportId) };
  }

  try {
    const currentReportId = await resolveCurrentReportId(input.hostname, fetchImpl);
    if (!currentReportId) return { verified: false, code: "report_not_current", hostname: input.hostname, reportId: "No indicado" };
    const url = `${API_ORIGIN}${API_PATH}`;
    const response = await fetchWithTimeout(fetchImpl, url, {
      method: "POST",
      mode: "cors",
      credentials: "omit",
      cache: "no-store",
      redirect: "error",
      referrerPolicy: "no-referrer",
      headers: { Accept: "application/json", "Content-Type": "application/json" },
      body: JSON.stringify({ token: input.token, hostname: input.hostname, reportId: currentReportId }),
    });
    if (!response.ok) return { verified: false, code: "network_failure", hostname: input.hostname, reportId: currentReportId };
    const result = await response.json();
    const verified = isRecord(result) && result.verified === true &&
      AUTHORIZED_BADGE_HOSTNAMES.has(result.hostname) &&
      result.canonicalHostname === result.hostname && result.reportId === currentReportId;
    return verified
      ? { verified: true, hostname: result.hostname, reportId: result.reportId }
      : { verified: false, code: safeFailureCode(result), hostname: input.hostname, reportId: currentReportId };
  } catch {
    return { verified: false, code: "network_failure", hostname: input.hostname, reportId: "No indicado" };
  }
}

async function resolveCurrentReportId(hostname, fetchImpl) {
  const url = `${API_ORIGIN}${STATUS_PATH}/${encodeURIComponent(hostname)}/status`;
  const response = await fetchWithTimeout(fetchImpl, url, {
    method: "GET",
    mode: "cors",
    credentials: "omit",
    cache: "no-store",
    redirect: "error",
    referrerPolicy: "no-referrer",
    headers: { Accept: "application/json" },
  });
  if (!response.ok) throw new Error("badge_status_unavailable");
  const status = await response.json();
  const reportId = status?.lastReport?.certification?.certifiedReportId;
  return ["fresh", "updating"].includes(status?.state) && status?.lastReport?.certification?.state === "active" &&
    typeof reportId === "string" && REPORT_ID_PATTERN.test(reportId)
    ? reportId
    : null;
}

async function fetchWithTimeout(fetchImpl, url, options) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    return await fetchImpl(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

function safeFailureCode(result) {
  const codes = new Set([
    "hostname_not_authorized", "report_not_current", "badge_expired",
    "badge_revoked", "redirect_not_valid", "network_failure",
  ]);
  return isRecord(result) && codes.has(result.code) ? result.code : "report_not_current";
}

function safeDisplayValue(value) {
  return typeof value === "string" ? value.slice(0, 253) : "No indicado";
}

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
