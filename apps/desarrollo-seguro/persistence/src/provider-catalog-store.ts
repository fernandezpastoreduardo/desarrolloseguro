import { createHash } from "node:crypto";
import type { Pool } from "pg";
import {
  PROVIDER_LEGAL_RULES,
  PUBLIC_SERVICE_LEGAL_RULES,
  PUBLIC_SERVICE_PROVIDER_INFO,
} from "@desarrolloseguro/core";

const VERSION_PATTERN = /^[a-f0-9]{64}$/u;
const FAILURE_CODE_PATTERN = /^[a-z][a-z0-9_]{0,63}$/u;
const MAX_PROVIDERS = 300;
const MAX_RULES = 200;
const MAX_SOURCE_RECEIPTS = 500;
const MAX_PROVIDER_BYTES = 2 * 1024 * 1024;
const MAX_RULE_BYTES = 1024 * 1024;
const MAX_SOURCE_BYTES = 512 * 1024;

export type ProviderCatalogSourceReceipt = {
  providerId: string;
  documentId: string;
  title: string;
  url: string;
  status: "seeded" | "fetched" | "unavailable" | "failed" | "not_localized";
  sha256: string | null;
  checkedAt: string;
};

export type ProviderCatalogSnapshot = {
  catalogVersion: string;
  providerFacts: unknown[];
  legalRules: unknown[];
  sources: ProviderCatalogSourceReceipt[];
  createdAt: Date;
};

export type ProviderDiscoveryEvidence = {
  kind: "explicit_site_reference" | "observed_destination";
  sourceId: string;
  title: string;
  url: string;
  capturedAt: string;
  excerpt: string;
  destinationHostname?: string;
  destinationPath?: string;
};

export type ProviderDiscoveryDocument = {
  documentId: string;
  kind: "privacy" | "cookies" | "terms" | "legal" | "service" | "technical";
  title: string;
  url: string;
  discoveryMethod: "audited_site_link" | "known_official_catalog";
  status: "fetched" | "unavailable" | "failed";
  sha256: string | null;
  checkedAt: string;
};

export type ProviderDiscoveryInput = {
  providerId: string;
  displayName: string;
  aliases: string[];
  products: string[];
  evidence: ProviderDiscoveryEvidence;
  officialDocuments: ProviderDiscoveryDocument[];
};

export type ProviderDiscoveryResult = {
  catalogVersion: string;
  created: boolean;
  documentationStatus: "located" | "source_unavailable" | "source_not_localized";
};

export type ProviderCatalogRefreshStatus = "running" | "completed" | "failed";

export class PostgresProviderCatalogStore {
  constructor(private readonly pool: Pick<Pool, "query">) {}

  async readActive(): Promise<ProviderCatalogSnapshot | null> {
    const result = await this.pool.query<{
      catalog_version: unknown;
      provider_facts_json: unknown;
      legal_rules_json: unknown;
      source_receipts_json: unknown;
      created_at: unknown;
    }>(`SELECT version.catalog_version, version.provider_facts_json,
        version.legal_rules_json, version.source_receipts_json, version.created_at
      FROM public.ds_provider_catalog_active AS active
      JOIN public.ds_provider_catalog_versions AS version USING (catalog_version)
      WHERE active.singleton = true`);
    const row = result.rows[0];
    if (!row) return null;
    const snapshot = parseSnapshot(row);
    if (!snapshot) throw new Error("provider_catalog_row_invalid");
    return snapshot;
  }

