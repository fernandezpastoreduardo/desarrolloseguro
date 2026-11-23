import { describe, expect, it } from "vitest";
import {
  assessPublicPolicyTransparency,
  parsePublicPolicyTransparencyAssessment,
} from "./public-policy-assessment.js";

describe("public policy transparency assessment", () => {
  it("passes when the public policy identifies services and purposes", () => {
    expect(assessPublicPolicyTransparency({
      linksFound: 4,
      pagesInspected: 4,
      unavailablePages: 0,
      accessDeniedPages: 0,
      providerMentions: 7,
      providersMissingPurpose: 0,
      categories: ["analytics", "advertising"],
    })).toEqual({
      policyVersion: "public-policy-v1",
      status: "pass",
      reasonCode: "disclosure_found",
      evidence: {
        linksFound: 4,
        pagesInspected: 4,
        unavailablePages: 0,
        accessDeniedPages: 0,
        providerMentions: 7,
        providersMissingPurpose: 0,
        categories: ["analytics", "advertising"],
      },
    });
  });

  it.each([
    [{ linksFound: 0, pagesInspected: 0, unavailablePages: 0, accessDeniedPages: 0, providerMentions: 0, providersMissingPurpose: 0, categories: [] }, "policy_link_missing"],
    [{ linksFound: 1, pagesInspected: 0, unavailablePages: 0, accessDeniedPages: 0, providerMentions: 0, providersMissingPurpose: 0, categories: [] }, "policy_content_missing"],
    [{ linksFound: 1, pagesInspected: 1, unavailablePages: 0, accessDeniedPages: 0, providerMentions: 0, providersMissingPurpose: 0, categories: [] }, "service_purpose_missing"],
    [{ linksFound: 1, pagesInspected: 1, unavailablePages: 0, accessDeniedPages: 1, providerMentions: 2, providersMissingPurpose: 0, categories: ["other"] }, "access_denied"],
    [{ linksFound: 1, pagesInspected: 0, unavailablePages: 1, accessDeniedPages: 0, providerMentions: 0, providersMissingPurpose: 0, categories: [] }, "policy_page_unavailable"],
  ] as const)("fails public gaps (%s)", (evidence, reasonCode) => {
    expect(assessPublicPolicyTransparency(evidence)).toMatchObject({ status: "fail", reasonCode });
  });

  it("reserves unknown for auditor errors and strips invalid or oversized details", () => {
    expect(assessPublicPolicyTransparency({
      linksFound: 31,
      pagesInspected: 2,
      unavailablePages: 0,
      accessDeniedPages: 0,
      providerMentions: 5,
      providersMissingPurpose: 0,
      categories: ["analytics", "private arbitrary content"],
    })).toMatchObject({
      status: "unknown",
      reasonCode: "auditor_error",
      evidence: { linksFound: 30, categories: [] },
    });
  });

  it("preserves unavailable page evidence and treats an exhausted approved budget as unknown", () => {
    const unavailable = assessPublicPolicyTransparency({
      linksFound: 3,
      pagesInspected: 2,
      unavailablePages: 1,
      accessDeniedPages: 0,
      providerMentions: 4,
      providersMissingPurpose: 0,
      categories: ["analytics"],
    });
    expect(unavailable).toMatchObject({ status: "fail", reasonCode: "policy_page_unavailable", evidence: { unavailablePages: 1 } });
    expect(parsePublicPolicyTransparencyAssessment(unavailable)).toEqual(unavailable);

    const exhausted = assessPublicPolicyTransparency({
      linksFound: 3,
      pagesInspected: 2,
      unavailablePages: 0,
      accessDeniedPages: 0,
      providerMentions: 0,
      providersMissingPurpose: 0,
      categories: [],
      budgetExhausted: true,
    });
    expect(exhausted).toMatchObject({ status: "unknown", reasonCode: "budget_exhausted" });
    expect(parsePublicPolicyTransparencyAssessment(exhausted)).toEqual(exhausted);
    expect(parsePublicPolicyTransparencyAssessment({
      ...exhausted,
      evidence: { ...exhausted.evidence, unavailablePages: 1 },
    })).toBeNull();
  });

  it("fails when any recognized provider lacks a purpose and bounds that count to 30", () => {
    const missingPurpose = assessPublicPolicyTransparency({
      linksFound: 1,
      pagesInspected: 1,
      unavailablePages: 0,
      accessDeniedPages: 0,
      providerMentions: 3,
      providersMissingPurpose: 1,
      categories: ["analytics"],
    });
    expect(missingPurpose).toMatchObject({
      status: "fail",
      reasonCode: "service_purpose_missing",
      evidence: { providerMentions: 3, providersMissingPurpose: 1 },
    });
    expect(parsePublicPolicyTransparencyAssessment(missingPurpose)).toEqual(missingPurpose);
    expect(assessPublicPolicyTransparency({
      linksFound: 1,
      pagesInspected: 1,
      unavailablePages: 0,
      accessDeniedPages: 0,
      providerMentions: 31,
      providersMissingPurpose: 31,
      categories: ["analytics"],
    })).toMatchObject({ status: "unknown", reasonCode: "auditor_error" });
    expect(parsePublicPolicyTransparencyAssessment({
      ...missingPurpose,
      evidence: { ...missingPurpose.evidence, providersMissingPurpose: 31 },
    })).toBeNull();
    expect(parsePublicPolicyTransparencyAssessment({
      ...missingPurpose,
      evidence: { ...missingPurpose.evidence, providersMissingPurpose: 4 },
    })).toBeNull();
  });

  it("parses only fixed fields and rejects inconsistent or raw evidence", () => {
    const valid = assessPublicPolicyTransparency({
      linksFound: 1,
      pagesInspected: 1,
      unavailablePages: 0,
      accessDeniedPages: 0,
      providerMentions: 1,
      providersMissingPurpose: 0,
      categories: ["other"],
    });
    expect(parsePublicPolicyTransparencyAssessment({ ...valid, rawText: "private body" })).toBeNull();
    expect(parsePublicPolicyTransparencyAssessment({ ...valid, status: "fail" })).toBeNull();
    expect(parsePublicPolicyTransparencyAssessment(valid)).toEqual(valid);
  });
});
