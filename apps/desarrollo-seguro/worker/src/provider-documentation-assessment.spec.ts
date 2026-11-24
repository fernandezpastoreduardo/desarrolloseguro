import { describe, expect, it } from "vitest";
import type { ProviderCatalogSnapshot } from "@desarrolloseguro/persistence/provider-catalog";
import { PROVIDER_LEGAL_RULES, type ProviderEvidenceSource } from "@desarrolloseguro/core";
import { assessCatalogProviderDocumentation, mergeProviderDocumentationComparison } from "./provider-documentation-assessment.js";
import type { ProviderLegalEvidenceContext } from "./provider-legal-evidence-builder.js";

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

  it("keeps a proven contradiction but withholds the legal finding when required evidence is missing", () => {
    const result = assessCatalogProviderDocumentation({
      declarations: [{ providerId: "openai-api", purposes: ["ai_processing"], siteStatements: [{ ...siteStatement, factId: "provider_receives_personal_data" }] }],
      snapshot: snapshotWithPersonalDataFact(),
    });
    expect(result[0]).toMatchObject({
      status: "contradiction_confirmed",
      comparisons: [{ relation: "opposes", legalMappingStatus: "elements_not_satisfied" }],
    });
  });

  it("passes direct per-element evidence to the legal rule and emits its mapped finding", () => {
    const result = assessCatalogProviderDocumentation({
      declarations: [{ providerId: "openai-api", purposes: ["ai_processing"], siteStatements: [{ ...siteStatement, factId: "provider_receives_personal_data" }] }],
      legalEvidenceContexts: { "openai-api": completeLegalEvidenceContext() },
      snapshot: snapshotWithPersonalDataFact(),
    });
    expect(result[0]?.comparisons[0]?.legalFinding).toMatchObject({
      status: "infraccion_legal_acreditada",
      ruleId: "gdpr-recipient-disclosure-article-13-v1",
      articles: expect.arrayContaining(["12(1)", "13(1)(e)", "83(5)(b)"]),
    });
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

function snapshotWithPersonalDataFact(): ProviderCatalogSnapshot {
  const seed = snapshot();
  const provider = seed.providerFacts[0] as { documentedFacts: Array<Record<string, unknown>> };
  provider.documentedFacts.push({
    factId: "provider_receives_personal_data",
    value: true,
    documentId: "openai-api-data-controls",
    excerpt: "The provider documents processing of the user's personal data submitted to this service.",
  });
  seed.legalRules = Object.values(PROVIDER_LEGAL_RULES);
  return seed;
}

function completeLegalEvidenceContext(): ProviderLegalEvidenceContext {
  return {
    dataOrigin: { value: "obtained_from_subject", evidence: [evidenceSource("origin", "audited_site")] },
    personalDataInFlow: { basis: "direct_personal_data_flow", evidence: [evidenceSource("flow", "auditor_observation")] },
    auditedEntityIsController: { evidence: [evidenceSource("controller", "audited_site")] },
    aepdJurisdictionIsEstablished: { evidence: [evidenceSource("jurisdiction", "audited_site")] },
  };
}

function evidenceSource(sourceId: string, sourceKind: ProviderEvidenceSource["sourceKind"]): ProviderEvidenceSource {
  return {
    sourceId,
    version: "fixture-v1",
    title: "Prueba directa de auditoría",
    url: `https://${sourceKind === "provider_official" ? "provider.example" : "site.example"}/${sourceId}`,
    capturedAt: "2026-11-24T03:00:00.000Z",
    excerpt: "Evidencia directa para una prueba de integración.",
    documentKind: sourceKind === "auditor_observation" ? "technical-evidence" : "privacy",
    sourceKind,
  };
}
