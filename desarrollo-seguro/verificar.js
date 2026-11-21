import { verifyReportBadge } from "./badge-api.mjs";

const REPORT_API_PATH = "/api/desarrollo-seguro/v1/reports";
const REPORT_REQUEST_TIMEOUT_MS = 10_000;
const VERIFICATION_FAILURE_MESSAGES = {
  hostname_not_authorized: "El dominio o el origen no está autorizado para este sello.",
  report_not_current: "El sello ya no corresponde al informe certificado vigente.",
  badge_expired: "El sello ha caducado o no es válido.",
  badge_revoked: "El sello ha sido revocado.",
  redirect_not_valid: "No se ha podido confirmar la identidad canónica del dominio.",
  network_failure: "No se pudo completar la comprobación con el servidor. El sello no se considera válido.",
};

async function renderVerification() {
  const params = new URLSearchParams(window.location.hash.slice(1));
  const input = {
    token: params.get("token"),
    hostname: params.get("hostname"),
    reportId: params.get("reportId"),
  };
  window.history.replaceState(null, "", `${window.location.pathname}${window.location.search}`);

  const panel = document.getElementById("verification-panel");
  const status = document.getElementById("verification-result");
  const message = document.getElementById("verification-message");
  const mark = document.getElementById("verification-mark");
  const summary = document.getElementById("verification-report-summary");
  const reportLink = document.getElementById("verification-report-link");
  if (!panel || !status || !message || !mark || !summary || !reportLink) return;

  const result = await verifyReportBadge(input);
  setText("verification-hostname", result.hostname);
  setText("verification-report-id", result.reportId);
  if (!result.verified) {
    panel.dataset.state = "invalid";
    status.textContent = "Sello no verificado";
    status.dataset.state = "invalid";
    message.textContent = VERIFICATION_FAILURE_MESSAGES[result.code] ?? "No se pudo confirmar la autenticidad del sello.";
    mark.textContent = "×";
    reportLink.hidden = true;
    summary.hidden = true;
    return;
  }

  panel.dataset.state = "valid";
  status.textContent = "Sello auténtico y vigente";
  status.dataset.state = "valid";
  message.textContent = "Desarrollo Seguro ha confirmado ahora que el token es válido, no está revocado y corresponde al informe certificado vigente.";
  mark.textContent = "✓";
  summary.hidden = false;
  reportLink.href = `/app/?report=${encodeURIComponent(result.reportId)}`;
  reportLink.hidden = false;

  try {
    const report = await fetchPublicReport(result.reportId);
    if (report.id !== result.reportId || report.hostname !== result.hostname) {
      throw new Error("public_report_identity_mismatch");
    }
    renderPublicReport(report);
  } catch {
    showSummaryMessage("El sello está verificado, pero ahora no se pudo cargar el resumen del informe. Puedes abrir el informe completo.");
  }
}

async function fetchPublicReport(reportId) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REPORT_REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(`${REPORT_API_PATH}/${encodeURIComponent(reportId)}`, {
      method: "GET",
      credentials: "omit",
      cache: "no-store",
      redirect: "error",
      referrerPolicy: "no-referrer",
      headers: { Accept: "application/json" },
      signal: controller.signal,
    });
    if (!response.ok) throw new Error("public_report_unavailable");
    return await response.json();
  } finally {
    clearTimeout(timeout);
  }
}

function renderPublicReport(report) {
  setText("verification-hostname", report.hostname);
  setText("verification-report-id", report.id);
  setText("verification-verdict", verdictLabel(report.verdict));
  setText("verification-certification", certificationLabel(report.certification?.state));
  setText("verification-completed-at", formatDate(report.completedAt));
  setText("verification-scope", formatScope(report.scope));
  setText("verification-expires-at", formatDate(report.expiresAt));

  const score = report.betaCertification?.score;
  setText("verification-score", Number.isFinite(score) ? `${score}/100` : "No disponible");
  renderCategories(report.betaCertification?.categories);
  hideSummaryMessage();
}

function renderCategories(categories) {
  const list = document.getElementById("verification-categories");
  if (!list) return;
  list.replaceChildren();
  if (!Array.isArray(categories) || categories.length === 0) {
    showSummaryMessage("El informe no incluye categorías beta evaluadas.");
    return;
  }

  for (const category of categories) {
    if (!isRecord(category)) continue;
    const item = document.createElement("li");
    item.className = "verification-category";
    const name = document.createElement("strong");
    name.textContent = safeText(category.label, "Categoría evaluada");
    const state = document.createElement("span");
    state.textContent = categoryStatusLabel(category.status);
    item.append(name, state);
    list.append(item);
  }
}

function setText(id, value) {
  const element = document.getElementById(id);
  if (element) element.textContent = safeText(value, "No disponible");
}

function showSummaryMessage(value) {
  const message = document.getElementById("verification-summary-message");
  if (!message) return;
  message.textContent = value;
  message.hidden = false;
}

function hideSummaryMessage() {
  const message = document.getElementById("verification-summary-message");
  if (!message) return;
  message.textContent = "";
  message.hidden = true;
}

function verdictLabel(value) {
  if (value === "pass") return "Aprobado";
  if (value === "fail" || value === "blocked") return "No aprobado";
  return "Sin resultado concluyente";
}

function certificationLabel(value) {
  if (value === "active") return "Activa · beta";
  if (value === "suspended") return "Suspendida";
  if (value === "pending") return "Pendiente";
  return "No disponible";
}

function categoryStatusLabel(value) {
  if (value === "pass") return "Conforme";
  if (value === "partial") return "Parcial";
  if (value === "fail" || value === "blocked") return "No conforme";
  return "Sin conclusión";
}

function formatScope(value) {
  return Array.isArray(value) && value.length > 0 ? value.map((item) => safeText(item, "")).filter(Boolean).join(", ") : "No indicado";
}

function formatDate(value) {
  if (typeof value !== "string") return "No disponible";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "No disponible";
  return `${new Intl.DateTimeFormat("es-ES", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "UTC",
  }).format(date)} UTC`;
}

function safeText(value, fallback) {
  return typeof value === "string" && value.trim() ? value.slice(0, 600) : fallback;
}

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

if (typeof window !== "undefined" && typeof document !== "undefined") {
  void renderVerification();
}
