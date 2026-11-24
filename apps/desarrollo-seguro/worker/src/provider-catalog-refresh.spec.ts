import { describe, expect, it, vi } from "vitest";
import { collectCatalogDocuments, extractGdprSanctionScale, refreshProviderCatalog } from "./provider-catalog-refresh.js";
import type { PostgresProviderCatalogStore } from "@desarrolloseguro/persistence/provider-catalog";

describe("provider catalog official-source refresh", () => {
  it("extracts changed GDPR Article 83(5) limits from official text for the next catalog version", () => {
    expect(extractGdprSanctionScale("Article 83 (5) Infringements of the following provisions shall be subject to administrative fines up to 25 000 000 EUR, or up to 5 % of total turnover.")).toMatchObject({
      alternatives: [
        { type: "fixed_amount", currency: "EUR", amount: 25_000_000 },
        { type: "global_annual_turnover_percentage", percentage: 5 },
      ],
    });
    expect(extractGdprSanctionScale("Artículo 83 (5). Las infracciones de las disposiciones siguientes se sancionarán con multas administrativas de 25 000 000 EUR como máximo o, tratándose de una empresa, de una cuantía equivalente al 5 % como máximo del volumen total anual global.")).toMatchObject({
      alternatives: [
        { type: "fixed_amount", currency: "EUR", amount: 25_000_000 },
        { type: "global_annual_turnover_percentage", percentage: 5 },
      ],
    });
  });

  it("fails closed when the official Article 83(5) text cannot be parsed", () => {
    expect(() => extractGdprSanctionScale("Article 83 has no readable paragraph text."))
      .toThrow("provider_catalog_legal_paragraph_missing");
  });

  it("uses only the bundled provider and legal authority URLs", () => {
    const documents = collectCatalogDocuments();
    expect(documents.length).toBeGreaterThan(10);
    expect(documents.every(({ url }) => {
      const parsed = new URL(url);
      return parsed.protocol === "https:" && !parsed.username && !parsed.password && !parsed.port;
    })).toBe(true);
    expect(documents.some(({ providerId }) => providerId === "legal-authority")).toBe(true);
  });

  it("includes first-seen provider documents in later monthly refreshes", () => {
    expect(collectCatalogDocuments([{
      providerId: "dst_vendor_example_12345678",
      officialDocuments: [{
        documentId: "vendor-privacy",
        title: "Vendor privacy notice",
        url: "https://vendor.example/privacy",
      }],
    }])).toContainEqual({
      providerId: "dst_vendor_example_12345678",
      documentId: "vendor-privacy",
      title: "Vendor privacy notice",
      url: "https://vendor.example/privacy",
    });
  });

  it("stores content fingerprints and activates one complete immutable snapshot", async () => {
    const store = createStore();
    let tick = 0;
    const version = await refreshProviderCatalog({
      store,
      scheduledAt: new Date("2026-12-01T02:00:00.000Z"),
      signal: new AbortController().signal,
      now: () => new Date(Date.UTC(2026, 11, 1, 2, 0, tick++)),
      fetchDocument: async ({ hostname, path }) => ({
        statusCode: 200,
        contentType: "text/html",
        html: `<html>${hostname === "developers.openai.com" ? "abuse monitoring API inputs and outputs" : hostname === "www.ionos.es" ? "SMTP sending server" : hostname === "www.boe.es" ? "Artículo 83 (5). Las infracciones de las disposiciones siguientes se sancionarán con multas administrativas de 20 000 000 EUR como máximo o, tratándose de una empresa, de una cuantía equivalente al 4 % como máximo del volumen total anual global." : "official source"}${path}</html>`,
        requestsCount: 1,
        bytesCount: 80,
        redirectCount: 0,
      }),
    });

    expect(version).toBe("a".repeat(64));
    expect(store.activate).toHaveBeenCalledOnce();
    const payload = vi.mocked(store.activate).mock.calls[0]?.[0];
    expect(payload?.sources.length).toBe(collectCatalogDocuments().length);
    expect(payload?.sources.every(({ status, sha256 }) => status === "fetched" && /^[a-f0-9]{64}$/u.test(sha256 ?? ""))).toBe(true);
    expect(payload?.providerFacts.some((fact) => isRecord(fact) && Array.isArray(fact.officialSourceDigests))).toBe(true);
    expect(store.failRefresh).not.toHaveBeenCalled();
  });

  it("records unavailable official sources and preserves the active version", async () => {
    const store = createStore();
    await expect(refreshProviderCatalog({
      store,
      scheduledAt: new Date("2026-12-01T02:00:00.000Z"),
      signal: new AbortController().signal,
      fetchDocument: async ({ hostname }) => ({
        statusCode: hostname === "www.ionos.es" ? 404 : 200,
        contentType: "text/html",
        html: "<html>official source</html>",
        requestsCount: 1,
        bytesCount: 30,
        redirectCount: 0,
      }),
    })).rejects.toThrow("provider_catalog_official_source_unavailable");

    expect(store.activate).not.toHaveBeenCalled();
    expect(store.failRefresh).toHaveBeenCalledOnce();
    const attempts = vi.mocked(store.failRefresh).mock.calls[0]?.[2];
    expect(attempts?.some(({ status }) => status === "unavailable")).toBe(true);
    expect(attempts?.some(({ status }) => status === "fetched")).toBe(true);
  });
});

function createStore() {
  return {
    beginRefresh: vi.fn(async () => true),
    readRefreshStatus: vi.fn(async () => null),
    readActive: vi.fn(async () => ({ catalogVersion: "a".repeat(64), providerFacts: [], legalRules: [], sources: [], createdAt: new Date() })),
    activate: vi.fn(async () => "a".repeat(64)),
    failRefresh: vi.fn(async () => undefined),
  } as unknown as PostgresProviderCatalogStore;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