  async seedBundledCatalogIfMissing(): Promise<string> {
    const current = await this.readActive();
    if (current) return current.catalogVersion;
    const providerFacts = Object.entries(PUBLIC_SERVICE_PROVIDER_INFO).map(([providerId, info]) => ({
      providerId,
      displayName: info.displayName,
      serviceSummary: info.serviceSummary,
      serviceSourceUrl: info.serviceSourceUrl,
      privacyPolicyUrl: info.privacyPolicyUrl,
      reviewedAt: info.reviewedAt,
      officialDocuments: info.officialDocuments ?? [],
      documentedFacts: info.documentedFacts ?? [],
    }));
    const legalRules = Object.entries({ ...PUBLIC_SERVICE_LEGAL_RULES, ...PROVIDER_LEGAL_RULES })
      .map(([ruleId, rule]) => ({ ruleId, ...rule }));
    const sources = Object.entries(PUBLIC_SERVICE_PROVIDER_INFO).flatMap(([providerId, info]) => {
      const reviewedAt = new Date(`${info.reviewedAt}T00:00:00.000Z`).toISOString();
      const documents = [
        { documentId: `${providerId}-service-source`, title: `${info.displayName} service documentation`, url: info.serviceSourceUrl },
        { documentId: `${providerId}-privacy-policy`, title: `${info.displayName} privacy documentation`, url: info.privacyPolicyUrl },
        ...(info.officialDocuments ?? []).map(({ documentId, title, url }) => ({ documentId, title, url })),
      ];
      const unique = new Map(documents.map((document) => [document.documentId, document]));
      return [...unique.values()].map((document) => ({
        providerId,
        ...document,
        status: "seeded" as const,
        sha256: null,
        checkedAt: reviewedAt,
      }));
    });
    const version = computeProviderCatalogVersion(providerFacts, legalRules, sources);
    const result = await this.pool.query<{ ds_seed_provider_catalog_version: unknown }>(
      `SELECT public.ds_seed_provider_catalog_version($1, $2::jsonb, $3::jsonb, $4::jsonb)
        AS ds_seed_provider_catalog_version`,
      [version, JSON.stringify(providerFacts), JSON.stringify(legalRules), JSON.stringify(sources)],
    );
    if (typeof result.rows[0]?.ds_seed_provider_catalog_version !== "string" ||
        !VERSION_PATTERN.test(result.rows[0].ds_seed_provider_catalog_version)) {
      throw new Error("provider_catalog_seed_result_invalid");
    }
    return result.rows[0].ds_seed_provider_catalog_version;
  }

  async beginRefresh(scheduledAt: Date): Promise<boolean> {
    const result = await this.pool.query<{ ds_begin_provider_catalog_refresh: unknown }>(
      "SELECT public.ds_begin_provider_catalog_refresh($1::date) AS ds_begin_provider_catalog_refresh",
      [toMadridLocalDate(scheduledAt)],
    );
    const inserted = result.rows[0]?.ds_begin_provider_catalog_refresh;
    if (typeof inserted !== "boolean") throw new Error("provider_catalog_refresh_result_invalid");
    return inserted;
  }

  async readRefreshStatus(scheduledAt: Date): Promise<ProviderCatalogRefreshStatus | null> {
    const result = await this.pool.query<{ status: unknown }>(
      "SELECT status FROM public.ds_provider_catalog_refresh_runs WHERE scheduled_local_date = $1::date",
      [toMadridLocalDate(scheduledAt)],
    );
    const status = result.rows[0]?.status;
    if (status === undefined) return null;
    if (status !== "running" && status !== "completed" && status !== "failed") {
      throw new Error("provider_catalog_refresh_status_invalid");
    }
    return status;
  }

