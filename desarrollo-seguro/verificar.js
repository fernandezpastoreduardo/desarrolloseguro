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
    status.textContent = "Sello no verificado";
    status.dataset.state = "invalid";
    reportLink.hidden = true;
    return;
  }

  status.textContent = "Sello verificado";
  status.dataset.state = "valid";
  reportLink.href = `/app/?report=${encodeURIComponent(result.reportId)}`;
  reportLink.hidden = false;
}

if (typeof window !== "undefined" && typeof document !== "undefined") {
  void renderVerification();
}
