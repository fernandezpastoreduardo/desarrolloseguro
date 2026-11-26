import { describe, expect, it } from "vitest";
import { assessPrivacyObservation, getObservedPublicServices } from "./privacy-assessment-builder.js";
import { identifyUnattributedProviderDestination } from "./provider-destination-identity.js";
import { mergePrivacyBrowserChecks } from "./privacy-public-browser-evidence.js";
import type { PrivacyBrowserFlowObservation, PrivacyBrowserObservation } from "./privacy-browser-observer.js";

function flow(overrides: Partial<PrivacyBrowserFlowObservation> = {}): PrivacyBrowserFlowObservation {
  return {
    status: "evaluated", pageLoaded: true, consentPromptDetected: false,
    acceptVisibleAtFirstLayer: false, rejectVisibleAtFirstLayer: false,
    actionsToAccept: 0, actionsToReject: 0, preferenceWriteAllowed: false,
    rejectionPersistedAfterReload: null, signalHostsAfterChoice: [], completedHostsAfterChoice: [],
    cookiesAfterChoice: [], storageKeysAfterChoice: [], cookieReadComplete: true, storageReadComplete: true,
    firstEntryPolicyLinks: { status: "unknown", consentComponentDetected: null, consentComponentLink: null, consentComponentDocumentAccess: "unknown", footerLink: null, footerLinkDocumentAccess: "unknown" },
    phaseEvidence: { beforeChoice: null, choiceActionAtMs: null, afterChoice: null, reloadStartedAtMs: null,
      afterReload: null, rejectionChoiceStateAfterReload: "unknown", rejectionChoiceEvidence: null,
      networkRequests: [], networkRequestsComplete: true },
    ...overrides,
  };
}

function observation(overrides: Partial<PrivacyBrowserObservation> = {}): PrivacyBrowserObservation {
  return {
    protocolVersion: 1, requestId: "947dd0c9-564c-4a30-8ce3-efb4ecae9136", hostname: "grumphya.com",
    status: "complete", context: { browser: "Chromium", locale: "es-ES", timezone: "Europe/Madrid", viewport: "desktop-1365x768" },
    initial: flow(), policyLinkVisit: { status: "not_applicable", link: null, documentAccess: "not_checked", navigationStartedAtMs: null, beforeNavigation: null, afterNavigation: null },
    accept: flow(), reject: flow(), requestCount: 1, blockedRequestCount: 0,
    vendorControlCoverage: "not_applicable", vendorControlCount: 0, vendorControls: [],
    requestBudgetExceeded: false, thirdPartyRequestHosts: [], receivedBytes: null,
    ...overrides,
  };
}

