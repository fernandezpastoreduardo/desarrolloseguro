import {
  assessFirstEntryPolicyAccess,
  isThirdPartyPrivacyHost,
  type FirstEntryPolicyAccess,
} from "@desarrolloseguro/core";
import { matchPrivacySignal } from "./privacy-knowledge-base.js";
import { PRIVACY_KNOWLEDGE_RULES } from "./privacy-knowledge-catalog.js";
import type { PrivacyBrowserObservation, PrivacyBrowserFlowObservation } from "./privacy-browser-observer.js";
import { detectThirdPartyCookiePresence } from "./privacy-first-entry-policy-link.js";

const NONESSENTIAL_CATEGORIES = new Set(["analytics", "advertising", "social"]);

export function assessFirstEntryPolicyAccessObservation(
  observation: PrivacyBrowserObservation | null,
): FirstEntryPolicyAccess {
  if (!observation) {
    return assessFirstEntryPolicyAccess({
      consentPromptDetected: null,
      thirdPartyCookieDetected: null,
      nonEssentialThirdPartyStorageDetected: null,
      consentComponentLink: null,
      informationNoticeLink: null,
      footerLink: null,
      componentLinkDocumentAccess: "unknown",
      informationNoticeDocumentAccess: "unknown",
      footerLinkDocumentAccess: "unknown",
      auditorError: true,
    });
  }
  const initial = observation.initial;
  const links = initial.firstEntryPolicyLinks;
  const snapshot = initial.phaseEvidence.beforeChoice;
  const thirdPartyCookieDetected = snapshot
    ? detectThirdPartyCookiePresence({
        auditedHostname: observation.hostname,
        cookies: snapshot.cookies,
        complete: snapshot.cookieReadComplete,
      })
    : null;
  const access = assessFirstEntryPolicyAccess({
    consentPromptDetected: initial.consentPromptDetected,
    thirdPartyCookieDetected,
    nonEssentialThirdPartyStorageDetected: detectNonEssentialThirdPartyStorage(observation, initial),
    consentComponentLink: links.consentComponentLink,
    informationNoticeLink: links.informationNoticeLink ?? null,
    footerLink: links.footerLink,
    componentLinkDocumentAccess: links.consentComponentDocumentAccess,
    informationNoticeDocumentAccess: links.informationNoticeDocumentAccess,
    footerLinkDocumentAccess: links.footerLinkDocumentAccess,
    auditorError: links.status === "unknown",
  });
  return { ...access, policyLinkVisit: observation.policyLinkVisit };
}

function detectNonEssentialThirdPartyStorage(
  observation: PrivacyBrowserObservation,
  flow: PrivacyBrowserFlowObservation,
): boolean | null {
  const snapshot = flow.phaseEvidence.beforeChoice;
  if (!snapshot || !snapshot.cookieReadComplete || !snapshot.storageReadComplete ||
      !flow.phaseEvidence.networkRequestsComplete) return null;

  const signals = [
    ...snapshot.cookies.map(({ name, domain }) => ({ signalType: "cookie_name" as const, value: name, observedHostname: domain })),
    ...snapshot.storageKeys.map(({ name, domain }) => ({ signalType: "storage_key" as const, value: name, observedHostname: domain })),
  ];
  let unknownThirdPartyStorage = false;
  for (const signal of signals) {
    const matches = matchPrivacySignal({ ...signal, corroboratingHostnames: flow.signalHostsAfterChoice }, PRIVACY_KNOWLEDGE_RULES);
    if (matches.some((match) => match.classification === "confirmed" && NONESSENTIAL_CATEGORIES.has(match.category))) return true;
    if (isThirdPartyPrivacyHost(observation.hostname, signal.observedHostname) ||
        matches.some((match) => NONESSENTIAL_CATEGORIES.has(match.category))) unknownThirdPartyStorage = true;
  }
  return unknownThirdPartyStorage ? null : false;
}
