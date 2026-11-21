import { describe, expect, it } from "vitest";
import { isThirdPartyPrivacyHost, PRIVACY_BROWSER_BUDGET, PRIVACY_EXCESS_THRESHOLDS } from "./privacy-policy.js";

describe("privacy policy v1", () => {
  it("treats www as the root hostname alias but other hosts as third parties", () => {
    expect(isThirdPartyPrivacyHost("grumphya.com", "www.grumphya.com")).toBe(false);
    expect(isThirdPartyPrivacyHost("www.grumphya.com", "grumphya.com")).toBe(false);
    expect(isThirdPartyPrivacyHost("grumphya.com", "img.grumphya.com")).toBe(true);
    expect(isThirdPartyPrivacyHost("grumphya.com", "google-analytics.com")).toBe(true);
  });

  it("normalizes case and a terminal DNS dot before comparing", () => {
    expect(isThirdPartyPrivacyHost("grumphya.com.", "WWW.Grumphya.com")).toBe(false);
  });

  it("publishes approved v1 thresholds and browser budgets", () => {
    expect(PRIVACY_EXCESS_THRESHOLDS).toEqual({ cookiesPerProviderAndPurpose: 5, cookiesPerPurpose: 10 });
    expect(PRIVACY_BROWSER_BUDGET).toEqual({
      durationMs: 120_000,
      requests: 300,
      receivedBytes: 20 * 1024 * 1024,
      individualProviders: 30,
      contexts: 8,
    });
  });
});
