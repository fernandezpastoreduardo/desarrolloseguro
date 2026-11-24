import type { LookupAddress } from "node:dns";
import { createHash } from "node:crypto";
import type { LookupFunction } from "node:net";
import { describe, expect, it, vi } from "vitest";
import {
  collectPublicPolicyEvidence,
  createPublicPolicyPinnedLookup,
  PUBLIC_POLICY_CRAWL_LIMITS,
  type PublicPolicyClassification,
  type PublicPolicyDocumentRequest,
  type PublicPolicyDocumentResponse,
} from "./public-policy-crawler.js";

const HOME_HTML = `
  <a href="https://privacy.vendor.example.com/privacy?user=private#vendors">Privacy policy</a>
`;
const DISCLOSURE_HTML = "<p>We use Vendor Example for analytics and hosting purposes.</p>";
const CLASSIFICATION: PublicPolicyClassification = {
  providerIds: ["vendor-example"],
  providersWithPurpose: ["vendor-example"],
  purposeIds: ["analytics", "hosting"],
  categories: ["analytics", "infrastructure"],
};

function response(
  values: Partial<PublicPolicyDocumentResponse> = {},
): PublicPolicyDocumentResponse {
  return {
    statusCode: 200,
    contentType: "text/html; charset=utf-8",
    html: DISCLOSURE_HTML,
    requestsCount: 1,
    bytesCount: Buffer.byteLength(DISCLOSURE_HTML),
    redirectCount: 0,
    ...values,
  };
}

function collect(
  fetchDocument: (request: PublicPolicyDocumentRequest) => Promise<PublicPolicyDocumentResponse>,
  options: {
    html?: string;
    classifyHtml?: (html: string) => PublicPolicyClassification;
    budget?: { durationMs: number; requests: number; bytes: number };
    now?: () => number;
  } = {},
) {
  return collectPublicPolicyEvidence({
    hostname: "example.com",
    html: options.html ?? HOME_HTML,
    initialPageInspectable: true,
    initialStatusCode: 200,
    signal: new AbortController().signal,
    fetchDocument,
    classifyHtml: options.classifyHtml ?? (() => CLASSIFICATION),
    ...(options.budget ? { budget: options.budget } : {}),
    ...(options.now ? { now: options.now } : {}),
  });
}

