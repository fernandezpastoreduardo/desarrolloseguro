import { describe, expect, it } from "vitest";
import type { ProviderCatalogSnapshot } from "@desarrolloseguro/persistence/provider-catalog";
import { assessCatalogProviderDocumentation, mergeProviderDocumentationComparison } from "./provider-documentation-assessment.js";

const siteStatement = {
  providerId: "openai-api",
  factId: "provider_receives_content",
  value: false,
  basis: "explicit_claim" as const,
  excerpt: "No enviamos contenido a OpenAI.",
  source: {
    sourceId: "site-privacy-policy",
    version: "scan-v1",
    title: "Política de privacidad",
    url: "https://site.example/privacy",
    capturedAt: "2026-11-24T03:00:00Z",
    excerpt: "No enviamos contenido a OpenAI.",
    documentKind: "privacy" as const,
    sourceKind: "audited_site" as const,
  },
};

describe("catalog provider documentation assessment", () => {
  it("compares explicit site statements with an official fact from the loaded snapshot", () => {
    const findings = assessCatalogProviderDocumentation({
      declarations: [{ providerId: "openai-api", purposes: ["ai_processing"], siteStatements: [siteStatement] }],
      snapshot: snapshot(),
    });
    expect(findings).toMatchObject([{
      providerId: "openai-api",
      status: "contradiction_confirmed",
      comparisons: [{
        factId: "provider_receives_content",
        relation: "opposes",
        providerFact: {
          sourceId: "openai-api-data-controls",
          version: "b".repeat(64),
          sourceKind: "provider_official",
        },
      }],
    }]);
    const merged = mergeProviderDocumentationComparison({
      policyVersion: "public-service-comparison-v1",
      status: "pass",
      reasonCode: "services_disclosed",
      items: [],
    }, findings);
    expect(merged).toMatchObject({ status: "fail", reasonCode: "provider_documentation_contradiction" });
  });

  it("does not use unverified or unavailable catalog sources as provider facts", () => {
    const seed = snapshot();
    seed.sources[0]!.status = "seeded";
    seed.sources[0]!.sha256 = null;
    expect(assessCatalogProviderDocumentation({
      declarations: [{ providerId: "openai-api", purposes: ["ai_processing"], siteStatements: [siteStatement] }],
      snapshot: seed,
    })[0]?.status).toBe("not_comparable");
    seed.sources[0]!.status = "unavailable";
    expect(assessCatalogProviderDocumentation({
      declarations: [{ providerId: "openai-api", purposes: ["ai_processing"], siteStatements: [siteStatement] }],
      snapshot: seed,
    })[0]?.status).toBe("not_comparable");
  });

  it("retains the official URL and retrieval status when a known source is unavailable", () => {
    const seed = snapshot();
    seed.providerFacts[0] = { ...seed.providerFacts[0] as object, documentationStatus: "source_unavailable" };
    seed.sources[0]!.status = "unavailable";
    seed.sources[0]!.sha256 = null;
    const result = assessCatalogProviderDocumentation({
      declarations: [{ providerId: "openai-api", purposes: ["ai_processing"], siteStatements: [siteStatement] }],
      snapshot: seed,
    });
    expect(result[0]).toMatchObject({
      status: "source_unavailable",
      sourceEvidence: [{
        documentId: "openai-api-data-controls",
        url: "https://developers.openai.com/api/docs/guides/your-data",
        status: "unavailable",
        sha256: null,
      }],
    });
  });

  it("reports an observed destination with no official documents as source not localized", () => {
    expect(assessCatalogProviderDocumentation({
      declarations: undefined,
      observedProviderIds: ["dst_unknown_example_1234567"],
      snapshot: {
        ...snapshot(),
        providerFacts: [{ providerId: "dst_unknown_example_1234567", documentationStatus: "source_not_localized", officialDocuments: [], documentedFacts: [] }],
        sources: [],
      },
    })).toEqual([{
      providerId: "dst_unknown_example_1234567",
      status: "source_not_located",
      reasonCode: "official_source_not_located",
      comparisons: [],
    }]);
  });
});

function snapshot(): ProviderCatalogSnapshot {
  return {
    catalogVersion: "a".repeat(64),
    providerFacts: [{
      providerId: "openai-api",
      documentationStatus: "located",
      officialDocuments: [{
        documentId: "openai-api-data-controls",
        kind: "service-documentation",
        title: "OpenAI API data controls",
        url: "https://developers.openai.com/api/docs/guides/your-data",
      }],
      documentedFacts: [{
        factId: "provider_receives_content",
        value: true,
        documentId: "openai-api-data-controls",
        excerpt: "OpenAI documents API inputs and outputs and default abuse monitoring.",
      }],
    }],
    legalRules: [],
    sources: [{
      providerId: "openai-api",
      documentId: "openai-api-data-controls",
      title: "OpenAI API data controls",
      url: "https://developers.openai.com/api/docs/guides/your-data",
      status: "fetched",
      sha256: "b".repeat(64),
      checkedAt: "2026-11-24T03:00:00Z",
    }],
    createdAt: new Date("2026-11-24T03:00:00Z"),
  };
}
