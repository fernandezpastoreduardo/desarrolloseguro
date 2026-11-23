import { describe, expect, it } from "vitest";
import { matchPrivacySignal, type PrivacyKnowledgeRule, type PrivacyObservedSignal } from "./privacy-knowledge-base.js";
import { PRIVACY_KNOWLEDGE_RULES } from "./privacy-knowledge-catalog.js";

const source = {
  url: "https://vendor.example/privacy",
  revision: "2026-11-01",
  license: "Vendor documentation",
  reviewedAt: "2026-11-21",
};

function rule(overrides: Partial<PrivacyKnowledgeRule> = {}): PrivacyKnowledgeRule {
  return {
    ruleId: "vendor-cookie",
    datasetVersion: "privacy-knowledge-v1",
    signalType: "cookie_name",
    pattern: "_vendor_analytics",
    match: "exact",
    category: "analytics",
    provider: "Vendor",
    providerHostnames: ["vendor.example"],
    purpose: "Usage analytics",
    source,
    confidence: "high",
    knownFalsePositives: [],
    ...overrides,
  };
}

const cookie: PrivacyObservedSignal = {
  signalType: "cookie_name",
  value: "_vendor_analytics",
  observedHostname: "cdn.vendor.example",
};

describe("local privacy knowledge base", () => {
  it("uses the reviewed local Analytics catalog and its recorded source metadata", () => {
    expect(PRIVACY_KNOWLEDGE_RULES.length).toBeGreaterThan(0);
    expect(PRIVACY_KNOWLEDGE_RULES.every((rule) =>
      rule.source.url.startsWith("https://") && rule.source.license.length > 10 &&
      /^2026-11-\d{2}$/u.test(rule.source.reviewedAt) && rule.confidence === "high",
    )).toBe(true);
    expect(PRIVACY_KNOWLEDGE_RULES.some((rule) => rule.source.license.includes("NC"))).toBe(false);
  });

  it("requires a same-flow vendor hostname to confirm a first-party Analytics cookie", () => {
    const signal: PrivacyObservedSignal = {
      signalType: "cookie_name",
      value: "_ga",
      observedHostname: "example.com",
    };
    const withoutHost = matchPrivacySignal(signal, PRIVACY_KNOWLEDGE_RULES);
    expect(withoutHost).toHaveLength(1);
    expect(withoutHost[0]?.classification).toBe("unknown");

    const corroborated = matchPrivacySignal({
      ...signal,
      corroboratingHostnames: ["region1.google-analytics.com"],
    }, PRIVACY_KNOWLEDGE_RULES);
    expect(corroborated).toHaveLength(1);
    expect(corroborated[0]?.classification).toBe("confirmed");
  });

  it("confirms a high-confidence literal match with an attributable provider hostname", () => {
    const [match] = matchPrivacySignal(cookie, [rule()]);

    expect(match?.classification).toBe("confirmed");
    expect(match?.source.reviewedAt).toBe("2026-11-21");
  });

  it("leaves low-confidence patterns and missing host attribution as unknown", () => {
    expect(matchPrivacySignal(cookie, [rule({ confidence: "low" })])[0]?.classification).toBe("unknown");
    expect(matchPrivacySignal({ ...cookie, observedHostname: "grumphya.com" }, [rule()])[0]?.classification).toBe("unknown");
  });

  it("marks conflicting local rules unknown instead of selecting a provider", () => {
    const matches = matchPrivacySignal(cookie, [
      rule(),
      rule({ ruleId: "other-vendor-cookie", provider: "Other vendor", providerHostnames: ["other.example"] }),
    ]);

    expect(matches).toHaveLength(2);
    expect(matches.every(({ classification }) => classification === "unknown")).toBe(true);
  });

  it("uses hostname boundaries for provider attribution", () => {
    const matches = matchPrivacySignal({ ...cookie, observedHostname: "vendor.example.attacker.test" }, [rule()]);

    expect(matches[0]?.classification).toBe("unknown");
  });

  it("supports exact and anchored-prefix signals without running regex patterns", () => {
    expect(matchPrivacySignal({ ...cookie, value: "_vendor_analytics_extra" }, [rule()])).toEqual([]);
    const [prefixMatch] = matchPrivacySignal(
      { ...cookie, signalType: "storage_key", value: "storage:analytics-session" },
      [rule({ signalType: "storage_key", pattern: "storage:analytics-", match: "prefix" })],
    );
    expect(prefixMatch?.classification).toBe("confirmed");
  });

  it("extracts script hostnames without retaining URL paths or query strings", () => {
    const [match] = matchPrivacySignal({
      signalType: "script_url",
      value: "https://cdn.vendor.example/pixel.js?user=secret",
      observedHostname: "cdn.vendor.example",
    }, [rule({ signalType: "script_url", pattern: "vendor.example", match: "prefix" })]);

    expect(match?.classification).toBe("confirmed");
    expect(JSON.stringify(match)).not.toContain("secret");
  });

  it("recognizes Matomo Cloud only from its observed host and records no request path", () => {
    const [match] = matchPrivacySignal({
      signalType: "request_host",
      value: "eu.matomo.cloud",
      observedHostname: "eu.matomo.cloud",
    }, PRIVACY_KNOWLEDGE_RULES);

    expect(match?.provider).toBe("Matomo");
    expect(match?.classification).toBe("confirmed");
    expect(JSON.stringify(match)).not.toMatch(/matomo\.(?:js|php)/u);
  });

  it("requires a same-flow Matomo Cloud host to attribute a first-party Matomo cookie", () => {
    const signal: PrivacyObservedSignal = {
      signalType: "cookie_name",
      value: "_pk_id",
      observedHostname: "site.example",
    };
    const [unknown] = matchPrivacySignal(signal, PRIVACY_KNOWLEDGE_RULES);
    const [confirmed] = matchPrivacySignal({
      ...signal,
      corroboratingHostnames: ["eu.matomo.cloud"],
    }, PRIVACY_KNOWLEDGE_RULES);

    expect(unknown?.classification).toBe("unknown");
    expect(confirmed?.provider).toBe("Matomo");
    expect(confirmed?.classification).toBe("confirmed");
  });
});