  /** Persists a first-seen provider as a new immutable catalog version before reporting it. */
  async recordDiscoveredProvider(input: ProviderDiscoveryInput): Promise<ProviderDiscoveryResult> {
    const normalized = normalizeProviderDiscovery(input);
    if (!normalized) throw new Error("provider_catalog_discovery_invalid");
    if (!(await this.readActive())) await this.seedBundledCatalogIfMissing();

    for (let attempt = 0; attempt < 3; attempt += 1) {
      const active = await this.readActive();
      if (!active) throw new Error("provider_catalog_active_missing");
      const existingProvider = active.providerFacts.find((fact) => isRecord(fact) && fact.providerId === normalized.providerId);
      if (existingProvider) {
        return {
          catalogVersion: active.catalogVersion,
          created: false,
          documentationStatus: isRecord(existingProvider) && isDocumentationStatus(existingProvider.documentationStatus)
            ? existingProvider.documentationStatus
            : getDocumentationStatus(normalized.officialDocuments),
        };
      }
      if (active.providerFacts.length >= MAX_PROVIDERS) throw new Error("provider_catalog_provider_limit_exceeded");

      const documentationStatus = getDocumentationStatus(normalized.officialDocuments);
      const providerFact = {
        providerId: normalized.providerId,
        displayName: normalized.displayName,
        aliases: normalized.aliases,
        products: normalized.products,
        serviceSummary: "Proveedor identificado durante una auditoría; hechos oficiales pendientes de extracción.",
        documentationStatus,
        discoveryEvidence: [normalized.evidence],
        officialDocuments: normalized.officialDocuments.map(({ documentId, kind, title, url, checkedAt }) => ({
          documentId,
          kind,
          title,
          url,
          reviewedAt: checkedAt.slice(0, 10),
        })),
        documentedFacts: [],
      };
      const providerFacts = [...active.providerFacts, providerFact];
      const sources = [
        ...active.sources,
        ...normalized.officialDocuments.map((document) => ({
          providerId: normalized.providerId,
          documentId: document.documentId,
          title: document.title,
          url: document.url,
          status: document.status,
          sha256: document.sha256,
          checkedAt: document.checkedAt,
        })),
      ];
      const validFacts = validateJsonArray(providerFacts, MAX_PROVIDERS, MAX_PROVIDER_BYTES);
      const validSources = validateSourceReceipts(sources);
      if (!validFacts || !validSources) throw new Error("provider_catalog_discovery_payload_invalid");
      const version = computeProviderCatalogVersion(validFacts, active.legalRules, validSources);
      try {
        const result = await this.pool.query<{ ds_add_provider_catalog_discovery_version: unknown }>(
          `SELECT public.ds_add_provider_catalog_discovery_version(
            $1, $2, $3::jsonb, $4::jsonb, $5::jsonb, $6::jsonb
          ) AS ds_add_provider_catalog_discovery_version`,
          [
            active.catalogVersion,
            version,
            JSON.stringify(validFacts),
            JSON.stringify(active.legalRules),
            JSON.stringify(validSources),
            JSON.stringify({ ...normalized, documentationStatus }),
          ],
        );
        if (result.rows[0]?.ds_add_provider_catalog_discovery_version !== version) {
          throw new Error("provider_catalog_discovery_activation_invalid");
        }
        return { catalogVersion: version, created: true, documentationStatus };
      } catch (error) {
        if (!(error instanceof Error) || error.message !== "provider_catalog_active_version_changed" || attempt === 2) throw error;
      }
    }
    throw new Error("provider_catalog_discovery_conflict");
  }

  async activate(input: {
    providerFacts: readonly unknown[];
    legalRules: readonly unknown[];
    sources: readonly ProviderCatalogSourceReceipt[];
    scheduledAt: Date;
  }): Promise<string> {
    const providerFacts = validateJsonArray(input.providerFacts, MAX_PROVIDERS, MAX_PROVIDER_BYTES);
    const legalRules = validateJsonArray(input.legalRules, MAX_RULES, MAX_RULE_BYTES);
    const sources = validateSourceReceipts(input.sources);
    const scheduledDate = toMadridLocalDate(input.scheduledAt);
    if (!providerFacts || !legalRules || !sources || sources.length === 0 ||
        sources.some(({ status }) => status !== "fetched")) {
      throw new Error("provider_catalog_payload_invalid");
    }
    const version = computeProviderCatalogVersion(providerFacts, legalRules, sources);
    const result = await this.pool.query<{ ds_activate_provider_catalog_version: unknown }>(
      `SELECT public.ds_activate_provider_catalog_version(
        $1, $2::jsonb, $3::jsonb, $4::jsonb, $5::date
      ) AS ds_activate_provider_catalog_version`,
      [version, JSON.stringify(providerFacts), JSON.stringify(legalRules), JSON.stringify(sources), scheduledDate],
    );
    if (result.rows[0]?.ds_activate_provider_catalog_version !== version) {
      throw new Error("provider_catalog_activation_result_invalid");
    }
    return version;
  }

  async failRefresh(
    scheduledAt: Date,
    failureCode: string,
    sourceAttempts: readonly ProviderCatalogSourceReceipt[] = [],
  ): Promise<void> {
    if (!FAILURE_CODE_PATTERN.test(failureCode)) throw new Error("provider_catalog_failure_code_invalid");
    const sources = validateSourceReceipts(sourceAttempts);
    if (!sources) throw new Error("provider_catalog_source_receipts_invalid");
    await this.pool.query(
      "SELECT public.ds_fail_provider_catalog_refresh($1::date, $2, $3::jsonb)",
      [toMadridLocalDate(scheduledAt), failureCode, JSON.stringify(sources)],
    );
  }
}

