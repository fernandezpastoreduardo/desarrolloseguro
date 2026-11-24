import { describe, expect, it } from "vitest";
import {
  assessPublicServiceComparison,
  getPublicServiceProviderInfo,
  normalizePublicServiceProviderId,
  parsePublicServiceDeclarations,
  parsePublicServiceComparison,
} from "./public-service-comparison.js";
import { compareProviderDocumentation } from "./provider-documentation-contradictions.js";

describe("public service comparison", () => {
  it("parses bounded declarations and preserves explicit source evidence", () => {
    const statement = {
      factId: "provider_receives_content",
      value: false,
      basis: "explicit_claim",
      source: {
        sourceId: "site-policy", version: "scan-1", title: "Privacy notice",
        url: "https://site.example/privacy", capturedAt: "2026-11-24T03:00:00Z",
        excerpt: "No se envía contenido a proveedores externos.",
        documentKind: "privacy", sourceKind: "audited_site",
      },
    };
    expect(parsePublicServiceDeclarations([{
      providerId: "openai-api", purposes: ["ai_processing"], siteStatements: [statement],
    }])).toEqual([{
      providerId: "openai-api", purposes: ["ai_processing"], siteStatements: [statement],
    }]);
    expect(parsePublicServiceDeclarations([])).toEqual([]);
    expect(parsePublicServiceDeclarations([{
      providerId: "openai-api", purposes: ["ai_processing", "ai_processing"],
    }])).toBeNull();
    expect(parsePublicServiceDeclarations([
      { providerId: "openai-api", purposes: [] },
      { providerId: "openai-api", purposes: [] },
    ])).toBeNull();
  });

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

  it("includes a source-backed provider contradiction in the assessed result and score input", () => {
    const siteSource = {
      sourceId: "site-policy",
      version: "scan-1",
      title: "Política de privacidad",
      url: "https://site.example/privacy",
      capturedAt: "2026-11-24T03:00:00Z",
      excerpt: "No enviamos contenido a OpenAI.",
      documentKind: "privacy" as const,
      sourceKind: "audited_site" as const,
    };
    const providerSource = {
      sourceId: "openai-api-data-controls",
      version: "catalog-1",
      title: "OpenAI API data controls",
      url: "https://developers.openai.com/api/docs/guides/your-data",
      capturedAt: "2026-11-24T03:00:00Z",
      excerpt: "OpenAI documents retention of submitted API content for abuse monitoring.",
      documentKind: "service" as const,
      sourceKind: "provider_official" as const,
    };
    const contradiction = compareProviderDocumentation({
      providerId: "openai-api",
      sourceStatus: "located",
      siteStatements: [{
        factId: "provider_receives_content",
        value: false,
        basis: "explicit_claim",
        source: siteSource,
      }],
      providerFacts: [{ factId: "provider_receives_content", value: true, source: providerSource }],
    });
    expect(contradiction?.status).toBe("contradiction_confirmed");
    const result = assessPublicServiceComparison({
      observed: [],
      declared: [{ providerId: "openai-api", purposes: ["ai_processing"] }],
      policyStatus: "pass",
      providerDocumentation: contradiction ? [contradiction] : [],
    });
    expect(result).toMatchObject({
      status: "fail",
      reasonCode: "provider_documentation_contradiction",
      providerDocumentation: [{ status: "contradiction_confirmed", comparisons: [{ relation: "opposes" }] }],
    });
    expect(parsePublicServiceComparison(result)).toEqual(result);
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
    expect(parsePublicServiceComparison({ ...valid, reasonCode: "public_policy_missing" })).toBeNull();
    expect(parsePublicServiceComparison({
      ...valid,
      items: [
        { providerId: "google-analytics", observation: "observed_and_declared", observedDomains: ["a.example"], declaredPurposes: ["analytics"] },
        { providerId: "openai-api", observation: "declared", observedDomains: [], declaredPurposes: ["ai_processing"] },
      ],
    })).toMatchObject({ status: "pass", items: [{ providerId: "google-analytics" }, { providerId: "openai-api" }] });
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
