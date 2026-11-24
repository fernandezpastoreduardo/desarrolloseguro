import { describe, expect, it } from "vitest";
import { parsePublicPolicyDiscoveredDocuments } from "./public-policy-document-boundary.js";

const providerDocument = {
  href: "https://provider-sample.io/privacy",
  anchorText: "Privacy documentation",
  kind: "privacy",
  documentRole: "provider_document",
  sourcePageUrl: "https://site-sample.io/privacy",
  fetchStatus: "fetched",
  sha256: "a".repeat(64),
};

describe("public policy document protocol boundary", () => {
  it("accepts a fetched provider fact with bounded source excerpt", () => {
    expect(parsePublicPolicyDiscoveredDocuments([{
      ...providerDocument,
      documentedFacts: [{
        factId: "provider_receives_personal_data",
        value: true,
        excerpt: "The provider receives personal data to deliver this service.",
      }],
    }])).toEqual([expect.objectContaining({
      documentRole: "provider_document",
      documentedFacts: [{
        factId: "provider_receives_personal_data",
        value: true,
        excerpt: "The provider receives personal data to deliver this service.",
      }],
    })]);
  });

  it("rejects provider facts attached to an audited site's own policy", () => {
    expect(parsePublicPolicyDiscoveredDocuments([{
      ...providerDocument,
      documentRole: "audited_site_policy",
      documentedFacts: [{
        factId: "provider_receives_personal_data",
        value: true,
        excerpt: "The provider receives personal data.",
      }],
    }])).toBeNull();
  });

  it("rejects facts from unavailable documents and malformed official URLs", () => {
    expect(parsePublicPolicyDiscoveredDocuments([{
      ...providerDocument,
      fetchStatus: "unavailable",
      sha256: null,
      documentedFacts: [{ factId: "provider_receives_personal_data", value: true, excerpt: "Explicit fact." }],
    }])).toBeNull();
    expect(parsePublicPolicyDiscoveredDocuments([{ ...providerDocument, href: "http://provider-sample.io/privacy" }])).toBeNull();
  });

  it("rejects unknown protocol keys and excessive document batches", () => {
    expect(parsePublicPolicyDiscoveredDocuments([{ ...providerDocument, privateData: "secret" }])).toBeNull();
    expect(parsePublicPolicyDiscoveredDocuments(Array.from({ length: 41 }, () => providerDocument))).toBeNull();
  });
});
