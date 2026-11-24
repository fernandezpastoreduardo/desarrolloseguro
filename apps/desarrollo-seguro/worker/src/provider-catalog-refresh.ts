import { createHash } from "node:crypto";
import {
  PROVIDER_LEGAL_RULES,
  PUBLIC_SERVICE_LEGAL_RULES,
  PUBLIC_SERVICE_PROVIDER_INFO,
} from "@desarrolloseguro/core";
import type { ProviderLegalRule } from "@desarrolloseguro/core";
import {
  PostgresProviderCatalogStore,
  type ProviderCatalogSourceReceipt,
} from "@desarrolloseguro/persistence/provider-catalog";
import { createPublicPolicyHttpsFetcher } from "./public-policy-https-fetcher.js";
import type { PublicPolicyFetchDocument } from "./public-policy-crawler.js";

const MAX_DOCUMENTS = 300;
const MAX_CATALOG_FETCH_BYTES = 20 * 1024 * 1024;
const DOCUMENT_TIMEOUT_MS = 10_000;
const FIXED_LEGAL_PRECEDENT_IDS = new Set(["aepd-pa-00027-2024"]);

type CatalogDocument = Pick<ProviderCatalogSourceReceipt, "providerId" | "documentId" | "title" | "url">;

/** Refreshes only URLs already reviewed into the bundled official-source catalog. */
export async function refreshProviderCatalog(input: {
  store: PostgresProviderCatalogStore;
  scheduledAt: Date;
  signal: AbortSignal;
  fetchDocument?: PublicPolicyFetchDocument;
  now?: () => Date;
}): Promise<string> {
  const { store, scheduledAt, signal } = input;
  const now = input.now ?? (() => new Date());
  const alreadyStarted = await store.beginRefresh(scheduledAt);
  if (!alreadyStarted) {
    const status = await store.readRefreshStatus(scheduledAt);
    if (status === "completed") {
      return (await store.readActive())?.catalogVersion ?? fail("provider_catalog_active_missing");
    }
    throw new Error(status === "running" ? "provider_catalog_refresh_in_progress" : "provider_catalog_refresh_not_started");
  }

  const fetchDocument = input.fetchDocument ?? createPublicPolicyHttpsFetcher();
  const activeBeforeRefresh = await store.readActive();
  if (!activeBeforeRefresh) throw new Error("provider_catalog_active_missing");
  const documents = collectCatalogDocuments(activeBeforeRefresh.providerFacts);
  const receipts: ProviderCatalogSourceReceipt[] = [];
  const contentDigests = new Map<string, string>();
  const documentTexts = new Map<string, string>();
  let fetchedBytes = 0;
  let failedSource = false;
  try {
    for (const document of documents) {
      if (signal.aborted) throw new Error("provider_catalog_refresh_aborted");
      if (FIXED_LEGAL_PRECEDENT_IDS.has(document.documentId)) continue;
      const parsed = new URL(document.url);
      const response = await fetchDocument({
        method: "GET",
        hostname: parsed.hostname,
        path: `${parsed.pathname}${parsed.search}`,
        signal,
        timeoutMs: DOCUMENT_TIMEOUT_MS,
      });
      fetchedBytes += response.bytesCount;
      if (fetchedBytes > MAX_CATALOG_FETCH_BYTES) throw new CatalogSourceFailure("provider_catalog_fetch_budget_exhausted");
      if (response.failureCode || response.statusCode === undefined || response.statusCode < 200 || response.statusCode >= 300 || !response.html) {
        const receipt = createReceipt(document, response.statusCode === 404 || response.statusCode === 410 ? "unavailable" : "failed", null, now());
        receipts.push(receipt);
        failedSource = true;
        continue;
      }
      const digest = createHash("sha256").update(response.html, "utf8").digest("hex");
      contentDigests.set(document.documentId, digest);
      documentTexts.set(document.documentId, htmlToText(response.html));
      receipts.push(createReceipt(document, "fetched", digest, now()));
    }

    if (failedSource) throw new CatalogSourceFailure("provider_catalog_official_source_unavailable");

    const providerFacts: Record<string, unknown>[] = Object.entries(PUBLIC_SERVICE_PROVIDER_INFO).map(([providerId, info]) => {
      const documentsForProvider = documents.filter((document) => document.providerId === providerId);
      return {
        providerId,
        displayName: info.displayName,
        serviceSummary: info.serviceSummary,
        serviceSourceUrl: info.serviceSourceUrl,
        privacyPolicyUrl: info.privacyPolicyUrl,
        officialDocuments: info.officialDocuments ?? [],
        documentedFacts: (info.documentedFacts ?? [])
          .filter((fact) => isDocumentedFactStillSupported(fact.factId, documentTexts.get(fact.documentId) ?? ""))
          .map((fact) => ({
            ...fact,
            sourceVersion: contentDigests.get(fact.documentId) ?? "source_digest_unavailable",
            checkedAt: now().toISOString(),
          })),
        officialSourceDigests: documentsForProvider.map(({ documentId, url }) => ({
          documentId,
          url,
          sha256: contentDigests.get(documentId),
        })),
        checkedAt: now().toISOString(),
      };
    });
    const bundledProviderIds = new Set(Object.keys(PUBLIC_SERVICE_PROVIDER_INFO));
    for (const discovered of activeBeforeRefresh.providerFacts) {
      if (!isRecord(discovered) || typeof discovered.providerId !== "string" || bundledProviderIds.has(discovered.providerId)) continue;
      const discoveredDocuments = documents.filter((document) => document.providerId === discovered.providerId);
      providerFacts.push({
        ...discovered,
        officialSourceDigests: discoveredDocuments.map(({ documentId, url }) => ({
          documentId,
          url,
          sha256: contentDigests.get(documentId),
        })),
        checkedAt: now().toISOString(),
      });
    }
    const gdprSanction = extractGdprSanctionScale(documentTexts.get("gdpr-official-text") ?? "");
    const legalRules = Object.entries({ ...PUBLIC_SERVICE_LEGAL_RULES, ...PROVIDER_LEGAL_RULES }).map(([ruleId, rule]) => {
      if (!("references" in rule) || !Array.isArray(rule.references)) return { ruleId, ...rule };
      const references = rule.references as ProviderLegalRule["references"];
      return {
        ruleId,
        ...rule,
        ...(ruleId.startsWith("gdpr-recipient-disclosure-") ? { sanction: gdprSanction } : {}),
        references: references.map((reference) => ({
          ...reference,
          ...(contentDigests.has(reference.sourceId)
            ? { version: `sha256:${contentDigests.get(reference.sourceId)}` }
            : {}),
          checkedAt: now().toISOString(),
        })),
      };
    });
    return await store.activate({ providerFacts, legalRules, sources: receipts, scheduledAt });
  } catch (error) {
    await store.failRefresh(scheduledAt, error instanceof CatalogSourceFailure ? "official_source_unavailable" : "refresh_failed", receipts);
    throw error;
  }
}

