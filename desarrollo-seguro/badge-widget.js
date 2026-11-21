const API_ORIGIN = "https://desarrolloseguro.org";
const STATUS_PATH = "/api/desarrollo-seguro/v1/domains";
const REPORT_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const AUTHORIZED_HOSTNAMES = new Set(["grumphya.com", "www.grumphya.com"]);
const BADGE_WIDGET_STYLES = "__DS_BADGE_WIDGET_STYLES__";
const BADGE_WIDGET_LOGO_SVG = "__DS_BADGE_WIDGET_LOGO_SVG__";
const BADGE_REQUEST_TIMEOUT_MS = 10_000;

const widgets = document.querySelectorAll("[data-ds-verified-badge]");
installWidgetStyles();

for (const widget of widgets) {
  void initializeBadge(widget);
}

function installWidgetStyles() {
  if (BADGE_WIDGET_STYLES === "__DS_BADGE_WIDGET_STYLES__" || document.querySelector("style[data-ds-badge-widget]")) return;
  const style = document.createElement("style");
  style.dataset.dsBadgeWidget = "";
  style.textContent = BADGE_WIDGET_STYLES;
  document.head.append(style);
}

async function initializeBadge(widget) {
  if (!(widget instanceof HTMLAnchorElement)) return;
  widget.hidden = true;
  widget.replaceChildren();
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
  widget.append(createBrandLogo(), createBadgeCopy(result.hostname), createApprovalMark());
  widget.setAttribute("aria-label", `Sello aprobado de Desarrollo Seguro para ${result.hostname}. Abrir la verificación y el informe.`);
  widget.classList.add("ds-verified-badge");
  widget.dataset.state = "valid";
  widget.hidden = false;
}

function createBrandLogo() {
  const logo = document.createElement("img");
  logo.className = "ds-verified-badge__logo";
  logo.alt = "Logotipo de Desarrollo Seguro";
  const logoUrl = URL.createObjectURL(new Blob([BADGE_WIDGET_LOGO_SVG], { type: "image/svg+xml" }));
  logo.src = logoUrl;
  const releaseLogo = () => URL.revokeObjectURL(logoUrl);
  logo.addEventListener("load", releaseLogo, { once: true });
  logo.addEventListener("error", releaseLogo, { once: true });
  return logo;
}

function createBadgeCopy(hostname) {
  const copy = document.createElement("span");
  copy.className = "ds-verified-badge__copy";
  const title = document.createElement("strong");
  title.className = "ds-verified-badge__title";
  title.textContent = "Sello aprobado";
  const domain = document.createElement("span");
  domain.className = "ds-verified-badge__domain";
  domain.textContent = `Beta activa · ${hostname}`;
  copy.append(title, domain);
  return copy;
}

function createApprovalMark() {
  const mark = document.createElement("span");
  mark.className = "ds-verified-badge__check";
  mark.setAttribute("aria-hidden", "true");
  mark.textContent = "✓";
  return mark;
}

async function verifyBadge(input) {
  const validInput = typeof input.token === "string" && /^[A-Za-z0-9_-]{43}$/u.test(input.token) &&
    AUTHORIZED_HOSTNAMES.has(input.hostname);
  if (!validInput) return { verified: false, code: "hostname_not_authorized" };
  try {
    const reportId = await resolveCurrentReportId(input.hostname);
    if (!reportId) return { verified: false, code: "report_not_current" };
    const endpoint = `${API_ORIGIN}/api/desarrollo-seguro/v1/badges/verify`;
    const result = await fetchJsonWithTimeout(endpoint, {
      method: "POST",
      mode: "cors",
      credentials: "omit",
      cache: "no-store",
      redirect: "error",
      referrerPolicy: "no-referrer",
      headers: { Accept: "application/json", "Content-Type": "application/json" },
      body: JSON.stringify({ token: input.token, hostname: input.hostname, reportId }),
    });
    if (!result.ok) return { verified: false, code: "network_failure" };
    const body = result.body;
    const verified = isRecord(body) && body.verified === true &&
      AUTHORIZED_HOSTNAMES.has(body.hostname) &&
      body.canonicalHostname === body.hostname && body.reportId === reportId;
    if (verified) return { verified: true, hostname: body.hostname, reportId: body.reportId };
    const codes = new Set([
      "hostname_not_authorized", "report_not_current", "badge_expired",
      "badge_revoked", "redirect_not_valid", "network_failure",
    ]);
    return { verified: false, code: isRecord(body) && codes.has(body.code) ? body.code : "report_not_current" };
  } catch {
    return { verified: false, code: "network_failure" };
  }
}

async function resolveCurrentReportId(hostname) {
  const result = await fetchJsonWithTimeout(`${API_ORIGIN}${STATUS_PATH}/${encodeURIComponent(hostname)}/status`, {
    method: "GET",
    mode: "cors",
    credentials: "omit",
    cache: "no-store",
    redirect: "error",
    referrerPolicy: "no-referrer",
    headers: { Accept: "application/json" },
  });
  if (!result.ok) throw new Error("badge_status_unavailable");
  const status = result.body;
  const certification = status?.lastReport?.certification;
  return ["fresh", "updating"].includes(status?.state) && certification?.state === "active" &&
    typeof certification.certifiedReportId === "string" &&
    REPORT_ID_PATTERN.test(certification.certifiedReportId)
    ? certification.certifiedReportId
    : null;
}

async function fetchJsonWithTimeout(url, options) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), BADGE_REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(url, { ...options, signal: controller.signal });
    return { ok: response.ok, body: response.ok ? await response.json() : null };
  } finally {
    clearTimeout(timeout);
  }
}

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
