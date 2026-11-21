import { verifyReportBadge } from "./badge-api.mjs";

async function renderVerification() {
  const params = new URLSearchParams(window.location.hash.slice(1));
  const result = await verifyReportBadge({
    token: params.get("token"),
    hostname: params.get("hostname"),
    reportId: params.get("reportId"),
  });
  const status = document.getElementById("verification-result");
  const hostname = document.getElementById("verification-hostname");
  const reportId = document.getElementById("verification-report-id");
  const reportLink = document.getElementById("verification-report-link");
  if (!status || !hostname || !reportId || !reportLink) return;

  hostname.textContent = result.hostname;
  reportId.textContent = result.reportId;
  if (!result.verified) {
    status.textContent = verificationFailureMessage(result.code);
    status.dataset.diagnostic = result.code ?? "verification_failed";
    status.dataset.state = "invalid";
    reportLink.hidden = true;
    return;
  }

  status.textContent = "Sello verificado";
  status.dataset.state = "valid";
  reportLink.href = `/app/?report=${encodeURIComponent(result.reportId)}`;
  reportLink.hidden = false;
}

function verificationFailureMessage(code) {
  const messages = {
    hostname_not_authorized: "El hostname o el origen no está autorizado.",
    report_not_current: "El informe ya no es el certificado vigente.",
    badge_expired: "El sello ha caducado o no es válido.",
    badge_revoked: "El sello ha sido revocado.",
    redirect_not_valid: "No se ha validado la redirección permanente.",
    network_failure: "No se pudo completar la verificación.",
  };
  return messages[code] ?? "El sello no se ha podido verificar.";
}

if (typeof window !== "undefined" && typeof document !== "undefined") {
  void renderVerification();
}