export function computeProviderCatalogVersion(
  providerFacts: readonly unknown[],
  legalRules: readonly unknown[],
  sources: readonly ProviderCatalogSourceReceipt[],
): string {
  const normalized = {
    legalRules: canonicalize(legalRules),
    providerFacts: canonicalize(providerFacts),
    sources: canonicalize(sources),
  };
  return createHash("sha256").update(JSON.stringify(normalized), "utf8").digest("hex");
}

export function toMadridLocalDate(date: Date): string {
  if (!Number.isFinite(date.getTime())) throw new Error("provider_catalog_clock_invalid");
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Madrid",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map(({ type, value }) => [type, value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function validateJsonArray(value: readonly unknown[], maxItems: number, maxBytes: number): unknown[] | null {
  if (!Array.isArray(value) || value.length > maxItems) return null;
  const serialized = JSON.stringify(value);
  if (Buffer.byteLength(serialized, "utf8") > maxBytes) return null;
  try {
    return JSON.parse(serialized) as unknown[];
  } catch {
    return null;
  }
}

function validateSourceReceipts(value: readonly ProviderCatalogSourceReceipt[]): ProviderCatalogSourceReceipt[] | null {
  if (!Array.isArray(value) || value.length > MAX_SOURCE_RECEIPTS) return null;
  const receipts: ProviderCatalogSourceReceipt[] = [];
  for (const source of value) {
    if (!isRecord(source) || !onlyKeys(source, ["providerId", "documentId", "title", "url", "status", "sha256", "checkedAt"]) ||
        !isIdentifier(source.providerId, 64) || !isIdentifier(source.documentId, 96) ||
        typeof source.title !== "string" || source.title.length < 1 || source.title.length > 240 ||
        typeof source.url !== "string" || source.url.length > 2048 || !isPublicHttpsUrl(source.url) ||
        !["seeded", "fetched", "unavailable", "failed", "not_localized"].includes(String(source.status)) ||
        source.sha256 !== null && (typeof source.sha256 !== "string" || !VERSION_PATTERN.test(source.sha256)) ||
        source.status === "fetched" && source.sha256 === null ||
        source.status === "seeded" && source.sha256 !== null ||
        typeof source.checkedAt !== "string" || !Number.isFinite(Date.parse(source.checkedAt))) return null;
    receipts.push({
      providerId: source.providerId,
      documentId: source.documentId,
      title: source.title,
      url: source.url,
      status: source.status as ProviderCatalogSourceReceipt["status"],
      sha256: source.sha256 as string | null,
      checkedAt: new Date(source.checkedAt).toISOString(),
    });
  }
  if (Buffer.byteLength(JSON.stringify(receipts), "utf8") > MAX_SOURCE_BYTES) return null;
  return receipts;
}

