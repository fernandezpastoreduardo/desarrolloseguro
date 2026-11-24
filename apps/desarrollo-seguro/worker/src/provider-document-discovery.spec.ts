import { describe, expect, it } from "vitest";
import { toCatalogedProviderDocumentDiscovery } from "./provider-document-discovery.js";
import type { PublicPolicyDiscoveredDocument } from "./public-policy-document-boundary.js";

const providerFacts = [{
  providerId: "openai-api",
  displayName: "OpenAI API",
  officialDocuments: [{
    kind: "dpa",
    title: "Data Processing Addendum",
    url: "https://openai.com/policies/data-processing-addendum/",
  }],
}];

function discoveredDocument(overrides: Partial<PublicPolicyDiscoveredDocument> = {}): PublicPolicyDiscoveredDocument {
  return {
    href: "https://openai.com/policies/data-processing-addendum/",
    anchorText: "OpenAI Data Processing Addendum",
    kind: "legal",
    documentRole: "provider_document",
    sourcePageUrl: "https://audited.example/privacy",
    fetchStatus: "fetched",
    sha256: "a".repeat(64),
    documentedFacts: [{
      factId: "provider_receives_personal_data",
      value: true,
      excerpt: "We may receive personal data submitted to the API to provide the service.",
    }],
    ...overrides,
  };
}

describe("toCatalogedProviderDocumentDiscovery", () => {
  it("creates deterministic provider evidence for one exact official URL and keeps the official fact with its hash", () => {
    const input = { document: discoveredDocument(), providerFacts, capturedAt: "2026-11-24T10:00:00.000Z" };
    const first = toCatalogedProviderDocumentDiscovery(input);
    const repeated = toCatalogedProviderDocumentDiscovery({
      ...input,
      capturedAt: "2026-11-25T10:00:00.000Z",
    });

    expect(first).toMatchObject({
      providerId: "openai-api",
      evidence: { kind: "explicit_site_reference", url: "https://audited.example/privacy" },
      officialDocuments: [{
        url: "https://openai.com/policies/data-processing-addendum/",
        status: "fetched",
        sha256: "a".repeat(64),
        documentedFacts: [{
          factId: "provider_receives_personal_data",
          value: true,
          excerpt: "We may receive personal data submitted to the API to provide the service.",
        }],
      }],
    });
    expect(repeated?.evidence.sourceId).toBe(first?.evidence.sourceId);
    expect(repeated?.officialDocuments[0]?.documentId).toBe(first?.officialDocuments[0]?.documentId);
  });

  it("does not attribute a URL shared by multiple catalog providers", () => {
    const ambiguousProviders = ["openai-api", "openai-enterprise"].map((providerId) => ({
      providerId,
      displayName: providerId,
      privacyPolicyUrl: "https://openai.com/policies/data-processing-addendum/",
    }));
    expect(toCatalogedProviderDocumentDiscovery({
      document: discoveredDocument(),
      providerFacts: ambiguousProviders,
      capturedAt: "2026-11-24T10:00:00.000Z",
    })).toBeNull();
  });

  it("never treats an audited-site policy as provider evidence", () => {
    const result = toCatalogedProviderDocumentDiscovery({
      document: discoveredDocument({ documentRole: "audited_site_policy" }),
      providerFacts,
      capturedAt: "2026-11-24T10:00:00.000Z",
    });
    expect(result?.officialDocuments[0]).not.toHaveProperty("documentedFacts");
  });

  it("does not catalog links that were not fetched or could not be attributed", () => {
    expect(toCatalogedProviderDocumentDiscovery({
      document: discoveredDocument({ fetchStatus: "not_fetched", sha256: null, documentedFacts: undefined }),
      providerFacts,
      capturedAt: "2026-11-24T10:00:00.000Z",
    })).toBeNull();
    expect(toCatalogedProviderDocumentDiscovery({
      document: discoveredDocument({ href: "https://openai.com/policies/unknown-document/" }),
      providerFacts,
      capturedAt: "2026-11-24T10:00:00.000Z",
    })).toBeNull();
  });
});
