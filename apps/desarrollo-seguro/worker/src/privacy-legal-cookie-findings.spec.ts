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

  it("records an analytics host blocked by the auditor as an attempted request", () => {
    const observation = makeObservation({ initial: makeFlow({ beforeChoice: {
      capturedAtMs: 40,
      cookies: [{ name: "_ga", domain: "example.es", secure: true, httpOnly: false }],
      storageKeys: [], cookieReadComplete: true, storageReadComplete: true,
    } }) });
    observation.initial.phaseEvidence.networkRequests = [{
      phaseAtStart: "before_choice",
      responsePhase: null,
      responseAtMs: null,
      phaseAtCompletion: null,
      startedAtMs: 30,
      completedAtMs: null,
      url: "https://region1.google-analytics.com/g/collect",
      hostname: "region1.google-analytics.com",
      method: "POST",
      resourceType: "ping",
      responseStatus: null,
      blockedByAudit: true,
      failed: true,
      sentCookieNames: [],
      receivedCookieNames: [],
    }];

    expect(buildLegalCookieFindings(observation)[0]?.evidence[0]).toMatchObject({
      cookieName: "_ga",
      correlatedRequestHosts: [],
      auditBlockedRequestHosts: ["region1.google-analytics.com"],
    });
  });

  it("keeps directly observed cookies when a separate step leaves the flow incomplete", () => {
    const observation = makeObservation({
      initial: makeFlow({ beforeChoice: snapshot(40) }),
      reject: makeFlow({ choiceActionAtMs: 80, afterChoice: snapshot(90) }),
    });
    observation.initial.status = "unknown";
    observation.reject.status = "unknown";

    expect(buildLegalCookieFindings(observation).map(({ ruleId, evidence }) => ({
      ruleId,
      phases: evidence.map(({ phase, capturedAtMs }) => ({ phase, capturedAtMs })),
    }))).toEqual([
      { ruleId: "lssi-cookie-no-prior-consent-v1", phases: [{ phase: "before_choice", capturedAtMs: 40 }] },
      { ruleId: "lssi-cookie-after-rejection-v1", phases: [{ phase: "after_choice", capturedAtMs: 90 }] },
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

  it("attributes a first-party cookie that persists after rejection to its own earlier blocked analytics request", () => {
    const observation = makeObservation({
      reject: makeFlow({
        beforeChoice: snapshot(40, "_ga", "talentoypersonas.com"),
        choiceActionAtMs: 80,
        afterChoice: snapshot(90, "_ga", "talentoypersonas.com"),
        reloadStartedAtMs: 120,
        afterReload: snapshot(160, "_ga", "talentoypersonas.com"),
      }),
    });
    observation.reject.phaseEvidence.networkRequests = [{
      phaseAtStart: "before_choice",
      responsePhase: null,
      responseAtMs: null,
      phaseAtCompletion: null,
      startedAtMs: 30,
      completedAtMs: null,
      url: "https://region1.google-analytics.com/g/collect",
      hostname: "region1.google-analytics.com",
      method: "POST",
      resourceType: "ping",
      responseStatus: null,
      blockedByAudit: true,
      failed: true,
      sentCookieNames: [],
      receivedCookieNames: [],
    }];

    const finding = buildLegalCookieFindings(observation).find(({ ruleId }) => ruleId === "lssi-cookie-after-rejection-v1");
    expect(finding?.evidence).toEqual([
      expect.objectContaining({
        phase: "after_choice",
        cookieName: "_ga",
        cookieDomain: "talentoypersonas.com",
        provider: "Google Analytics",
        corroborationPhase: "before_choice",
        correlatedRequestHosts: [],
        auditBlockedRequestHosts: ["region1.google-analytics.com"],
      }),
      expect.objectContaining({
        phase: "after_reload",
        cookieName: "_ga",
        cookieDomain: "talentoypersonas.com",
        provider: "Google Analytics",
        corroborationPhase: "before_choice",
        auditBlockedRequestHosts: ["region1.google-analytics.com"],
      }),
    ]);
  });

  it("does not create an LSSI finding for an unattributed cookie name", () => {
    const observation = makeObservation({
      initial: makeFlow({ beforeChoice: snapshot(40, "visitor_id") }),
    });

    expect(buildLegalCookieFindings(observation)).toEqual([]);
  });

  it("does not create an LSSI finding for a technical first-party session cookie or absent rejection action", () => {
    const observation = makeObservation({
      initial: makeFlow({ beforeChoice: {
        capturedAtMs: 40,
        cookies: [{ name: "sessionid", domain: "example.es", secure: true, httpOnly: true }],
        storageKeys: [], cookieReadComplete: true, storageReadComplete: true,
      } }),
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
    policyLinkVisit: { status: "not_applicable", link: null, documentAccess: "not_checked", navigationStartedAtMs: null, beforeNavigation: null, afterNavigation: null },
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
    firstEntryPolicyLinks: { status: "unknown", consentComponentDetected: null, consentComponentLink: null, consentComponentDocumentAccess: "unknown", footerLink: null, footerLinkDocumentAccess: "unknown" },
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

function snapshot(capturedAtMs: number, cookieName = "_ga", domain = "google-analytics.com") {
  return {
    capturedAtMs,
    cookies: [{ name: cookieName, domain, secure: true, httpOnly: false }],
    storageKeys: [],
    cookieReadComplete: true,
    storageReadComplete: true,
  };
}
