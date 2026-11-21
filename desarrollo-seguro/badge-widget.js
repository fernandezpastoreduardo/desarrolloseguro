const API_ORIGIN = "https://desarrolloseguro.org";
const STATUS_PATH = "/api/desarrollo-seguro/v1/domains";
const REPORT_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const AUTHORIZED_HOSTNAMES = new Set(["grumphya.com", "www.grumphya.com"]);

const widgets = document.querySelectorAll("[data-ds-verified-badge]");

for (const widget of widgets) {
  void initializeBadge(widget);
}

async function initializeBadge(widget) {
  if (!(widget instanceof HTMLAnchorElement)) return;
  widget.hidden = true;
  widget.setAttribute("role", "status");
  widget.setAttribute("aria-live", "polite");
  const result = await verifyBadge({
    token: widget.dataset.token,
    hostname: widget.dataset.hostname,
  });
  if (!result.verified) {
    widget.textContent = "";
    widget.dataset.state = "invalid";
    widget.dataset.diagnostic = result.code ?? "verification_failed";
    widget.hidden = true;
    return;
  }

  const query = new URLSearchParams({
    token: widget.dataset.token,
    hostname: result.hostname,
    reportId: result.reportId,
  });
  widget.href = `https://desarrolloseguro.org/desarrollo-seguro/verificar.html#${query.toString()}`;
  widget.textContent = `Informe verificado · ${result.hostname}`;
  widget.dataset.state = "valid";
  widget.hidden = false;
}

async function verifyBadge(input) {
  const validInput = typeof input.token === "string" && /^[A-Za-z0-9_-]{43}$/u.test(input.token) &&
    AUTHORIZED_HOSTNAMES.has(input.hostname);
  if (!validInput) return { verified: false, code: "hostname_not_authorized" };
  try {
    const reportId = await resolveCurrentReportId(input.hostname);
    if (!reportId) return { verified: false, code: "report_not_current" };
    const endpoint = `${API_ORIGIN}/api/desarrollo-seguro/v1/badges/verify`;
    const response = await fetch(endpoint, {
      method: "POST",
      mode: "cors",
      credentials: "omit",
      cache: "no-store",
      redirect: "error",
      referrerPolicy: "no-referrer",
      headers: { Accept: "application/json", "Content-Type": "application/json" },
      body: JSON.stringify({ token: input.token, hostname: input.hostname, reportId }),
    });
    if (!response.ok) return { verified: false, code: "network_failure" };
    const result = await response.json();
    const verified = isRecord(result) && result.verified === true &&
      AUTHORIZED_HOSTNAMES.has(result.hostname) &&
      result.canonicalHostname === result.hostname && result.reportId === reportId;
    if (verified) return { verified: true, hostname: result.hostname, reportId: result.reportId };
    const codes = new Set([
      "hostname_not_authorized", "report_not_current", "badge_expired",
      "badge_revoked", "redirect_not_valid", "network_failure",
    ]);
    return { verified: false, code: isRecord(result) && codes.has(result.code) ? result.code : "report_not_current" };
  } catch {
    return { verified: false, code: "network_failure" };
  }
}

async function resolveCurrentReportId(hostname) {
  const response = await fetch(`${API_ORIGIN}${STATUS_PATH}/${encodeURIComponent(hostname)}/status`, {
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
  const certification = status?.lastReport?.certification;
  return ["fresh", "updating"].includes(status?.state) && certification?.state === "active" &&
    typeof certification.certifiedReportId === "string" &&
    REPORT_ID_PATTERN.test(certification.certifiedReportId)
    ? certification.certifiedReportId
    : null;
}

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
