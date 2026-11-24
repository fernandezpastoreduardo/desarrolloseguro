import type { LegalCookieEvidence, LegalCookieFinding } from "@desarrolloseguro/core";
import { matchPrivacySignal } from "./privacy-knowledge-base.js";
import { PRIVACY_KNOWLEDGE_RULES } from "./privacy-knowledge-catalog.js";
import type { PrivacyBrowserFlowObservation, PrivacyBrowserObservation, PrivacyBrowserStateSnapshot } from "./privacy-browser-observer.js";

const TRACKING_CATEGORIES = new Set(["analytics", "advertising", "social"]);
const LSSI_URL = "https://www.boe.es/buscar/act.php?id=BOE-A-2002-13758";

/** Builds a separate LSSI finding set solely from directly observed, phase-specific cookie evidence. */
export function buildLegalCookieFindings(observation: PrivacyBrowserObservation): LegalCookieFinding[] {
  const priorEvidence = collectPhaseEvidence("initial", observation.initial, "before_choice");
  const rejectedEvidence = observation.reject.phaseEvidence.choiceActionAtMs === null
    ? []
    : [
      ...collectPhaseEvidence("reject", observation.reject, "after_choice"),
      ...(observation.reject.phaseEvidence.reloadStartedAtMs === null
        ? []
        : collectPhaseEvidence("reject", observation.reject, "after_reload")),
    ];
  return [
    ...(priorEvidence.length ? [makeFinding("lssi-cookie-no-prior-consent-v1", priorEvidence)] : []),
    ...(rejectedEvidence.length ? [makeFinding("lssi-cookie-after-rejection-v1", rejectedEvidence)] : []),
  ];
}

function collectPhaseEvidence(
  flowName: LegalCookieEvidence["flow"],
  flow: PrivacyBrowserFlowObservation,
  phase: LegalCookieEvidence["phase"],
): LegalCookieEvidence[] {
  const snapshot: PrivacyBrowserStateSnapshot | null = phase === "before_choice"
    ? flow.phaseEvidence.beforeChoice
    : phase === "after_choice" ? flow.phaseEvidence.afterChoice : flow.phaseEvidence.afterReload;
  if (flow.status !== "evaluated") return [];
  const requests = flow.phaseEvidence.networkRequests.filter((request) =>
    !request.blockedByAudit && request.phaseAtStart === phase,
  );
  const hosts = [...new Set(requests.map(({ hostname }) => normalizeHostname(hostname)))];
  const evidence: LegalCookieEvidence[] = [];
  const snapshotCookies = snapshot && snapshot.cookieReadComplete ? snapshot.cookies : [];
  const snapshotCapturedAtMs = snapshot?.capturedAtMs ?? 0;
  for (const cookie of snapshotCookies) {
    evidence.push(...matchCookieEvidence(flowName, phase, snapshotCapturedAtMs,
      cookie.name, cookie.domain, hosts));
  }
  for (const request of requests) {
    for (const cookieName of request.sentCookieNames) {
      evidence.push(...matchCookieEvidence(flowName, phase, request.startedAtMs,
        cookieName, request.hostname, [request.hostname]));
    }
    const responsePhase = phase === "before_choice" ? "before_choice" : phase;
    const receivedInPhase = request.responsePhase === responsePhase && request.responseAtMs !== null &&
      (phase === "before_choice" || request.responseAtMs > (phase === "after_reload"
        ? flow.phaseEvidence.reloadStartedAtMs ?? Number.MAX_SAFE_INTEGER
        : flow.phaseEvidence.choiceActionAtMs ?? Number.MAX_SAFE_INTEGER));
    if (receivedInPhase && request.responseAtMs !== null && request.responseStatus !== null && request.responseStatus < 400) {
      for (const cookieName of request.receivedCookieNames) {
        evidence.push(...matchCookieEvidence(flowName, phase, request.responseAtMs,
          cookieName, request.hostname, [request.hostname]));
      }
    }
  }
  const unique = new Map<string, LegalCookieEvidence>();
  for (const item of evidence) unique.set(`${item.cookieName}\0${item.cookieDomain}\0${item.provider}\0${item.capturedAtMs}`, item);
  return [...unique.values()].slice(0, 50);
}

function matchCookieEvidence(
  flow: LegalCookieEvidence["flow"],
  phase: LegalCookieEvidence["phase"],
  capturedAtMs: number,
  cookieName: string,
  cookieDomain: string,
  corroboratingHosts: string[],
): LegalCookieEvidence[] {
  return matchPrivacySignal({
    signalType: "cookie_name",
    value: cookieName,
    observedHostname: cookieDomain,
    corroboratingHostnames: corroboratingHosts,
  }, PRIVACY_KNOWLEDGE_RULES).filter((match) =>
    match.classification === "confirmed" && match.confidence === "high" && TRACKING_CATEGORIES.has(match.category),
  ).map((match) => ({
    flow,
    phase,
    capturedAtMs,
    cookieName,
    cookieDomain: normalizeDomain(cookieDomain),
    provider: match.provider,
    purpose: match.purpose,
    attributionRuleId: match.ruleId,
    correlatedRequestHosts: corroboratingHosts.slice(0, 20),
  }));
}

function makeFinding(
  ruleId: LegalCookieFinding["ruleId"],
  evidence: LegalCookieEvidence[],
): LegalCookieFinding {
  const prechoice = ruleId === "lssi-cookie-no-prior-consent-v1";
  return {
    ruleId,
    ruleVersion: "1.0.0",
    status: "accredited",
    title: prechoice
      ? "Uso de cookies analíticas o de seguimiento antes del consentimiento"
      : "Persistencia de cookies analíticas o de seguimiento después de rechazarlas",
    description: prechoice
      ? "El navegador limpio registró cookies no exentas de consentimiento antes de cualquier elección del usuario."
      : "El navegador registró cookies no exentas de consentimiento después de la acción explícita de rechazo.",
    jurisdiction: "ES",
    articles: [
      { law: "LSSI", article: "22.2", url: LSSI_URL },
      { law: "LSSI", article: "38.4.g", url: LSSI_URL },
      { law: "LSSI", article: "39.1.c", url: LSSI_URL },
      { law: "LSSI", article: "43.1", url: LSSI_URL },
    ],
    infringementClass: "minor",
    sanction: { type: "statutory_maximum", currency: "EUR", maximum: 30000 },
    authority: "Agencia Española de Protección de Datos",
    evidence,
    evidenceComplete: true,
  };
}

function normalizeHostname(value: string): string {
  let normalized = value.trim().toLowerCase();
  while (normalized.startsWith(".")) normalized = normalized.slice(1);
  while (normalized.endsWith(".")) normalized = normalized.slice(0, -1);
  return normalized;
}

function normalizeDomain(value: string): string {
  return normalizeHostname(value).slice(0, 253);
}
