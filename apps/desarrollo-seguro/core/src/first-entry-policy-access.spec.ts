import { describe, expect, it } from "vitest";
import {
  assessFirstEntryPolicyAccess,
  parseFirstEntryPolicyAccess,
  type FirstEntryPolicyAccessInput,
} from "./first-entry-policy-access.js";

const privacyLink = { hostname: "example.org", path: "/privacy", kind: "privacy" as const };

function input(overrides: Partial<FirstEntryPolicyAccessInput> = {}): FirstEntryPolicyAccessInput {
  return {
    consentPromptDetected: true,
    thirdPartyCookieDetected: true,
    nonEssentialThirdPartyStorageDetected: true,
    consentComponentLink: null,
    footerLink: privacyLink,
    componentLinkDocumentAccess: "not_checked",
    footerLinkDocumentAccess: "accessible",
    ...overrides,
  };
}

describe("first-entry policy access", () => {
  it("preserves separate policy-link visit snapshots without cookie values", () => {
    const result = assessFirstEntryPolicyAccess(input({
      consentPromptDetected: false,
      thirdPartyCookieDetected: false,
      nonEssentialThirdPartyStorageDetected: false,
      consentComponentLink: null,
      informationNoticeLink: privacyLink,
      footerLink: null,
      componentLinkDocumentAccess: "not_checked",
      informationNoticeDocumentAccess: "accessible",
    }));
    const withVisit = {
      ...result,
      policyLinkVisit: {
        status: "evaluated",
        link: privacyLink,
        documentAccess: "accessible",
        navigationStartedAtMs: 120,
        beforeNavigation: {
          capturedAtMs: 80, cookies: [], storageKeys: [], cookieReadComplete: true, storageReadComplete: true,
        },
        afterNavigation: {
          capturedAtMs: 420,
          cookies: [{ name: "grumphya_anon", domain: "example.org", secure: true, httpOnly: true, sameSite: "Strict", expiresAtUnixSeconds: Date.parse("2027-12-29T00:00:00Z") / 1000 }],
          storageKeys: [], cookieReadComplete: true, storageReadComplete: true,
        },
      },
    };
    expect(parseFirstEntryPolicyAccess(withVisit)).toEqual(withVisit);
    expect(parseFirstEntryPolicyAccess({
      ...withVisit,
      policyLinkVisit: {
        ...withVisit.policyLinkVisit,
        afterNavigation: {
          ...withVisit.policyLinkVisit.afterNavigation,
          cookies: [{ name: "grumphya_anon", domain: "example.org", secure: true, httpOnly: true, sameSite: "Strict", expiresAtUnixSeconds: Date.parse("2027-12-29T00:00:00Z") / 1000, value: "secret" }],
        },
      },
    })).toBeNull();
  });

  it("requires an accessible policy link inside the consent component", () => {
    expect(assessFirstEntryPolicyAccess(input())).toMatchObject({
      status: "fail",
      reasonCode: "consent_link_missing",
      linkLocation: "none",
    });
    const result = assessFirstEntryPolicyAccess(input({
      consentComponentLink: privacyLink,
      componentLinkDocumentAccess: "accessible",
    }));
    expect(result).toMatchObject({
      status: "pass",
      reasonCode: "consent_component_link_accessible",
      linkLocation: "consent_component",
      link: privacyLink,
      documentAccess: "accessible",
    });
    expect(parseFirstEntryPolicyAccess(result)).toEqual(result);
  });

  it("allows the footer only without consent and with complete zero third-party storage", () => {
    const pass = assessFirstEntryPolicyAccess(input({
      consentPromptDetected: false,
      thirdPartyCookieDetected: false,
      nonEssentialThirdPartyStorageDetected: false,
    }));
    expect(pass).toMatchObject({ status: "pass", reasonCode: "footer_link_accessible_without_consent" });
    expect(assessFirstEntryPolicyAccess(input({
      consentPromptDetected: false,
      thirdPartyCookieDetected: false,
      nonEssentialThirdPartyStorageDetected: true,
    })).status).toBe("pass");
    expect(assessFirstEntryPolicyAccess(input({
      consentPromptDetected: false,
      thirdPartyCookieDetected: true,
      nonEssentialThirdPartyStorageDetected: false,
    }))).toMatchObject({ status: "fail", reasonCode: "footer_insufficient_with_third_party_cookies" });
    expect(assessFirstEntryPolicyAccess(input({
      consentPromptDetected: false,
      thirdPartyCookieDetected: null,
      nonEssentialThirdPartyStorageDetected: null,
    }))).toMatchObject({ status: "unknown", reasonCode: "auditor_error" });
  });

  it("passes an accessible privacy link in an informational cookie notice without consent or third-party cookies", () => {
    const result = assessFirstEntryPolicyAccess(input({
      consentPromptDetected: false,
      thirdPartyCookieDetected: false,
      nonEssentialThirdPartyStorageDetected: false,
      informationNoticeLink: privacyLink,
      informationNoticeDocumentAccess: "accessible",
    }));
    expect(result).toMatchObject({
      status: "pass",
      reasonCode: "information_notice_link_accessible_without_consent",
      linkLocation: "information_notice",
      link: privacyLink,
      documentAccess: "accessible",
    });
    expect(parseFirstEntryPolicyAccess(result)).toEqual(result);
  });

  it("keeps document access unknown when the auditor cannot verify the target", () => {
    expect(assessFirstEntryPolicyAccess(input({
      consentComponentLink: privacyLink,
      componentLinkDocumentAccess: "unknown",
    }))).toMatchObject({ status: "unknown", documentAccess: "unknown" });
  });

  it("rejects malformed or privacy-unsafe links in persisted results", () => {
    const result = assessFirstEntryPolicyAccess(input({
      consentComponentLink: privacyLink,
      componentLinkDocumentAccess: "accessible",
    }));
    expect(parseFirstEntryPolicyAccess({ ...result, link: { ...privacyLink, path: "/privacy?email=x" } })).toBeNull();
    expect(parseFirstEntryPolicyAccess({ ...result, link: { ...privacyLink, hostname: "private.example" } })).toBeNull();
    expect(parseFirstEntryPolicyAccess({ ...result, status: "pass", linkLocation: "footer" })).toBeNull();
  });
});
