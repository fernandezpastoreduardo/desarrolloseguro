import { describe, expect, it, vi } from "vitest";
import {
  computeProviderCatalogVersion,
  PostgresProviderCatalogStore,
  toMadridLocalDate,
  type ProviderCatalogSnapshot,
  type ProviderCatalogSourceReceipt,
} from "./provider-catalog-store.js";

const receipt: ProviderCatalogSourceReceipt = {
  providerId: "sample-provider",
  documentId: "privacy-notice",
  title: "Privacy notice",
  url: "https://provider.example/privacy",
  status: "fetched",
  sha256: "a".repeat(64),
  checkedAt: "2026-11-01T02:00:00.000Z",
};

describe("PostgresProviderCatalogStore", () => {
  it("returns null when no active catalog exists", async () => {
    const query = vi.fn().mockResolvedValue({ rows: [] });
    await expect(new PostgresProviderCatalogStore({ query } as never).readActive()).resolves.toBeNull();
  });

  it("reads a valid active snapshot and verifies its content version", async () => {
    const providerFacts = [{ providerId: "sample-provider", facts: ["hosting"] }];
    const legalRules = [{ ruleId: "gdpr-13", article: "13" }];
    const sources = [receipt];
    const catalogVersion = computeProviderCatalogVersion(providerFacts, legalRules, sources);
    const query = vi.fn().mockResolvedValue({ rows: [{
      catalog_version: catalogVersion,
      provider_facts_json: providerFacts,
      legal_rules_json: legalRules,
      source_receipts_json: sources,
      created_at: new Date("2026-11-01T02:00:00.000Z"),
    }] });
    const result = await new PostgresProviderCatalogStore({ query } as never).readActive();
    expect(result?.catalogVersion).toBe(catalogVersion);
    expect(result?.providerFacts).toEqual(providerFacts);
    expect(query.mock.calls[0]?.[0]).toContain("ds_provider_catalog_active");
  });

  it("rejects an active snapshot whose version does not match its facts", async () => {
    const query = vi.fn().mockResolvedValue({ rows: [{
      catalog_version: "a".repeat(64),
      provider_facts_json: [],
      legal_rules_json: [],
      source_receipts_json: [receipt],
      created_at: new Date(),
    }] });
    await expect(new PostgresProviderCatalogStore({ query } as never).readActive())
      .rejects.toThrow("provider_catalog_row_invalid");
  });

  it("starts the first-day refresh using the Madrid local date", async () => {
    const query = vi.fn().mockResolvedValue({ rows: [{ ds_begin_provider_catalog_refresh: true }] });
    const store = new PostgresProviderCatalogStore({ query } as never);
    await expect(store.beginRefresh(new Date("2026-11-01T00:30:00.000Z"))).resolves.toBe(true);
    expect(query.mock.calls[0]?.[1]).toEqual(["2026-11-01"]);
  });

  it("seeds the bundled catalog once with explicit non-fetch receipts", async () => {
    const query = vi.fn()
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ ds_seed_provider_catalog_version: "b".repeat(64) }] });
    const version = await new PostgresProviderCatalogStore({ query } as never).seedBundledCatalogIfMissing();
    expect(version).toBe("b".repeat(64));
    expect(query).toHaveBeenCalledTimes(2);
    expect(query.mock.calls[1]?.[0]).toContain("ds_seed_provider_catalog_version");
    const sourceReceipts = JSON.parse(query.mock.calls[1]?.[1]?.[3] as string) as ProviderCatalogSourceReceipt[];
    expect(sourceReceipts.length).toBeGreaterThan(0);
    expect(sourceReceipts.every(({ status, sha256 }) => status === "seeded" && sha256 === null)).toBe(true);
  });

  it("does not activate an incomplete monthly source refresh", async () => {
    const query = vi.fn();
    const store = new PostgresProviderCatalogStore({ query } as never);
    await expect(store.activate({
      providerFacts: [],
      legalRules: [],
      sources: [{ ...receipt, status: "failed", sha256: null }],
      scheduledAt: new Date("2026-11-01T02:00:00.000Z"),
    })).rejects.toThrow("provider_catalog_payload_invalid");
    expect(query).not.toHaveBeenCalled();
  });

  it("validates official source receipts before activation", async () => {
    const query = vi.fn();
    const store = new PostgresProviderCatalogStore({ query } as never);
    await expect(store.activate({
      providerFacts: [], legalRules: [],
      sources: [{ ...receipt, url: "http://provider.example/privacy" }],
      scheduledAt: new Date("2026-11-01T02:00:00.000Z"),
    })).rejects.toThrow("provider_catalog_payload_invalid");
    expect(query).not.toHaveBeenCalled();
  });

  it("persists a first-seen provider as a new immutable version when no official source is located", async () => {
    const current = snapshot();
    let nextVersion = "";
    const query = vi.fn(async (sql: string, values?: unknown[]) => {
      if (sql.includes("ds_add_provider_catalog_discovery_version")) {
        nextVersion = String(values?.[1]);
        return { rows: [{ ds_add_provider_catalog_discovery_version: nextVersion }] };
      }
      return { rows: [snapshotRow(current)] };
    });
    const store = new PostgresProviderCatalogStore({ query } as never);
    const result = await store.recordDiscoveredProvider({
      providerId: "new-mail-vendor",
      displayName: "New Mail Vendor",
      aliases: ["New Mail Vendor", "newmail.io"],
      products: ["Transactional email"],
      evidence: {
        kind: "observed_destination",
        sourceId: "policy-page-1",
        title: "Privacy policy",
        url: "https://audited-site.io/privacy?tracker=remove#section",
        capturedAt: "2026-11-24T03:00:00Z",
        excerpt: "The site sends a message to New Mail Vendor using newmail.io.",
        destinationHostname: "newmail.io",
        destinationPath: "/v1/send?token=remove#fragment",
      },
      officialDocuments: [],
    });

    expect(result).toEqual({
      catalogVersion: nextVersion,
      created: true,
      documentationStatus: "source_not_localized",
    });
    const call = query.mock.calls.find(([sql]) => sql.includes("ds_add_provider_catalog_discovery_version"));
    expect(call).toBeDefined();
    const discovery = JSON.parse(String(call?.[1]?.[5])) as Record<string, unknown>;
    expect(discovery.documentationStatus).toBe("source_not_localized");
    expect(discovery.officialDocuments).toEqual([]);
    expect(discovery.evidence).toMatchObject({
      url: "https://audited-site.io/privacy",
      destinationHostname: "newmail.io",
      destinationPath: "/v1/send",
    });
    const facts = JSON.parse(String(call?.[1]?.[2])) as Array<Record<string, unknown>>;
    expect(facts.some((fact) => fact.providerId === "new-mail-vendor" && fact.documentationStatus === "source_not_localized")).toBe(true);
  });

  it("stores fetched official documents and reports when located documents are unavailable", async () => {
    const current = snapshot();
    let nextVersion = "";
    const query = vi.fn(async (sql: string, values?: unknown[]) => {
      if (sql.includes("ds_add_provider_catalog_discovery_version")) {
        nextVersion = String(values?.[1]);
        return { rows: [{ ds_add_provider_catalog_discovery_version: nextVersion }] };
      }
      return { rows: [snapshotRow(current)] };
    });
    const store = new PostgresProviderCatalogStore({ query } as never);
    const result = await store.recordDiscoveredProvider({
      providerId: "new-telemetry-vendor",
      displayName: "New Telemetry Vendor",
      aliases: [],
      products: [],
      evidence: explicitDiscoveryEvidence(),
      officialDocuments: [{
        documentId: "new-telemetry-privacy",
        kind: "privacy",
        title: "Privacy policy",
        url: "https://vendor-sample.io/privacy",
        discoveryMethod: "audited_site_link",
        status: "unavailable",
        sha256: null,
        checkedAt: "2026-11-24T03:01:00Z",
      }],
    });

    expect(result.documentationStatus).toBe("source_unavailable");
    const call = query.mock.calls.find(([sql]) => sql.includes("ds_add_provider_catalog_discovery_version"));
    const receipts = JSON.parse(String(call?.[1]?.[4])) as ProviderCatalogSourceReceipt[];
    expect(receipts).toContainEqual(expect.objectContaining({
      providerId: "new-telemetry-vendor",
      documentId: "new-telemetry-privacy",
      status: "unavailable",
      sha256: null,
    }));
  });

  it("does not repeat catalog work when a provider already exists", async () => {
    const current = snapshot();
    const providerFacts = [...current.providerFacts, { providerId: "new-mail-vendor", documentationStatus: "source_not_localized" }];
    const existingProviderSnapshot = {
      ...current,
      providerFacts,
      catalogVersion: computeProviderCatalogVersion(providerFacts, current.legalRules, current.sources),
    };
    const query = vi.fn().mockResolvedValue({ rows: [snapshotRow(existingProviderSnapshot)] });
    const store = new PostgresProviderCatalogStore({ query } as never);
    const result = await store.recordDiscoveredProvider({
      providerId: "new-mail-vendor",
      displayName: "New Mail Vendor",
      aliases: [], products: [],
      evidence: explicitDiscoveryEvidence(),
      officialDocuments: [],
    });
    expect(result).toMatchObject({ catalogVersion: expect.any(String), created: false, documentationStatus: "source_not_localized" });
    expect(query).toHaveBeenCalledTimes(2);
  });

  it("rejects private source URLs and malformed discovery evidence before persistence", async () => {
    const query = vi.fn();
    const store = new PostgresProviderCatalogStore({ query } as never);
    await expect(store.recordDiscoveredProvider({
      providerId: "new-mail-vendor",
      displayName: "New Mail Vendor",
      aliases: [], products: [],
      evidence: { ...explicitDiscoveryEvidence(), url: "https://127.0.0.1/privacy" },
      officialDocuments: [],
    })).rejects.toThrow("provider_catalog_discovery_invalid");
    expect(query).not.toHaveBeenCalled();
  });

  it("hashes JSON objects independently of property order", () => {
    expect(computeProviderCatalogVersion([{ a: 1, b: 2 }], [], [receipt]))
      .toBe(computeProviderCatalogVersion([{ b: 2, a: 1 }], [], [receipt]));
  });

  it("rejects invalid timestamps and local dates deterministically", () => {
    expect(toMadridLocalDate(new Date("2026-11-01T00:30:00.000Z"))).toBe("2026-11-01");
    expect(() => toMadridLocalDate(new Date(Number.NaN))).toThrow("provider_catalog_clock_invalid");
  });
});

function snapshot(): ProviderCatalogSnapshot {
  const providerFacts = [{ providerId: "sample-provider", facts: ["hosting"] }];
  const legalRules = [{ ruleId: "gdpr-13", article: "13" }];
  const sources = [receipt];
  return {
    catalogVersion: computeProviderCatalogVersion(providerFacts, legalRules, sources),
    providerFacts,
    legalRules,
    sources,
    createdAt: new Date("2026-11-01T02:00:00.000Z"),
  };
}

function snapshotRow(value: ProviderCatalogSnapshot) {
  return {
    catalog_version: value.catalogVersion,
    provider_facts_json: value.providerFacts,
    legal_rules_json: value.legalRules,
    source_receipts_json: value.sources,
    created_at: value.createdAt,
  };
}

function explicitDiscoveryEvidence() {
  return {
    kind: "explicit_site_reference" as const,
    sourceId: "privacy-page",
    title: "Privacy policy",
    url: "https://audited-site.io/privacy",
    capturedAt: "2026-11-24T03:00:00Z",
    excerpt: "The site identifies New Telemetry Vendor as a service provider.",
  };
}