describe("assessPrivacyObservation", () => {
  it("uses a same-flow auditor-blocked Google Analytics request to corroborate a visible first-party cookie", () => {
    const initial = flow({
      signalHostsAfterChoice: ["region1.google-analytics.com"],
      cookiesAfterChoice: [{ name: "_ga", domain: ".talentoypersonas.com", secure: true, httpOnly: false }],
      phaseEvidence: {
        ...flow().phaseEvidence,
        beforeChoice: {
          capturedAtMs: 100,
          cookies: [{ name: "_ga", domain: ".talentoypersonas.com", secure: true, httpOnly: false }],
          storageKeys: [],
          cookieReadComplete: true,
          storageReadComplete: true,
        },
        networkRequests: [{
          phaseAtStart: "before_choice", responsePhase: null, responseAtMs: null, phaseAtCompletion: null,
          startedAtMs: 50, completedAtMs: null, url: "https://region1.google-analytics.com/g/collect",
          hostname: "region1.google-analytics.com", method: "POST", resourceType: "fetch", responseStatus: null,
          blockedByAudit: true, failed: true, sentCookieNames: [], receivedCookieNames: [],
        }],
      },
    });
    const result = assessPrivacyObservation(observation({ hostname: "talentoypersonas.com", initial }));
    expect(result.score).toBeLessThan(100);
    expect(result.criteria[0]).toMatchObject({ status: "evaluated", confirmedFindings: 2 });
  });

  it("publishes browser counts and separates blocked tracking attempts from received responses", () => {
    const blocked = {
      phaseAtStart: "before_choice" as const, responsePhase: null, responseAtMs: null, phaseAtCompletion: null,
      startedAtMs: 10, completedAtMs: null, url: "https://region1.google-analytics.com/g/collect",
      hostname: "region1.google-analytics.com", method: "POST", resourceType: "fetch", responseStatus: null,
      blockedByAudit: true, failed: true, sentCookieNames: [], receivedCookieNames: [],
    };
    const initial = flow({
      phaseEvidence: {
        ...flow().phaseEvidence,
        beforeChoice: {
          capturedAtMs: 20,
          cookies: [{ name: "_ga", domain: ".talentoypersonas.com", secure: true, httpOnly: false }],
          storageKeys: [],
          cookieReadComplete: true,
          storageReadComplete: true,
        },
        networkRequests: [blocked],
      },
    });
    const check = (controlId: string) => ({
      controlId, status: "pass" as const, required: true, severity: "medium", observedAt: new Date(),
      targetPath: "/", method: "GET", summary: "", limitation: "", evidence: {},
    });
    const result = mergePrivacyBrowserChecks(
      [check("DS-PRIV-05"), check("DS-PRIV-06")],
      observation({ hostname: "talentoypersonas.com", initial }),
    );
    expect(result[0]).toMatchObject({
      status: "fail",
      evidence: { browserCookieCount: 1, browserCatalogMatchCount: 1, browserObservationComplete: true },
    });
    expect(result[1]).toMatchObject({
      status: "fail",
      evidence: {
        browserKnownTrackingRequestCount: 1,
        browserBlockedTrackingRequestCount: 1,
        browserTrackingResponseCount: 0,
      },
      limitation: expect.stringContaining("no prueban que se transmitieran"),
    });
  });

  it("adds complete browser performance metrics to a provisional unknown DS-QUAL-02", () => {
    const performance = {
      profiles: [
        { profile: "mobile", status: "complete", fcpMs: 800, lcpMs: 1_200, cls: 0.04, tbtMs: 45, ttfbMs: 100, transferBytes: 12_000, score: 94 },
        { profile: "desktop", status: "complete", fcpMs: 400, lcpMs: 700, cls: 0.01, tbtMs: 20, ttfbMs: 50, transferBytes: 8_000, score: 100 },
      ],
    } as const;
    const result = mergePrivacyBrowserChecks([{
      controlId: "DS-QUAL-02", status: "unknown", required: true, severity: "medium", observedAt: new Date(),
      targetPath: "/careers?source=lab", method: "GET", summary: "", limitation: "",
      evidence: { inspected: true, responseTimeMs: 700, responseBytes: 45_000 },
    }], observation({ performance }));

    expect(result[0]).toMatchObject({
      status: "pass",
      evidence: {
        mobileFcpMs: 800,
        mobileLcpMs: 1_200,
        mobileClsMilli: 40,
        mobileTbtMs: 45,
        mobileTtfbMs: 100,
        mobileTransferBytes: 12_000,
        mobileScore: 94,
        desktopFcpMs: 400,
        desktopLcpMs: 700,
        desktopScore: 100,
      },
    });
  });

  it("keeps DS-QUAL-02 unknown for incomplete profiles and fails a slow observed response", () => {
    const performance = {
      profiles: [
        { profile: "mobile", status: "complete", fcpMs: 800, lcpMs: 1_200, cls: 0.04, tbtMs: 45, ttfbMs: 100, transferBytes: 12_000, score: 94 },
        { profile: "desktop", status: "unknown", fcpMs: null, lcpMs: null, cls: null, tbtMs: null, ttfbMs: null, transferBytes: null, score: null },
      ],
    } as const;
    const result = mergePrivacyBrowserChecks([{
      controlId: "DS-QUAL-02", status: "pass", required: true, severity: "medium", observedAt: new Date(),
      targetPath: "/careers?source=lab", method: "GET", summary: "", limitation: "",
      evidence: { inspected: true, responseTimeMs: 700, responseBytes: 45_000 },
    }], observation({ performance }));

    expect(result[0]).toMatchObject({
      status: "unknown",
      evidence: {
        mobileFcpMs: 800,
        mobileLcpMs: 1_200,
        mobileClsMilli: 40,
        mobileTbtMs: 45,
        mobileTtfbMs: 100,
        mobileTransferBytes: 12_000,
        mobileScore: 94,
      },
    });
    expect(result[0]?.evidence).not.toHaveProperty("desktopScore");

    const slow = mergePrivacyBrowserChecks([{
      controlId: "DS-QUAL-02", status: "unknown", required: true, severity: "medium", observedAt: new Date(),
      targetPath: "/careers?source=lab", method: "GET", summary: "", limitation: "",
      evidence: { inspected: true, responseTimeMs: 2_501, responseBytes: 45_000 },
    }], observation({ performance: {
      profiles: [
        { profile: "mobile", status: "unknown", fcpMs: null, lcpMs: null, cls: null, tbtMs: null, ttfbMs: null, transferBytes: null, score: null },
        { profile: "desktop", status: "unknown", fcpMs: null, lcpMs: null, cls: null, tbtMs: null, ttfbMs: null, transferBytes: null, score: null },
      ],
    } }));
    expect(slow[0]).toMatchObject({ status: "fail", evidence: { responseTimeMs: 2_501 } });
  });

  it("retains confirmed services and completed third-party destinations without assigning unknown companies", () => {
    const result = getObservedPublicServices(observation({
      initial: flow({
        completedHostsAfterChoice: ["www.google-analytics.com", "grumphya.com", "unknown-destination.net"],
        cookiesAfterChoice: [{ name: "_ga", domain: ".grumphya.com", secure: true, httpOnly: false }],
      }),
    }));
    expect(result).toEqual([
      { providerId: "google-analytics", domain: "www.google-analytics.com" },
      { providerId: identifyUnattributedProviderDestination("unknown-destination.net").providerId, domain: "unknown-destination.net" },
    ]);
  });

  it("gives a full score when the homepage has no consent prompt or observed tracking", () => {
    const result = assessPrivacyObservation(observation());
    expect(result.score).toBe(100);
    expect(result.assessedCriteria).toBe(1);
    expect(result.notApplicableCriteria).toBe(4);
    expect(result.criteria[0]?.status).toBe("evaluated");
  });

  it("penalizes confirmed analytics before consent while retaining unknown observations", () => {
    const result = assessPrivacyObservation(observation({
      initial: flow({ consentPromptDetected: true, signalHostsAfterChoice: ["www.google-analytics.com"],
        completedHostsAfterChoice: ["www.google-analytics.com"],
        cookiesAfterChoice: [{ name: "_ga", domain: ".grumphya.com", secure: true, httpOnly: false }], }),
      accept: flow({ consentPromptDetected: true }),
      reject: flow({ consentPromptDetected: true, rejectionPersistedAfterReload: true }),
    }));
    expect(result.criteria[0]?.status).toBe("evaluated");
    expect(result.criteria[0]?.confirmedFindings).toBe(2);
    expect(result.criteria[0]?.awarded).toBe(28.5);
  });

  it("does not penalize an attempted request that never completed and exposes it as unknown", () => {
    const result = assessPrivacyObservation(observation({
      initial: flow({ signalHostsAfterChoice: ["www.google-analytics.com"] }),
    }));
    expect(result.criteria[0]?.status).toBe("evaluated");
    expect(result.criteria[0]?.confirmedFindings).toBe(0);
    expect(result.criteria[0]?.unknownFindings).toBe(1);
    expect(result.criteria[0]?.awarded).toBe(30);
  });

  it("lists a confirmed CMP and its preference cookie without scoring it as tracking", () => {
    const result = assessPrivacyObservation(observation({
      initial: flow({
        signalHostsAfterChoice: ["consent.didomi.io"],
        completedHostsAfterChoice: ["consent.didomi.io"],
        cookiesAfterChoice: [{ name: "didomi_token", domain: ".grumphya.com", secure: true, httpOnly: false }],
      }),
    }));

    expect(result.score).toBe(100);
    expect(result.criteria[0]?.confirmedFindings).toBe(0);
    expect(result.criteria[0]?.unknownFindings).toBe(0);
    expect(result.evidence.providers).toContain("Didomi");
    expect(result.evidence.cookieNames).toContain("didomi_token");
  });

  it("keeps incomplete capture unknown without erasing confirmed evidence", () => {
    const result = assessPrivacyObservation(observation({
      initial: flow({ status: "unknown", cookieReadComplete: false,
        signalHostsAfterChoice: ["www.google-analytics.com"], completedHostsAfterChoice: ["www.google-analytics.com"] }),
    }));
    expect(result.criteria[0]?.status).toBe("unknown");
  });

  it("publishes bounded cookie, provider and third-party domain names without cookie values", () => {
    const cookiesAfterChoice = Array.from({ length: 6 }, (_, index) => ({
      name: `_ga_session_${index}`, domain: ".grumphya.com", secure: true, httpOnly: false,
    }));
    const result = assessPrivacyObservation(observation({
      initial: flow({ consentPromptDetected: true }),
      accept: flow({ consentPromptDetected: true, completedHostsAfterChoice: ["www.google-analytics.com"], cookiesAfterChoice }),
      reject: flow({ consentPromptDetected: true, rejectionPersistedAfterReload: true }),
    }));
    expect(result.evidence).toEqual({
      cookieNames: cookiesAfterChoice.map(({ name }) => name),
      providers: ["Google Analytics"],
      domains: ["www.google-analytics.com"],
    });
    expect(result.criteria[1]?.status).toBe("evaluated");
    expect(result.criteria[1]?.confirmedFindings).toBe(1);
  });

  it("evaluates a persisted provider disable and penalizes confirmed activity that continues", () => {
    const result = assessPrivacyObservation(observation({
      initial: flow({ consentPromptDetected: true }),
      accept: flow({ consentPromptDetected: true, completedHostsAfterChoice: ["www.google-analytics.com"] }),
      reject: flow({ consentPromptDetected: true, rejectionPersistedAfterReload: true }),
      vendorControlCoverage: "complete",
      vendorControls: [{
        provider: "Google Analytics", status: "evaluated", declaredLegitimateInterest: true, toggleCount: 2,
        actionsToDisable: 3, disabled: true, persistedDisabled: true,
        signalHostsAfterDisable: ["google-analytics.com"],
        completedHostsAfterDisable: ["google-analytics.com"],
        cookiesAfterDisable: [{ name: "_ga", domain: "grumphya.com" }],
      }],
    }));
    expect(result.criteria[4]?.status).toBe("evaluated");
    expect(result.criteria[4]?.confirmedFindings).toBe(4);
    expect(result.criteria[4]?.deduction).toBe(1.75);
    expect(result.evidence.providers).toContain("Google Analytics");
  });

  it("keeps provider effect unknown when the accepted baseline never activated it", () => {
    const result = assessPrivacyObservation(observation({
      initial: flow({ consentPromptDetected: true }),
      accept: flow({ consentPromptDetected: true }),
      reject: flow({ consentPromptDetected: true, rejectionPersistedAfterReload: true }),
      vendorControlCoverage: "complete",
      vendorControls: [{
        provider: "Google Analytics", status: "evaluated", declaredLegitimateInterest: false, toggleCount: 1,
        actionsToDisable: 1, disabled: true, persistedDisabled: true,
        signalHostsAfterDisable: [], completedHostsAfterDisable: [], cookiesAfterDisable: [],
      }],
    }));
    expect(result.criteria[4]?.status).toBe("unknown");
    expect(result.criteria[4]?.unknownFindings).toBe(1);
  });
});
