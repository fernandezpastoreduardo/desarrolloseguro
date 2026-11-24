import { describe, expect, it } from "vitest";
import { assessPrivacyObservation, getObservedPublicServices } from "./privacy-assessment-builder.js";
import { identifyUnattributedProviderDestination } from "./provider-destination-identity.js";
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
    initial: flow(), accept: flow(), reject: flow(), requestCount: 1, blockedRequestCount: 0,
    vendorControlCoverage: "not_applicable", vendorControlCount: 0, vendorControls: [],
    requestBudgetExceeded: false, thirdPartyRequestHosts: [], receivedBytes: null,
    ...overrides,
  };
}

describe("assessPrivacyObservation", () => {
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
