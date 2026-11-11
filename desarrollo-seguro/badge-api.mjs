const API_ORIGIN = "https://desarrolloseguro.org";
const API_PATH = "/api/desarrollo-seguro/v1/badges/verify";
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/u;
const REPORT_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
export const AUTHORIZED_BADGE_HOSTNAME = "grumphya.com";

export async function verifyReportBadge(input, fetchImpl = fetch) {
  if (
    typeof input?.token !== "string" || !TOKEN_PATTERN.test(input.token) ||
    input.hostname !== AUTHORIZED_BADGE_HOSTNAME ||
    typeof input.reportId !== "string" || !REPORT_ID_PATTERN.test(input.reportId)
  ) {
    return { verified: false, hostname: safeDisplayValue(input?.hostname), reportId: safeDisplayValue(input?.reportId) };
  }

  const url = `${API_ORIGIN}${API_PATH}`;
  try {
    const response = await fetchImpl(url, {
      method: "POST",
      mode: "cors",
      credentials: "omit",
      cache: "no-store",
      redirect: "error",
      referrerPolicy: "no-referrer",
      headers: { Accept: "application/json", "Content-Type": "application/json" },
      body: JSON.stringify({ token: input.token, hostname: input.hostname, reportId: input.reportId }),
    });
    if (!response.ok) return { verified: false, hostname: input.hostname, reportId: input.reportId };
    const result = await response.json();
    const verified = isRecord(result) && result.verified === true &&
      result.hostname === input.hostname && result.reportId === input.reportId;
    return { verified, hostname: input.hostname, reportId: input.reportId };
  } catch {
    return { verified: false, hostname: input.hostname, reportId: input.reportId };
  }
}

function safeDisplayValue(value) {
  return typeof value === "string" ? value.slice(0, 253) : "No indicado";
}

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
