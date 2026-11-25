import { isThirdPartyPrivacyHost } from "@desarrolloseguro/core";
import type { ScanCheck } from "@desarrolloseguro/persistence";
import { PRIVACY_KNOWLEDGE_RULES } from "./privacy-knowledge-catalog.js";
import { matchPrivacySignal } from "./privacy-knowledge-base.js";
import type { PrivacyBrowserObservation } from "./privacy-browser-observer.js";

const TRACKING_CATEGORIES = new Set(["analytics", "advertising", "social"]);

/** Projects bounded browser observations into public cookie and tracker controls. */
export function mergePrivacyBrowserChecks(
  checks: readonly ScanCheck[],
  observation: PrivacyBrowserObservation,
): ScanCheck[] {
  const flow = observation.initial;
  const snapshot = flow.phaseEvidence.beforeChoice;
  const beforeChoiceRequests = flow.phaseEvidence.networkRequests.filter((request) =>
    request !== null && typeof request === "object" && request.phaseAtStart === "before_choice");
  const hosts = [...new Set(beforeChoiceRequests.map(({ hostname }) => hostname))];
  const thirdPartyRequests = beforeChoiceRequests.filter(({ hostname }) =>
    isThirdPartyPrivacyHost(observation.hostname, hostname));
  const trackingRequests = thirdPartyRequests.filter(({ hostname }) =>
    matchPrivacySignal({ signalType: "request_host", value: hostname, observedHostname: hostname }, PRIVACY_KNOWLEDGE_RULES)
      .some(({ classification, category }) => classification === "confirmed" && TRACKING_CATEGORIES.has(category)));
  const cookieReadComplete = flow.status === "evaluated" && snapshot?.cookieReadComplete === true;
  const networkReadComplete = flow.status === "evaluated" && flow.phaseEvidence.networkRequestsComplete;
  const cookies = cookieReadComplete ? snapshot.cookies : [];
  const catalogMatchCount = cookies.filter((cookie) =>
    matchPrivacySignal({
      signalType: "cookie_name",
      value: cookie.name,
      observedHostname: cookie.domain,
      corroboratingHostnames: hosts,
    }, PRIVACY_KNOWLEDGE_RULES).some(({ classification }) => classification === "confirmed")).length;
  const browserCookieEvidence: Record<string, boolean | number> = {
    browserObservationComplete: cookieReadComplete,
    browserCookieCount: cookies.length,
    browserInsecureCookieCount: cookies.filter(({ secure }) => !secure).length,
    browserCatalogMatchCount: catalogMatchCount,
  };
  const browserTrackingEvidence: Record<string, boolean | number> = {
    browserObservationComplete: networkReadComplete,
    browserThirdPartyRequestCount: thirdPartyRequests.length,
    browserKnownTrackingRequestCount: trackingRequests.length,
    browserBlockedTrackingRequestCount: trackingRequests.filter(({ blockedByAudit }) => blockedByAudit).length,
    browserTrackingResponseCount: trackingRequests.filter(({ responseStatus }) => responseStatus !== null).length,
  };

  return checks.map((check) => {
    if (check.controlId === "DS-PRIV-05") {
      const inspected = cookieReadComplete;
      return {
        ...check,
        status: !inspected ? "unknown" : catalogMatchCount > 0 ? "fail" : "pass",
        summary: "",
        limitation: "Cookies observadas en Chromium antes de elegir; la relación con un servicio requiere coincidencia con el catálogo local y una solicitud del mismo flujo.",
        evidence: { ...check.evidence, ...browserCookieEvidence, inspected },
      };
    }
    if (check.controlId === "DS-PRIV-06") {
      const inspected = networkReadComplete;
      return {
        ...check,
        status: trackingRequests.length > 0 ? "fail" : !inspected ? "unknown" : "pass",
        summary: "",
        limitation: "Una solicitud iniciada demuestra un intento. Las bloqueadas por el auditor no prueban que se transmitieran datos; el detalle separa intentos bloqueados y respuestas recibidas.",
        evidence: { ...check.evidence, ...browserTrackingEvidence, inspected },
      };
    }
    return check;
  });
}
