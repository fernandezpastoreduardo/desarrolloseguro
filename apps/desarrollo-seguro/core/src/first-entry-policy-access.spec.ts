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
