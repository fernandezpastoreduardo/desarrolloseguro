import { describe, expect, it } from "vitest";
import type { PrivacyBrowserFlowObservation, PrivacyBrowserObservation } from "./privacy-browser-observer.js";
import { buildLegalCookieFindings } from "./privacy-legal-cookie-findings.js";

describe("buildLegalCookieFindings", () => {
  it("accredits a known tracking cookie observed before any choice", () => {
    const observation = makeObservation({
      initial: makeFlow({ beforeChoice: snapshot(40) }),
    });

    expect(buildLegalCookieFindings(observation)).toEqual([
      expect.objectContaining({
        ruleId: "lssi-cookie-no-prior-consent-v1",
        status: "accredited",
        infringementClass: "minor",
        sanction: { type: "statutory_maximum", currency: "EUR", maximum: 30000 },
        evidence: [expect.objectContaining({
          flow: "initial",
          phase: "before_choice",
          capturedAtMs: 40,
          cookieName: "_ga",
          provider: "Google Analytics",
        })],
      }),
    ]);
  });

  it("records cookies still present after rejection and after reload as separate phases", () => {
    const observation = makeObservation({
      reject: makeFlow({
        choiceActionAtMs: 80,
        afterChoice: snapshot(90),
        reloadStartedAtMs: 120,
        afterReload: snapshot(160),
      }),
    });

    const findings = buildLegalCookieFindings(observation);
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({ ruleId: "lssi-cookie-after-rejection-v1" });
    expect(findings[0]?.evidence.map(({ phase, capturedAtMs }) => ({ phase, capturedAtMs }))).toEqual([
      { phase: "after_choice", capturedAtMs: 90 },
      { phase: "after_reload", capturedAtMs: 160 },
    ]);
  });

  it("does not create an LSSI finding for an unattributed cookie name", () => {
    const observation = makeObservation({
      initial: makeFlow({ beforeChoice: snapshot(40, "visitor_id") }),
    });

    expect(buildLegalCookieFindings(observation)).toEqual([]);
  });
});

function makeObservation(
  overrides: Partial<Pick<PrivacyBrowserObservation, "initial" | "reject">> = {},
): PrivacyBrowserObservation {
  return {
    protocolVersion: 1,
    requestId: "123e4567-e89b-42d3-a456-426614174000",
    hostname: "example.es",
    status: "complete",
    context: { browser: "Chromium", locale: "es-ES", timezone: "Europe/Madrid", viewport: "desktop-1365x768" },
    initial: overrides.initial ?? makeFlow({}),
    accept: makeFlow({}),
    reject: overrides.reject ?? makeFlow({}),
    vendorControlCoverage: "not_applicable",
    vendorControlCount: 0,
    vendorControls: [],
    requestCount: 0,
    blockedRequestCount: 0,
    requestBudgetExceeded: false,
    thirdPartyRequestHosts: [],
    receivedBytes: 0,
  };
}

function makeFlow(overrides: {
  beforeChoice?: PrivacyBrowserFlowObservation["phaseEvidence"]["beforeChoice"];
  afterChoice?: PrivacyBrowserFlowObservation["phaseEvidence"]["afterChoice"];
  afterReload?: PrivacyBrowserFlowObservation["phaseEvidence"]["afterReload"];
  choiceActionAtMs?: number;
  reloadStartedAtMs?: number;
}): PrivacyBrowserFlowObservation {
  return {
    status: "evaluated",
    pageLoaded: true,
    consentPromptDetected: true,
    acceptVisibleAtFirstLayer: true,
    rejectVisibleAtFirstLayer: true,
    actionsToAccept: null,
    actionsToReject: 1,
    preferenceWriteAllowed: false,
    rejectionPersistedAfterReload: null,
    signalHostsAfterChoice: [],
    completedHostsAfterChoice: [],
    cookiesAfterChoice: [],
    storageKeysAfterChoice: [],
    cookieReadComplete: true,
    storageReadComplete: true,
    phaseEvidence: {
      beforeChoice: overrides.beforeChoice ?? null,
      choiceActionAtMs: overrides.choiceActionAtMs ?? null,
      afterChoice: overrides.afterChoice ?? null,
      reloadStartedAtMs: overrides.reloadStartedAtMs ?? null,
      afterReload: overrides.afterReload ?? null,
      rejectionChoiceStateAfterReload: "unknown",
      rejectionChoiceEvidence: null,
      networkRequests: [],
      networkRequestsComplete: true,
    },
  };
}

function snapshot(capturedAtMs: number, cookieName = "_ga") {
  return {
    capturedAtMs,
    cookies: [{ name: cookieName, domain: "google-analytics.com", secure: true, httpOnly: false }],
    storageKeys: [],
    cookieReadComplete: true,
    storageReadComplete: true,
  };
}