function normalizeProviderDiscovery(value: ProviderDiscoveryInput): ProviderDiscoveryInput | null {
  if (!isRecord(value) || !isIdentifier(value.providerId, 32) || !isSafeText(value.displayName, 1, 120) ||
      !isStringList(value.aliases, 20, 80) || !isStringList(value.products, 20, 120) ||
      !isRecord(value.evidence) || !Array.isArray(value.officialDocuments) || value.officialDocuments.length > 30) return null;
  const evidence = value.evidence;
  const evidenceKeys = ["kind", "sourceId", "title", "url", "capturedAt", "excerpt", "destinationHostname", "destinationPath"];
  if (Reflect.ownKeys(evidence).some((key) => !evidenceKeys.includes(String(key))) ||
      !["explicit_site_reference", "observed_destination"].includes(String(evidence.kind)) ||
      !isIdentifier(evidence.sourceId, 96) || !isSafeText(evidence.title, 1, 200) ||
      typeof evidence.url !== "string" || !isPublicEvidenceUrl(evidence.url) ||
      typeof evidence.capturedAt !== "string" || !Number.isFinite(Date.parse(evidence.capturedAt)) ||
      typeof evidence.excerpt !== "string" || evidence.excerpt.trim().length < 1 || evidence.excerpt.length > 500) return null;
  const sourceUrl = normalizeEvidenceUrl(evidence.url);
  if (!sourceUrl) return null;
  const normalizedEvidence: ProviderDiscoveryEvidence = {
    kind: evidence.kind as ProviderDiscoveryEvidence["kind"],
    sourceId: evidence.sourceId,
    title: evidence.title.trim(),
    url: sourceUrl,
    capturedAt: new Date(evidence.capturedAt).toISOString(),
    excerpt: redactSensitiveText(evidence.excerpt.trim()).slice(0, 500),
    ...(evidence.kind === "observed_destination" ? {
      destinationHostname: normalizePublicHostname(evidence.destinationHostname),
      destinationPath: normalizePublicPath(evidence.destinationPath),
    } : {}),
  };
  if (normalizedEvidence.kind === "observed_destination" &&
      (!normalizedEvidence.destinationHostname || !normalizedEvidence.destinationPath)) return null;
  if (normalizedEvidence.kind === "explicit_site_reference" &&
      (evidence.destinationHostname !== undefined || evidence.destinationPath !== undefined)) return null;

  const documents: ProviderDiscoveryDocument[] = [];
  const documentIds = new Set<string>();
  for (const document of value.officialDocuments) {
    if (!isRecord(document) || !onlyKeys(document, [
      "documentId", "kind", "title", "url", "discoveryMethod", "status", "sha256", "checkedAt",
    ]) || !isIdentifier(document.documentId, 96) || documentIds.has(document.documentId) ||
        !["privacy", "cookies", "terms", "legal", "service", "technical"].includes(String(document.kind)) ||
        !isSafeText(document.title, 1, 240) || typeof document.url !== "string" || !isPublicEvidenceUrl(document.url) ||
        !["audited_site_link", "known_official_catalog"].includes(String(document.discoveryMethod)) ||
        !["fetched", "unavailable", "failed"].includes(String(document.status)) ||
        document.sha256 !== null && (typeof document.sha256 !== "string" || !VERSION_PATTERN.test(document.sha256)) ||
        document.status === "fetched" && document.sha256 === null ||
        document.status !== "fetched" && document.sha256 !== null ||
        typeof document.checkedAt !== "string" || !Number.isFinite(Date.parse(document.checkedAt))) return null;
    documentIds.add(document.documentId);
    documents.push({
      documentId: document.documentId,
      kind: document.kind as ProviderDiscoveryDocument["kind"],
      title: document.title.trim(),
      url: document.url,
      discoveryMethod: document.discoveryMethod as ProviderDiscoveryDocument["discoveryMethod"],
      status: document.status as ProviderDiscoveryDocument["status"],
      sha256: document.sha256 as string | null,
      checkedAt: new Date(document.checkedAt).toISOString(),
    });
  }
  return {
    providerId: value.providerId,
    displayName: value.displayName.trim(),
    aliases: [...new Set(value.aliases.map((alias) => alias.trim()))],
    products: [...new Set(value.products.map((product) => product.trim()))],
    evidence: normalizedEvidence,
    officialDocuments: documents,
  };
}

function getDocumentationStatus(
  documents: readonly ProviderDiscoveryDocument[],
): ProviderDiscoveryResult["documentationStatus"] {
  if (documents.length === 0) return "source_not_localized";
  if (documents.some(({ status }) => status === "fetched")) return "located";
  return "source_unavailable";
}

function isDocumentationStatus(value: unknown): value is ProviderDiscoveryResult["documentationStatus"] {
  return value === "located" || value === "source_unavailable" || value === "source_not_localized";
}

function normalizeEvidenceUrl(value: string): string | null {
  try {
    const url = new URL(value);
    if (!isPublicEvidenceUrl(value) || url.search || url.hash) {
      url.search = "";
      url.hash = "";
    }
    return url.toString();
  } catch { return null; }
}

