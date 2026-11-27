import { isThirdPartyPrivacyHost } from "@desarrolloseguro/core";
import type { ScanCheck } from "@desarrolloseguro/persistence";
import { PRIVACY_KNOWLEDGE_RULES } from "./privacy-knowledge-catalog.js";
import { matchPrivacySignal } from "./privacy-knowledge-base.js";
import type { PrivacyBrowserObservation } from "./privacy-browser-observer.js";

const TRACKING_CATEGORIES = new Set(["analytics", "advertising", "social", "heatmap"]);
const PERFORMANCE_DIAGNOSTIC_FIELDS = [
  "fcpMs", "speedIndexMs", "lcpMs", "cls", "tbtMs", "ttfbMs", "transferBytes", "score",
] as const;

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
  // Each evidence source has its own coverage. A failed storage snapshot must
  // not erase a complete cookie inventory or a complete request timeline.
  const cookieReadComplete = flow.pageLoaded && snapshot?.cookieReadComplete === true;
  const networkReadComplete = flow.pageLoaded && snapshot !== null && flow.phaseEvidence.networkRequestsComplete;
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
    if (check.controlId === "DS-QUAL-02" && observation.performance) {
      const profileEvidence = Object.fromEntries(observation.performance.profiles.flatMap((profile) => {
        const prefix = profile.profile;
        const metricEvidence = profile.status === "complete" ? [
          [`${prefix}FcpMs`, profile.fcpMs], ...(prefix === "mobile" ? [["mobileSpeedIndexMs", profile.speedIndexMs] as const] : []),
          [`${prefix}LcpMs`, profile.lcpMs],
          [`${prefix}ClsMilli`, profile.cls === null ? null : Math.round(profile.cls * 1_000)],
          [`${prefix}TbtMs`, profile.tbtMs], [`${prefix}TtfbMs`, profile.ttfbMs],
          [`${prefix}TransferBytes`, profile.transferBytes], [`${prefix}Score`, profile.score],
        ].filter(([, value]) => typeof value === "number") as Array<[string, number | string]> : [];
        if (!profile.diagnostic) return metricEvidence;
        const missingMask = (profile.diagnostic.missingMetrics ?? []).reduce((mask, field) => {
          const index = PERFORMANCE_DIAGNOSTIC_FIELDS.indexOf(field);
          return index < 0 ? mask : mask | (1 << index);
        }, 0);
        return [
          ...metricEvidence,
          [`${prefix}DiagnosticCode`, profile.diagnostic.code],
          [`${prefix}MissingMetricsMask`, missingMask],
        ];
      }));
      if (observation.performance.profiles[0]?.status === "complete") {
        profileEvidence.mobileScoreModelVersion = "lighthouse-13.6.0";
      }
      const complete = observation.performance.profiles.every(({ status }) => status === "complete");
      const responseTimeMs = check.evidence.responseTimeMs;
      const responseBytes = check.evidence.responseBytes;
      const httpObserved = check.evidence.inspected === true &&
        typeof responseTimeMs === "number" && Number.isSafeInteger(responseTimeMs) &&
        typeof responseBytes === "number" && Number.isSafeInteger(responseBytes);
      const status = httpObserved && responseTimeMs > 2_500
        ? "fail"
        : httpObserved && complete ? "pass" : "unknown";
      return {
        ...check,
        status,
        summary: performanceSummary(
          status,
          httpObserved,
          typeof responseTimeMs === "number" ? responseTimeMs : undefined,
          observation.performance.profiles,
        ),
        evidence: { ...check.evidence, ...profileEvidence },
      };
    }
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

function performanceSummary(
  status: "pass" | "fail" | "unknown",
  httpObserved: boolean,
  responseTimeMs: number | undefined,
  profiles: NonNullable<PrivacyBrowserObservation["performance"]>["profiles"],
): string {
  if (status === "pass") return "Respuesta inicial y perfiles de móvil y escritorio medidos.";
  if (status === "fail") {
    return `Respuesta inicial: ${responseTimeMs ?? "más de 2.500"} ms; supera el umbral de 2.500 ms.`;
  }

  const missing: string[] = [];
  if (!httpObserved) missing.push("respuesta HTTP inicial (tiempo y tamaño)");
  for (const profile of profiles) {
    if (profile.status === "complete") continue;
    const label = profile.profile === "mobile" ? "Móvil" : "Escritorio";
    const missingMetrics = (profile.diagnostic?.missingMetrics ?? []).map((metric) => PERFORMANCE_METRIC_LABELS[metric]);
    missing.push(missingMetrics.length > 0
      ? `${label}: faltan ${missingMetrics.join(", ")}`
      : `${label}: perfil incompleto (${profile.diagnostic?.code ?? "sin diagnóstico"})`);
  }
  return `Medición incompleta: ${missing.join("; ") || "faltan datos requeridos"}.`;
}

const PERFORMANCE_METRIC_LABELS = {
  fcpMs: "FCP",
  speedIndexMs: "Speed Index",
  lcpMs: "LCP",
  cls: "CLS",
  tbtMs: "TBT",
  ttfbMs: "TTFB",
  transferBytes: "bytes transferidos",
  score: "puntuación",
} as const;