describe("collectPublicPolicyEvidence", () => {
  it.each([401, 403, 429, 451])("classifies initial HTTP %s as access denied", async (initialStatusCode) => {
    const result = await collectPublicPolicyEvidence({
      hostname: "example.com",
      html: "",
      initialPageInspectable: false,
      initialStatusCode,
      signal: new AbortController().signal,
      fetchDocument: async () => response(),
      classifyHtml: () => CLASSIFICATION,
    });

    expect(result).toMatchObject({ status: "fail", reasonCode: "access_denied", initialStatusCode });
  });

  it.each([404, 410, 500, 503])("classifies initial HTTP %s as unavailable", async (initialStatusCode) => {
    const evidence = await collectPublicPolicyEvidence({
      hostname: "example.com",
      html: "",
      initialPageInspectable: false,
      initialStatusCode,
      signal: new AbortController().signal,
      fetchDocument: async () => response(),
      classifyHtml: () => CLASSIFICATION,
    });

    expect(evidence).toMatchObject({
      status: "fail",
      reasonCode: "policy_page_unavailable",
      initialStatusCode,
      unavailablePages: 1,
    });
  });

  it("leaves an unsupported initial document in review and fails an inspectable page without policy links", async () => {
    const unsupported = await collectPublicPolicyEvidence({
      hostname: "example.com",
      html: "",
      initialPageInspectable: false,
      initialStatusCode: 200,
      signal: new AbortController().signal,
      fetchDocument: async () => response(),
      classifyHtml: () => CLASSIFICATION,
    });
    const noLinks = await collect(async () => response(), { html: "<html><body>Home</body></html>" });

    expect(unsupported).toMatchObject({ status: "unknown", reasonCode: "auditor_error", initialPageInspectable: false });
    expect(noLinks).toMatchObject({ status: "fail", reasonCode: "no_policy_links", initialPageInspectable: true, initialStatusCode: 200 });
  });

  it("follows only extracted HTTPS host/path pairs and returns bounded aggregates", async () => {
    const fetchDocument = vi.fn(async (request: PublicPolicyDocumentRequest) => {
      expect(request.method).toBe("GET");
      return response();
    });

    const evidence = await collect(fetchDocument);

    expect(fetchDocument).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
      method: "GET",
      hostname: "privacy.vendor.example.com",
      path: "/privacy",
      timeoutMs: expect.any(Number),
      signal: expect.any(AbortSignal),
    }));
    expect(evidence).toMatchObject({
      policyVersion: "public-policy-v1",
      status: "pass",
      initialPageInspectable: true,
      initialStatusCode: 200,
      reasonCode: "disclosure_found",
      linksFound: 1,
      pagesInspected: 1,
      providers: ["vendor-example"],
      providersWithPurpose: ["vendor-example"],
      purposes: ["analytics", "hosting"],
      categories: ["analytics", "infrastructure"],
    });
    expect(evidence.discoveredDocuments).toContainEqual(expect.objectContaining({
      href: "https://privacy.vendor.example.com/privacy",
      anchorText: "Privacy policy",
      sourcePageUrl: "https://example.com/",
      fetchStatus: "fetched",
      sha256: expect.stringMatching(/^[a-f0-9]{64}$/u),
    }));
    expect(JSON.stringify(evidence)).not.toContain("user=private");
    expect(JSON.stringify(evidence)).not.toContain(DISCLOSURE_HTML);
    expect(evidence).not.toHaveProperty("html");
  });

  it("fetches explicit provider document links with provenance without classifying provider HTML as site claims", async () => {
    const dpaHtml = "<p>Vendor Example processes data.</p>";
    const serviceHtml = "<p>Service documentation.</p>";
    const classifyHtml = vi.fn(() => CLASSIFICATION);
    const fetchDocument = vi.fn(async (request: PublicPolicyDocumentRequest) => request.path === "/privacy"
      ? response({
        html: `<a href="https://vendor.example.net/dpa?session=private#terms">Data Processing Addendum</a>
          <a href="/docs/service">Service documentation</a>`,
      })
      : response({ html: request.path === "/dpa" ? dpaHtml : serviceHtml }));

    const evidence = await collectPublicPolicyEvidence({
      hostname: "example.com",
      links: [{ hostname: "privacy.example.com", path: "/privacy", kind: "privacy" }],
      initialPageInspectable: true,
      initialStatusCode: 200,
      signal: new AbortController().signal,
      fetchDocument,
      classifyHtml,
    });

    expect(evidence.discoveredDocuments).toContainEqual(expect.objectContaining({
      href: "https://vendor.example.net/dpa",
      anchorText: "Data Processing Addendum",
      kind: "legal",
      sourcePageUrl: "https://privacy.example.com/privacy",
      fetchStatus: "fetched",
      sha256: createHash("sha256").update(dpaHtml).digest("hex"),
    }));
    expect(evidence.discoveredDocuments).toContainEqual(expect.objectContaining({
      href: "https://privacy.example.com/docs/service",
      anchorText: "Service documentation",
      sourcePageUrl: "https://privacy.example.com/privacy",
      fetchStatus: "fetched",
      sha256: createHash("sha256").update(serviceHtml).digest("hex"),
    }));
    expect(JSON.stringify(evidence)).not.toContain("session=private");
    expect(fetchDocument).toHaveBeenCalledTimes(3);
    expect(classifyHtml).toHaveBeenCalledTimes(1);
    expect(classifyHtml).toHaveBeenCalledWith(expect.stringContaining("Data Processing Addendum"));
    expect(classifyHtml).not.toHaveBeenCalledWith(dpaHtml);
    expect(classifyHtml).not.toHaveBeenCalledWith(serviceHtml);
  });

  it("keeps discovered documents not fetched when the shared request budget is exhausted", async () => {
    const fetchDocument = vi.fn(async () => response({
      html: `<a href="https://vendor.example.net/dpa">Data Processing Addendum</a>`,
    }));
    const evidence = await collectPublicPolicyEvidence({
      hostname: "example.com",
      links: [{ hostname: "privacy.example.com", path: "/privacy", kind: "privacy" }],
      initialPageInspectable: true,
      initialStatusCode: 200,
      signal: new AbortController().signal,
      fetchDocument,
      classifyHtml: () => CLASSIFICATION,
      budget: { durationMs: 30_000, requests: 1, bytes: 64 * 1024 },
    });

    expect(fetchDocument).toHaveBeenCalledTimes(1);
    expect(evidence.discoveredDocuments).toContainEqual(expect.objectContaining({
      href: "https://vendor.example.net/dpa",
      fetchStatus: "not_fetched",
      sha256: null,
    }));
  });

  it.each([
    { label: "HTTP unavailable", response: response({ statusCode: 404, html: "" }), fetchStatus: "unavailable", failureCode: undefined },
    { label: "unsupported content type", response: response({ contentType: "application/pdf", html: "" }), fetchStatus: "failed", failureCode: "unsupported_content_type" },
  ])("preserves $label receipt for a linked provider document", async ({ response: documentResponse, fetchStatus, failureCode }) => {
    const fetchDocument = vi.fn(async (request: PublicPolicyDocumentRequest) => request.path === "/privacy"
      ? response({ html: `<a href="https://vendor.example.net/dpa">Data Processing Addendum</a>` })
      : documentResponse);
    const linkEvidence = await collectPublicPolicyEvidence({
      hostname: "example.com",
      links: [{ hostname: "privacy.example.com", path: "/privacy", kind: "privacy" }],
      initialPageInspectable: true,
      initialStatusCode: 200,
      signal: new AbortController().signal,
      fetchDocument,
      classifyHtml: () => CLASSIFICATION,
    });

    expect(linkEvidence.status).toBe("pass");
    expect(linkEvidence.discoveredDocuments).toContainEqual(expect.objectContaining({
      href: "https://vendor.example.net/dpa",
      fetchStatus,
      sha256: null,
      ...(failureCode ? { failureCode } : {}),
    }));
  });

  it("marks a missing public policy link as a transparency failure", async () => {
    const fetchDocument = vi.fn(async () => response());

    const evidence = await collect(fetchDocument, { html: "<a href='/contact'>Contact</a>" });

    expect(fetchDocument).not.toHaveBeenCalled();
    expect(evidence).toMatchObject({ status: "fail", reasonCode: "no_policy_links", linksFound: 0 });
  });

  it("marks a policy without identifiable service or purpose declarations as a failure", async () => {
    const evidence = await collect(async () => response(), {
      classifyHtml: () => ({ providerIds: [], providersWithPurpose: [], purposeIds: [], categories: [] }),
    });

    expect(evidence).toMatchObject({ status: "fail", reasonCode: "disclosure_missing" });
  });

  it("does not treat a recognized provider name as proof its purpose is explained", async () => {
    const evidence = await collect(async () => response(), {
      classifyHtml: () => ({
        providerIds: ["vendor-example"],
        providersWithPurpose: [],
        purposeIds: [],
        categories: [],
      }),
    });

    expect(evidence).toMatchObject({ status: "fail", reasonCode: "disclosure_missing" });
    expect(evidence.providers).toEqual(["vendor-example"]);
    expect(evidence.providersWithPurpose).toEqual([]);
  });

  it("combines provider-specific declarations from each public policy page", async () => {
    const evidence = await collectPublicPolicyEvidence({
      hostname: "example.com",
      links: [
        { hostname: "privacy.example.com", path: "/privacy", kind: "privacy" },
        { hostname: "vendor.example.net", path: "/terms", kind: "legal" },
      ],
      initialPageInspectable: true,
      initialStatusCode: 200,
      signal: new AbortController().signal,
      fetchDocument: async () => response(),
      classifyHtml: () => ({
        providerIds: ["vendor-example"],
        providersWithPurpose: ["vendor-example"],
        purposeIds: ["analytics"],
        categories: ["analytics"],
        declaredServices: [{ providerId: "vendor-example", purposeIds: ["analytics"] }],
      }),
    });

    expect(evidence).toMatchObject({
      status: "pass",
      pagesInspected: 2,
      declaredServices: [{ providerId: "vendor-example", purposeIds: ["analytics"] }],
    });
  });

  it("attaches a stable first-party document source to each explicit site statement", async () => {
    const capturedAt = new Date("2026-11-24T03:00:00.000Z");
    const evidence = await collectPublicPolicyEvidence({
      hostname: "example.com",
      links: [{ hostname: "privacy.example.com", path: "/privacy", kind: "privacy" }],
      initialPageInspectable: true,
      initialStatusCode: 200,
      signal: new AbortController().signal,
      fetchDocument: async () => response(),
      classifyHtml: () => ({
        providerIds: ["vendor-example"],
        providersWithPurpose: [],
        purposeIds: [],
        categories: [],
        documentTitle: "Privacy Notice",
        siteStatements: [{
          providerId: "vendor-example",
          factId: "provider_receives_personal_data",
          value: true,
          basis: "explicit_claim",
          excerpt: "Vendor Example receives personal data submitted by account holders.",
        }],
      }),
      captureAt: () => capturedAt,
    });

    const statement = evidence.declaredServices[0]?.siteStatements?.[0];
    expect(statement).toMatchObject({
      factId: "provider_receives_personal_data",
      value: true,
      basis: "explicit_claim",
      source: {
        version: "public-policy-source-v1",
        title: "Privacy Notice",
        url: "https://privacy.example.com/privacy",
        capturedAt: "2026-11-24T03:00:00.000Z",
        documentKind: "privacy",
        sourceKind: "audited_site",
        excerpt: "Vendor Example receives personal data submitted by account holders.",
      },
    });
    expect(statement?.source.sourceId).toMatch(/^policy-[a-f0-9]{32}$/u);
    expect(JSON.stringify(evidence)).not.toContain("?user=");
  });

  it("attaches audited-site provenance to each literal legal-context claim and omits absent elements", async () => {
    const evidence = await collect(async () => response(), {
      classifyHtml: () => ({
        providerIds: ["vendor-example"],
        providersWithPurpose: ["vendor-example"],
        purposeIds: ["analytics"],
        categories: ["analytics"],
        declaredServices: [{ providerId: "vendor-example", purposeIds: ["analytics"] }],
        documentTitle: "Privacy Notice",
        legalContextClaims: [
          { kind: "data_origin", value: "obtained_from_subject", excerpt: "We collect personal data directly from the data subject." },
          { kind: "audited_entity_is_controller", excerpt: "We are the data controller." },
          { kind: "aepd_jurisdiction_is_established", excerpt: "Our competent supervisory authority is the AEPD." },
        ],
      }),
      now: () => 100,
    });
    const context = evidence.declaredServices[0]?.legalEvidenceContext;
    expect(context?.dataOrigin).toMatchObject({
      value: "obtained_from_subject",
      evidence: [{
        sourceKind: "audited_site",
        title: "Privacy Notice",
        url: "https://privacy.vendor.example.com/privacy",
        excerpt: "We collect personal data directly from the data subject.",
      }],
    });
    expect(context?.auditedEntityIsController?.evidence[0]).toMatchObject({
      sourceKind: "audited_site",
      excerpt: "We are the data controller.",
    });
    expect(context?.aepdJurisdictionIsEstablished?.evidence[0]).toMatchObject({
      sourceKind: "audited_site",
      excerpt: "Our competent supervisory authority is the AEPD.",
    });
  });

  it.each([
    { ...CLASSIFICATION, accessDenied: "false" },
    { ...CLASSIFICATION, providersWithPurpose: ["unlisted-provider"] },
    { ...CLASSIFICATION, declaredServices: [{ providerId: "Provider Name", purposeIds: ["analytics"] }] },
  ])("keeps malformed classifier metadata in review", async (classification) => {
    const evidence = await collect(async () => response(), {
      classifyHtml: () => classification as unknown as PublicPolicyClassification,
    });

    expect(evidence).toMatchObject({ status: "unknown", reasonCode: "auditor_error" });
  });

  it.each([401, 403, 429, 451])("treats HTTP %s as explicit access denial", async (statusCode) => {
    const evidence = await collect(async () => response({ statusCode, html: "" }));

    expect(evidence).toMatchObject({ status: "fail", reasonCode: "access_denied", accessDeniedPages: 1 });
    expect(evidence.discoveredDocuments[0]).toMatchObject({ fetchStatus: "unavailable", sha256: null });
  });

  it.each([404, 410, 500])("treats HTTP %s as an unavailable public policy page", async (statusCode) => {
    const evidence = await collect(async () => response({ statusCode, html: "" }));

    expect(evidence).toMatchObject({ status: "fail", reasonCode: "policy_page_unavailable" });
    expect(evidence.discoveredDocuments[0]).toMatchObject({ fetchStatus: "unavailable", sha256: null });
  });

  it("keeps a transport failure in review without blaming the domain", async () => {
    const evidence = await collect(async () => response({ failureCode: "tls_failure", html: "" }));

    expect(evidence).toMatchObject({ status: "unknown", reasonCode: "auditor_error" });
  });

  it("records a recognized access-block page as a transparency failure", async () => {
    const evidence = await collect(async () => response(), {
      classifyHtml: () => ({
        ...CLASSIFICATION,
        accessDenied: true,
      }),
    });

    expect(evidence).toMatchObject({ status: "fail", reasonCode: "access_denied", accessDeniedPages: 1 });
  });

  it("does not follow a cross-host redirect and leaves the result in review", async () => {
    const fetchDocument = vi.fn(async () => response({ failureCode: "cross_host_redirect", html: "" }));

    const evidence = await collect(fetchDocument);

    expect(fetchDocument).toHaveBeenCalledOnce();
    expect(evidence).toMatchObject({ status: "unknown", reasonCode: "auditor_error", pagesInspected: 1 });
  });

  it("reports exhausted request or byte budgets as unknown", async () => {
    const requestLimited = await collect(async () => response({ requestsCount: 2 }), {
      budget: { durationMs: 1_000, requests: 1, bytes: 1_000 },
    });
    const byteLimited = await collect(async () => response({ bytesCount: 2_000 }), {
      budget: { durationMs: 1_000, requests: 10, bytes: 1_000 },
    });

    expect(requestLimited).toMatchObject({ status: "unknown", reasonCode: "budget_exhausted" });
    expect(byteLimited).toMatchObject({ status: "unknown", reasonCode: "budget_exhausted" });
  });

  it("leaves time-limited work unknown and stops at the 30-page cap", async () => {
    let currentTime = 0;
    const timed = await collect(async () => {
      currentTime = 1_001;
      return response();
    }, {
      budget: { durationMs: 1_000, requests: 300, bytes: 20 * 1024 * 1024 },
      now: () => currentTime,
    });
    const manyLinks = Array.from({ length: 35 }, (_, index) =>
      `<a href="https://privacy${index}.vendor.example.com/privacy">Privacy policy</a>`,
    ).join("");
    const fetchDocument = vi.fn(async () => response());
    const capped = await collect(fetchDocument, { html: manyLinks });

    expect(timed).toMatchObject({ status: "unknown", reasonCode: "budget_exhausted" });
    expect(capped.linksFound).toBe(PUBLIC_POLICY_CRAWL_LIMITS.pages);
    expect(capped.pagesInspected).toBe(PUBLIC_POLICY_CRAWL_LIMITS.pages);
    expect(fetchDocument).toHaveBeenCalledTimes(PUBLIC_POLICY_CRAWL_LIMITS.pages);
  });

  it("does not start requests when the remaining budget is exhausted", async () => {
    const fetchDocument = vi.fn(async () => response());

    const evidence = await collect(fetchDocument, {
      budget: { durationMs: 0, requests: 0, bytes: 0 },
    });

    expect(fetchDocument).not.toHaveBeenCalled();
    expect(evidence).toMatchObject({ status: "unknown", reasonCode: "budget_exhausted" });
  });

  it("treats unsupported or oversized policy documents as auditor errors", async () => {
    const unsupported = await collect(async () => response({ contentType: "application/pdf", html: "" }));
    const oversized = await collect(async () => response({
      html: "x".repeat(PUBLIC_POLICY_CRAWL_LIMITS.documentBytes + 1),
      bytesCount: PUBLIC_POLICY_CRAWL_LIMITS.documentBytes + 1,
    }));

    expect(unsupported).toMatchObject({ status: "unknown", reasonCode: "auditor_error" });
    expect(oversized).toMatchObject({ status: "unknown", reasonCode: "auditor_error" });
  });

  it("rejects classifier output that could contain raw text or unbounded identifiers", async () => {
    const evidence = await collect(async () => response(), {
      classifyHtml: () => ({
        providerIds: ["Vendor Name, personal@example.com"],
        providersWithPurpose: [],
        purposeIds: ["analytics"],
        categories: ["analytics"],
      }),
    });

    expect(evidence).toMatchObject({ status: "unknown", reasonCode: "auditor_error" });
    expect(JSON.stringify(evidence)).not.toContain("personal@example.com");
  });

  it("rejects private DNS answers for each discovered hostname", async () => {
    const privateAddress: LookupAddress = { address: "127.0.0.1", family: 4 };
    const lookup = createPublicPolicyPinnedLookup(
      "privacy.vendor.example.com",
      async () => [privateAddress],
    );

    await expect(runLookup(lookup, "privacy.vendor.example.com")).resolves.toMatchObject({
      error: { code: "EHOSTUNREACH" },
      address: "",
    });
  });

  it("rejects a transport result that exceeds the approved redirect cap", async () => {
    const evidence = await collect(async () => response({ redirectCount: 4 }));

    expect(evidence).toMatchObject({ status: "unknown", reasonCode: "budget_exhausted" });
  });
});

function runLookup(lookup: LookupFunction, hostname: string) {
  return new Promise<{ error: NodeJS.ErrnoException | null; address: string | LookupAddress[] }>((resolve) => {
    lookup(hostname, { all: false, family: 4 }, (error, address) => resolve({ error, address }));
  });
}
