import { describe, expect, it } from "vitest";
import {
  assessPublicServiceComparison,
  getPublicServiceProviderInfo,
  normalizePublicServiceProviderId,
  parsePublicServiceComparison,
} from "./public-service-comparison.js";

describe("public service comparison", () => {
  it("passes when every observed service is declared with a purpose", () => {
    const result = assessPublicServiceComparison({
      observed: [{ providerId: "google-analytics", domain: "www.google-analytics.com" }],
      declared: [{ providerId: "google-analytics", purposes: ["analytics"] }],
      policyStatus: "pass",
    });
    expect(result).toMatchObject({ status: "pass", items: [{ observation: "observed_and_declared" }] });
    expect(parsePublicServiceComparison(result)).toEqual(result);
  });

  it("flags an observed service without a matching public purpose", () => {
    expect(assessPublicServiceComparison({
      observed: [{ providerId: "google-analytics", domain: "www.google-analytics.com" }],
      declared: [],
      policyStatus: "pass",
    })).toMatchObject({ status: "fail", reasonCode: "observed_service_undisclosed", items: [{ observation: "observed" }] });
  });

  it("does not penalize a declared service that was not observed", () => {
    expect(assessPublicServiceComparison({
      observed: [],
      declared: [{ providerId: "openai-api", purposes: ["ai_processing"] }],
      policyStatus: "pass",
    })).toMatchObject({ status: "pass", items: [{ observation: "declared" }] });
  });

  it("leaves auditor failures in review and rejects unsafe data", () => {
    expect(assessPublicServiceComparison({ observed: [], declared: [], policyStatus: "unknown", auditorError: true }))
      .toMatchObject({ status: "unknown", reasonCode: "auditor_error" });
    expect(parsePublicServiceComparison({
      ...assessPublicServiceComparison({ observed: [], declared: [], policyStatus: "pass" }),
      rawText: "must not persist",
    })).toBeNull();
  });

  it("rejects invalid hostnames, duplicate values, and inconsistent status reasons", () => {
    const observed = assessPublicServiceComparison({
      observed: [{ providerId: "google-analytics", domain: "bad..host" }],
      declared: [{ providerId: "google-analytics", purposes: ["analytics"] }],
      policyStatus: "fail",
    });
    expect(observed).toMatchObject({ status: "fail", reasonCode: "public_policy_missing" });
    expect(parsePublicServiceComparison({
      ...observed,
      status: "fail",
      reasonCode: "services_disclosed",
    })).toBeNull();

    const valid = assessPublicServiceComparison({
      observed: [{ providerId: "google-analytics", domain: "analytics.example" }],
      declared: [{ providerId: "google-analytics", purposes: ["analytics"] }],
      policyStatus: "pass",
    });
    expect(parsePublicServiceComparison({
      ...valid,
      items: [{ ...valid.items[0]!, observedDomains: ["analytics.example", "analytics.example"] }],
    })).toBeNull();
    expect(parsePublicServiceComparison({
      ...valid,
      items: [{ ...valid.items[0]!, observation: "observed" }],
    })).toBeNull();
  });

  it("normalizes provider aliases and exposes only known provider facts", () => {
    expect(normalizePublicServiceProviderId("Fácebook")).toBe("meta-pixel");
    expect(normalizePublicServiceProviderId("Google Ads")).toBe("google-ads-conversion-linker");
    expect(normalizePublicServiceProviderId("unknown vendor")).toBeNull();
    expect(getPublicServiceProviderInfo("openai-api")?.privacyPolicyUrl)
      .toBe("https://openai.com/policies/privacy-policy/");
    expect(getPublicServiceProviderInfo("unrecognized")).toBeNull();
  });
});