function isPublicEvidenceUrl(value: string): boolean {
  if (!isPublicHttpsUrl(value)) return false;
  try {
    const { hostname } = new URL(value);
    const normalized = hostname.toLowerCase().replace(/\.$/u, "");
    return normalized.includes(".") && !/^[0-9.]+$/u.test(normalized) &&
      !["localhost", ".localhost", ".local", ".internal", ".test", ".invalid", ".example", ".onion", ".lan", ".home", ".corp", ".intranet", ".private", ".home.arpa"]
        .some((suffix) => normalized === suffix || normalized.endsWith(suffix));
  } catch { return false; }
}

function normalizePublicHostname(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const hostname = value.toLowerCase().replace(/\.$/u, "");
  const reservedSuffixes = [".localhost", ".local", ".internal", ".test", ".invalid", ".example", ".onion", ".lan", ".home", ".corp", ".intranet", ".private", ".home.arpa"];
  const isDomain = hostname.length <= 253 && hostname.includes(".") &&
    /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)(?:\.(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?))*$/u.test(hostname);
  return isDomain && !/^[0-9.]+$/u.test(hostname) && hostname !== "localhost" &&
    !reservedSuffixes.some((suffix) => hostname.endsWith(suffix)) ? hostname : undefined;
}

function normalizePublicPath(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const path = value.split(/[?#]/u, 1)[0] ?? "";
  if (path.length > 512 || !path.startsWith("/") || containsControlCharacter(path) || path.includes(" ")) return undefined;
  return path;
}

function isSafeText(value: unknown, minimum: number, maximum: number): value is string {
  return typeof value === "string" && value.trim().length >= minimum && value.length <= maximum &&
    !containsControlCharacter(value);
}

function containsControlCharacter(value: string): boolean {
  return Array.from(value).some((character) => {
    const code = character.codePointAt(0) ?? 0;
    return code < 0x20 || code === 0x7f;
  });
}

function isStringList(value: unknown, maxItems: number, maxLength: number): value is string[] {
  return Array.isArray(value) && value.length <= maxItems &&
    value.every((item) => isSafeText(item, 1, maxLength)) && new Set(value).size === value.length;
}

function redactSensitiveText(value: string): string {
  return value
    .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/giu, "[redactado]")
    .replace(/\b(?:sk|key|token)[-_][A-Z0-9_-]{12,}\b/giu, "[redactado]");
}

function parseSnapshot(row: Record<string, unknown>): ProviderCatalogSnapshot | null {
  const providerFacts = asArray(row.provider_facts_json);
  const legalRules = asArray(row.legal_rules_json);
  const sources = asArray(row.source_receipts_json);
  const catalogVersion = row.catalog_version;
  const createdAt = row.created_at instanceof Date ? row.created_at : new Date(String(row.created_at));
  if (typeof catalogVersion !== "string" || !VERSION_PATTERN.test(catalogVersion) ||
      !providerFacts || !legalRules || !sources || !Number.isFinite(createdAt.getTime())) return null;
  const validatedSources = validateSourceReceipts(sources as ProviderCatalogSourceReceipt[]);
  if (!validatedSources || computeProviderCatalogVersion(providerFacts, legalRules, validatedSources) !== catalogVersion) return null;
  return { catalogVersion, providerFacts, legalRules, sources: validatedSources, createdAt };
}

function asArray(value: unknown): unknown[] | null {
  if (Array.isArray(value)) return value;
  if (typeof value === "string") {
    try {
      const parsed: unknown = JSON.parse(value);
      return Array.isArray(parsed) ? parsed : null;
    } catch { return null; }
  }
  return null;
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (isRecord(value)) {
    return Object.fromEntries(Object.keys(value).sort((left, right) => left.localeCompare(right, "en")).map((key) => [key, canonicalize(value[key])]));
  }
  return value;
}

function isPublicHttpsUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password && !url.port &&
      !url.hostname.endsWith(".local") && !url.hostname.endsWith(".internal");
  } catch { return false; }
}

function isIdentifier(value: unknown, maxLength: number): value is string {
  return typeof value === "string" && value.length <= maxLength && /^[a-z0-9][a-z0-9_-]*$/u.test(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype;
}

function onlyKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  return Reflect.ownKeys(value).length === keys.length && keys.every((key) => Object.hasOwn(value, key));
}
