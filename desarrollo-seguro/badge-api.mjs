const API_ORIGIN = "https://desarrolloseguro.org";
const API_PATH = "/api/desarrollo-seguro/v1/badges/verify";
const STATUS_PATH = "/api/desarrollo-seguro/v1/domains";
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/u;
const REPORT_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
export const AUTHORIZED_BADGE_HOSTNAMES = new Set(["grumphya.com", "www.grumphya.com"]);
const REQUEST_TIMEOUT_MS = 10_000;

export async function verifyReportBadge(input, fetchImpl = fetch, timeoutMs = REQUEST_TIMEOUT_MS) {
  if (
    typeof input?.token !== "string" || !TOKEN_PATTERN.test(input.token) ||
    !AUTHORIZED_BADGE_HOSTNAMES.has(input.hostname)
  ) {
    return { verified: false, code: "hostname_not_authorized", hostname: safeDisplayValue(input?.hostname), reportId: safeDisplayValue(input?.reportId) };
  }

  try {
    const currentReportId = await resolveCurrentReportId(input.hostname, fetchImpl, timeoutMs);
    if (!currentReportId) return { verified: false, code: "report_not_current", hostname: input.hostname, reportId: "No indicado" };
    const url = `${API_ORIGIN}${API_PATH}`;
    const result = await fetchJsonWithTimeout(fetchImpl, url, {
      method: "POST",
      mode: "cors",
      credentials: "omit",
      cache: "no-store",
      redirect: "error",
      referrerPolicy: "no-referrer",
      headers: { Accept: "application/json", "Content-Type": "application/json" },
      body: JSON.stringify({ token: input.token, hostname: input.hostname, reportId: currentReportId }),
    }, timeoutMs);
    if (!result.ok) return { verified: false, code: "network_failure", hostname: input.hostname, reportId: currentReportId };
    const body = result.body;
    const verified = isRecord(body) && body.verified === true &&
      AUTHORIZED_BADGE_HOSTNAMES.has(body.hostname) &&
      body.canonicalHostname === body.hostname && body.reportId === currentReportId;
    return verified
      ? { verified: true, hostname: body.hostname, reportId: body.reportId }
      : { verified: false, code: safeFailureCode(body), hostname: input.hostname, reportId: currentReportId };
  } catch {
    return { verified: false, code: "network_failure", hostname: input.hostname, reportId: "No indicado" };
  }
}

async function resolveCurrentReportId(hostname, fetchImpl, timeoutMs) {
  const url = `${API_ORIGIN}${STATUS_PATH}/${encodeURIComponent(hostname)}/status`;
  const result = await fetchJsonWithTimeout(fetchImpl, url, {
    method: "GET",
    mode: "cors",
    credentials: "omit",
    cache: "no-store",
    redirect: "error",
    referrerPolicy: "no-referrer",
    headers: { Accept: "application/json" },
  }, timeoutMs);
  if (!result.ok) throw new Error("badge_status_unavailable");
  const status = result.body;
  const reportId = status?.lastReport?.certification?.certifiedReportId;
  return ["fresh", "updating"].includes(status?.state) && status?.lastReport?.certification?.state === "active" &&
    typeof reportId === "string" && REPORT_ID_PATTERN.test(reportId)
    ? reportId
    : null;
}

async function fetchJsonWithTimeout(fetchImpl, url, options, timeoutMs) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(url, { ...options, signal: controller.signal });
    return { ok: response.ok, body: response.ok ? await response.json() : null };
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
