import { describe, expect, it } from "vitest";
import { assessFirstEntryPolicyAccessObservation } from "./privacy-first-entry-policy-access.js";
import type { PrivacyBrowserObservation } from "./privacy-browser-observer.js";

const link = { hostname: "example.org", path: "/privacy", kind: "privacy" as const };

function observation(overrides: Partial<PrivacyBrowserObservation> = {}): PrivacyBrowserObservation {
  const flow: PrivacyBrowserObservation["initial"] = {
    status: "evaluated", pageLoaded: true, consentPromptDetected: false,
    acceptVisibleAtFirstLayer: false, rejectVisibleAtFirstLayer: false,
    actionsToAccept: 0, actionsToReject: 0, preferenceWriteAllowed: false,
    rejectionPersistedAfterReload: null, signalHostsAfterChoice: ["analytics.example.net"], completedHostsAfterChoice: [],
    cookiesAfterChoice: [], storageKeysAfterChoice: [], cookieReadComplete: true, storageReadComplete: true,
    firstEntryPolicyLinks: {
      status: "evaluated", consentComponentDetected: false,
      consentComponentLink: null, consentComponentDocumentAccess: "not_checked",
      footerLink: link, footerLinkDocumentAccess: "accessible",
    },
    phaseEvidence: {
      beforeChoice: { capturedAtMs: 1, cookies: [], storageKeys: [], cookieReadComplete: true, storageReadComplete: true },
      choiceActionAtMs: null, afterChoice: null, reloadStartedAtMs: null, afterReload: null,
      rejectionChoiceStateAfterReload: "unknown", rejectionChoiceEvidence: null,
      networkRequests: [], networkRequestsComplete: true,
    },
  };
  return {
    protocolVersion: 1, requestId: "947dd0c9-564c-4a30-8ce3-efb4ecae9136", hostname: "example.org",
    status: "complete", context: { browser: "Chromium", locale: "es-ES", timezone: "Europe/Madrid", viewport: "desktop-1365x768" },
    initial: flow, accept: flow, reject: flow, vendorControlCoverage: "not_applicable", vendorControlCount: 0,
    vendorControls: [], requestCount: 1, blockedRequestCount: 0, requestBudgetExceeded: false,
    thirdPartyRequestHosts: ["analytics.example.net"], receivedBytes: 0,
    ...overrides,
  };
}

describe("first-entry policy access from browser evidence", () => {
  it("fails a footer-only link when a consent component is present", () => {
    const result = assessFirstEntryPolicyAccessObservation(observation({
      initial: {
        ...observation().initial,
        consentPromptDetected: true,
        firstEntryPolicyLinks: {
          status: "evaluated", consentComponentDetected: true,
          consentComponentLink: null, consentComponentDocumentAccess: "not_checked",
          footerLink: link, footerLinkDocumentAccess: "accessible",
        },
      },
    }));
    expect(result).toMatchObject({ status: "fail", reasonCode: "consent_link_missing", linkLocation: "none" });
  });

  it("passes the footer exception with a complete clean cookie inventory even when third-party requests exist", () => {
    expect(assessFirstEntryPolicyAccessObservation(observation())).toMatchObject({
      status: "pass", reasonCode: "footer_link_accessible_without_consent", thirdPartyCookieDetected: false,
    });
  });

  it("does not pass the footer exception when a third-party cookie is observed", () => {
    const clean = observation();
    const result = assessFirstEntryPolicyAccessObservation({
      ...clean,
      initial: {
        ...clean.initial,
        phaseEvidence: {
          ...clean.initial.phaseEvidence,
          beforeChoice: { ...clean.initial.phaseEvidence.beforeChoice!, cookies: [{ name: "id", domain: "tracker.example.net", secure: true, httpOnly: false }] },
        },
      },
    });
    expect(result).toMatchObject({ status: "fail", reasonCode: "footer_insufficient_with_third_party_cookies", thirdPartyCookieDetected: true });
  });

  it("keeps missing cookie evidence unknown instead of granting the footer exception", () => {
    const clean = observation();
    const result = assessFirstEntryPolicyAccessObservation({
      ...clean,
      initial: {
        ...clean.initial,
        phaseEvidence: {
          ...clean.initial.phaseEvidence,
          beforeChoice: { ...clean.initial.phaseEvidence.beforeChoice!, cookieReadComplete: false },
        },
      },
    });
    expect(result).toMatchObject({ status: "unknown", reasonCode: "auditor_error", thirdPartyCookieDetected: null });
  });
});