export function collectCatalogDocuments(discoveredFacts: readonly unknown[] = []): CatalogDocument[] {
  const documents = new Map<string, CatalogDocument>();
  for (const [providerId, info] of Object.entries(PUBLIC_SERVICE_PROVIDER_INFO)) {
    const candidates: CatalogDocument[] = [
      { providerId, documentId: `${providerId}-service-source`, title: `${info.displayName} service documentation`, url: info.serviceSourceUrl },
      { providerId, documentId: `${providerId}-privacy-policy`, title: `${info.displayName} privacy documentation`, url: info.privacyPolicyUrl },
      ...(info.officialDocuments ?? []).map(({ documentId, title, url }) => ({ providerId, documentId, title, url })),
    ];
    for (const document of candidates) {
      if (!isSafeCatalogDocument(document)) continue;
      documents.set(`${document.providerId}:${document.documentId}`, document);
    }
  }
  for (const rule of Object.values(PROVIDER_LEGAL_RULES)) {
    for (const reference of rule.references) {
      if (FIXED_LEGAL_PRECEDENT_IDS.has(reference.sourceId)) continue;
      const document: CatalogDocument = {
        providerId: "legal-authority",
        documentId: reference.sourceId,
        title: reference.title,
        url: reference.url,
      };
      if (isSafeCatalogDocument(document)) documents.set(`${document.providerId}:${document.documentId}`, document);
    }
  }
  const bundledProviderIds = new Set(Object.keys(PUBLIC_SERVICE_PROVIDER_INFO));
  for (const fact of discoveredFacts) {
    if (!isRecord(fact) || typeof fact.providerId !== "string" || bundledProviderIds.has(fact.providerId) || !Array.isArray(fact.officialDocuments)) continue;
    for (const candidate of fact.officialDocuments) {
      if (!isRecord(candidate) || typeof candidate.documentId !== "string" || typeof candidate.title !== "string" || typeof candidate.url !== "string") continue;
      const document: CatalogDocument = { providerId: fact.providerId, documentId: candidate.documentId, title: candidate.title, url: candidate.url };
      if (isSafeCatalogDocument(document)) documents.set(`${document.providerId}:${document.documentId}`, document);
    }
  }
  const values = [...documents.values()];
  if (values.length === 0 || values.length > MAX_DOCUMENTS) throw new Error("provider_catalog_document_set_invalid");
  return values.sort((left, right) => `${left.providerId}:${left.documentId}`.localeCompare(`${right.providerId}:${right.documentId}`, "en"));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Extracts the Article 83(5) scale from the official, fetched regulation text. */
export function extractGdprSanctionScale(documentText: string): ProviderLegalRule["sanction"] {
  const normalized = documentText.normalize("NFKC").toLowerCase();
  const articleStart = normalized.search(/\b(?:article|art[ií]culo)\s+83\b/u);
  if (articleStart < 0) throw new Error("provider_catalog_legal_article_missing");
  const article = normalized.slice(articleStart, articleStart + 24_000);
  const paragraphStart = article.search(/\(?5\)?[.\s]+(?:(?:infringements?\s+of\s+the\s+following\s+provisions)|(?:las\s+infracciones?\s+de\s+las\s+disposiciones\s+siguientes))/u);
  if (paragraphStart < 0) throw new Error("provider_catalog_legal_paragraph_missing");
  const paragraph = article.slice(paragraphStart, paragraphStart + 4_000);
  const amountPhrases = ["administrative fines up to", "fines up to", "multas administrativas de", "multas administrativas hasta"];
  const amountPhraseIndex = amountPhrases
    .map((phrase) => ({ phrase, index: paragraph.indexOf(phrase) }))
    .filter(({ index }) => index >= 0)
    .sort((left, right) => left.index - right.index)[0];
  const amountText = amountPhraseIndex
    ? paragraph.slice(amountPhraseIndex.index + amountPhraseIndex.phrase.length).trimStart().replace(/^€\s*|^eur\s*/u, "")
    : "";
  const amountMatch = amountText.match(/^([0-9][0-9 ,.]{0,30})\s*(?:eur|euros|€)/u);
  const percentageMatch = paragraph.match(/(?:up\s+to|hasta|equivalente\s+al)\s+(\d+(?:[.,]\d+)?)\s*%/u);
  const amount = amountMatch?.[1]?.replace(/\D/gu, "");
  const percentage = percentageMatch?.[1]?.replace(",", ".");
  const fixedAmount = Number(amount);
  const turnoverPercentage = Number(percentage);
  if (!Number.isSafeInteger(fixedAmount) || fixedAmount < 1_000 || fixedAmount > 100_000_000 ||
      !Number.isFinite(turnoverPercentage) || turnoverPercentage <= 0 || turnoverPercentage > 100) {
    throw new Error("provider_catalog_legal_sanction_unparseable");
  }
  return {
    type: "greater_of",
    alternatives: [
      { type: "fixed_amount", currency: "EUR", amount: fixedAmount },
      { type: "global_annual_turnover_percentage", percentage: turnoverPercentage },
    ],
    legalBasis: "GDPR Article 83(5)(b)",
    isSpecificFinePrediction: false,
  };
}

function isSafeCatalogDocument(document: CatalogDocument): boolean {
  try {
    const url = new URL(document.url);
    return url.protocol === "https:" && !url.username && !url.password && !url.port &&
      url.hostname.includes(".") && document.documentId.length <= 96 && document.title.length <= 240;
  } catch {
    return false;
  }
}

function htmlToText(html: string): string {
  return html.replace(/<(script|style|noscript|template)\b[^>]*>[\s\S]*?<\/\1\s*>/giu, " ")
    .replace(/<[^<]*>/gu, " ")
    .replace(/&nbsp;|&#160;/giu, " ")
    .replace(/&amp;/giu, "&")
    .replace(/&quot;|&#34;/giu, '"')
    .replace(/&#39;|&apos;/giu, "'")
    .replace(/&lt;/giu, "<")
    .replace(/&gt;/giu, ">")
    .replace(/\s+/gu, " ")
    .normalize("NFKC")
    .toLowerCase()
    .slice(0, 512 * 1024);
}

function isDocumentedFactStillSupported(factId: string, documentText: string): boolean {
  if (factId === "provider_receives_content") {
    return documentText.includes("abuse monitoring") &&
      (documentText.includes("input") || documentText.includes("output") || documentText.includes("prompt")) ||
      documentText.includes("smtp") && (documentText.includes("send") || documentText.includes("envia")) &&
        (documentText.includes("server") || documentText.includes("servidor"));
  }
  return false;
}

function createReceipt(
  document: CatalogDocument,
  status: ProviderCatalogSourceReceipt["status"],
  sha256: string | null,
  checkedAt: Date,
): ProviderCatalogSourceReceipt {
  return { ...document, status, sha256, checkedAt: checkedAt.toISOString() };
}

function fail(code: string): never {
  throw new Error(code);
}

class CatalogSourceFailure extends Error {}
