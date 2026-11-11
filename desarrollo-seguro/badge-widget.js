const API_ORIGIN = "https://desarrolloseguro.org";
const REPORT_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

const widgets = document.querySelectorAll("[data-ds-verified-badge]");

for (const widget of widgets) {
  void initializeBadge(widget);
}

async function initializeBadge(widget) {
  if (!(widget instanceof HTMLAnchorElement)) return;
  widget.hidden = true;
  const result = await verifyBadge({
    token: widget.dataset.token,
    hostname: widget.dataset.hostname,
    reportId: widget.dataset.reportId,
  });
  if (!result.verified) {
    widget.textContent = "Sello no verificado";
    widget.dataset.state = "invalid";
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
    input.hostname === "grumphya.com" && typeof input.reportId === "string" && REPORT_ID_PATTERN.test(input.reportId);
  if (!validInput) return { verified: false };
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
    if (!response.ok) return { verified: false };
    const result = await response.json();
    return {
      verified: isRecord(result) && result.verified === true &&
        result.hostname === input.hostname && result.reportId === input.reportId,
      hostname: input.hostname,
      reportId: input.reportId,
    };
  } catch {
    return { verified: false };
  }
}

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
