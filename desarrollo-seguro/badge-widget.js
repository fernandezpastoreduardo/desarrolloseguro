const API_ORIGIN = "https://desarrolloseguro.org";
const REPORT_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const AUTHORIZED_HOSTNAMES = new Set(["grumphya.com", "www.grumphya.com"]);
const FAILURE_MESSAGES = {
  hostname_not_authorized: "El hostname no está autorizado.",
  report_not_current: "El informe ya no es el certificado vigente.",
  badge_expired: "El sello ha caducado o no es válido.",
  badge_revoked: "El sello ha sido revocado.",
  redirect_not_valid: "No se ha validado la redirección permanente.",
  network_failure: "No se pudo completar la verificación.",
};

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
    reportId: widget.dataset.reportId,
  });
  if (!result.verified) {
    widget.textContent = FAILURE_MESSAGES[result.code] ?? "El sello no se ha podido verificar.";
    widget.dataset.state = "invalid";
    widget.dataset.diagnostic = result.code ?? "verification_failed";
    widget.hidden = false;
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
    AUTHORIZED_HOSTNAMES.has(input.hostname) && typeof input.reportId === "string" && REPORT_ID_PATTERN.test(input.reportId);
  if (!validInput) return { verified: false, code: "hostname_not_authorized" };
  const endpoint = `${API_ORIGIN}/api/desarrollo-seguro/v1/badges/verify`;
  try {
    const response = await fetch(endpoint, {
      method: "POST",
      mode: "cors",
      credentials: "omit",
      cache: "no-store",
      redirect: "error",
      referrerPolicy: "no-referrer",
      headers: { Accept: "application/json", "Content-Type": "application/json" },
      body: JSON.stringify({ token: input.token, hostname: input.hostname, reportId: input.reportId }),
    });
    if (!response.ok) return { verified: false, code: "network_failure" };
    const result = await response.json();
    const verified = isRecord(result) && result.verified === true &&
      AUTHORIZED_HOSTNAMES.has(result.hostname) &&
      result.canonicalHostname === result.hostname && result.reportId === input.reportId;
    if (verified) return { verified: true, hostname: result.hostname, reportId: result.reportId };
    const codes = new Set(Object.keys(FAILURE_MESSAGES));
    return { verified: false, code: isRecord(result) && codes.has(result.code) ? result.code : "report_not_current" };
  } catch {
    return { verified: false, code: "network_failure" };
  }
}

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
