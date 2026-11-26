import { PRIVACY_BROWSER_BUDGET } from "@desarrolloseguro/core";
import { observePagePerformance, PERFORMANCE_OBSERVATION_DURATION_MS, type PerformanceBrowserEvidence } from "./performance-browser-observer.js";
import {
  observePrivacyBehavior,
  type PrivacyBrowserInput,
  type PrivacyBrowserObservation,
} from "./privacy-browser-observer.js";
import type { PublicAuditProgressEvent } from "@desarrolloseguro/core";

export type PrivacyBrowserObservationOptions = {
  proxyUrl: string;
  createTimeoutSignal?: (durationMs: number) => AbortSignal;
  observePrivacy?: typeof observePrivacyBehavior;
  observePerformance?: typeof observePagePerformance;
  onProgress?: (event: PublicAuditProgressEvent) => void;
};

/** Runs privacy and performance with separate bounded cancellation deadlines. */
export async function observePrivacyAndPerformance(
  input: PrivacyBrowserInput,
  options: PrivacyBrowserObservationOptions,
): Promise<PrivacyBrowserObservation> {
  const createTimeoutSignal = options.createTimeoutSignal ?? AbortSignal.timeout;
  const observePrivacy = options.observePrivacy ?? observePrivacyBehavior;
  const observePerformance = options.observePerformance ?? observePagePerformance;
  let result: PrivacyBrowserObservation;

  try {
    options.onProgress?.({ aspect: "privacy", state: "running" });
    result = await observePrivacy(input, {
      proxyUrl: options.proxyUrl,
      signal: createTimeoutSignal(PRIVACY_BROWSER_BUDGET.durationMs),
    });
  } catch {
    result = unknownPrivacyObservation(input);
  }
  options.onProgress?.({ aspect: "privacy", state: "complete" });

  if (!input.targetUrl) return result;

  let performance: PerformanceBrowserEvidence;
  try {
    options.onProgress?.({ aspect: "performance", state: "running" });
    performance = await observePerformance({
      targetUrl: input.targetUrl,
      hostname: input.hostname,
      proxyUrl: options.proxyUrl,
      signal: createTimeoutSignal(PERFORMANCE_OBSERVATION_DURATION_MS),
    });
  } catch {
    performance = unknownPerformanceEvidence();
  }
  options.onProgress?.({ aspect: "performance", state: "complete" });
  return { ...result, performance };
}

function unknownPrivacyObservation(input: PrivacyBrowserInput): PrivacyBrowserObservation {
  return {
    protocolVersion: 1,
    requestId: input.requestId,
    hostname: input.hostname,
    status: "unknown",
    context: { browser: "Chromium", locale: "es-ES", timezone: "Europe/Madrid", viewport: "desktop-1365x768" },
    initial: unknownFlow(),
    policyLinkVisit: { status: "unknown", link: null, documentAccess: "unknown", navigationStartedAtMs: null, beforeNavigation: null, afterNavigation: null },
    accept: unknownFlow(),
    reject: unknownFlow(),
    vendorControlCoverage: "unknown",
    vendorControlCount: 0,
    vendorControls: [],
    requestCount: 0,
    blockedRequestCount: 0,
    requestBudgetExceeded: false,
    thirdPartyRequestHosts: [],
    receivedBytes: null,
  };
}

function unknownPerformanceEvidence(): PerformanceBrowserEvidence {
  const unknown = (profile: "mobile" | "desktop") => ({
    profile,
    status: "unknown" as const,
    fcpMs: null,
    speedIndexMs: null,
    lcpMs: null,
    cls: null,
    tbtMs: null,
    ttfbMs: null,
    transferBytes: null,
    score: null,
    diagnostic: { code: "browser_observation_error" as const },
  });
  return { profiles: [unknown("mobile"), unknown("desktop")] };
}

function unknownFlow(): PrivacyBrowserObservation["initial"] {
  return {
    status: "unknown",
    pageLoaded: false,
    consentPromptDetected: null,
    acceptVisibleAtFirstLayer: null,
    rejectVisibleAtFirstLayer: null,
    actionsToAccept: null,
    actionsToReject: null,
    preferenceWriteAllowed: false,
    rejectionPersistedAfterReload: null,
    signalHostsAfterChoice: [],
    completedHostsAfterChoice: [],
    cookiesAfterChoice: [],
    storageKeysAfterChoice: [],
    cookieReadComplete: false,
    storageReadComplete: false,
    firstEntryPolicyLinks: { status: "unknown", consentComponentDetected: null, consentComponentLink: null, consentComponentDocumentAccess: "unknown", informationNoticeLink: null, informationNoticeDocumentAccess: "unknown", footerLink: null, footerLinkDocumentAccess: "unknown" },
    phaseEvidence: {
      beforeChoice: null,
      choiceActionAtMs: null,
      afterChoice: null,
      reloadStartedAtMs: null,
      afterReload: null,
      rejectionChoiceStateAfterReload: "unknown",
      rejectionChoiceEvidence: null,
      networkRequests: [],
      networkRequestsComplete: true,
    },
  };
}
