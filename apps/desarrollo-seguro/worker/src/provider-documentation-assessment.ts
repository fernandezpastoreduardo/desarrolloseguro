import {
  compareProviderDocumentation,
  type ProviderDocumentationContradiction,
  type ProviderDocumentationSourceReceipt,
  type ProviderEvidenceSource,
  type ProviderFact,
} from "@desarrolloseguro/core";
import type { ProviderCatalogSnapshot } from "@desarrolloseguro/persistence/provider-catalog";
import type { PublicServiceComparison, PublicServiceDeclarationEvidence } from "@desarrolloseguro/core";

const MAX_DOCUMENTED_FACTS_PER_PROVIDER = 30;

export function assessCatalogProviderDocumentation(input: {
  declarations: readonly PublicServiceDeclarationEvidence[] | undefined;
  observedProviderIds?: readonly string[];
  snapshot: ProviderCatalogSnapshot;
}): ProviderDocumentationContradiction[] {
  const declarations = input.declarations ?? [];
  const observedProviderIds = input.observedProviderIds ?? [];
  if (declarations.length > 30 || observedProviderIds.length > 30) return [];
  const declarationsByProvider = new Map(declarations.map((declaration) => [declaration.providerId, declaration]));
  const providerIds = [...new Set([...observedProviderIds, ...declarations.map(({ providerId }) => providerId)])].slice(0, 30);
  const output: ProviderDocumentationContradiction[] = [];
  for (const providerId of providerIds) {
    const declaration = declarationsByProvider.get(providerId);
    const catalogProvider = input.snapshot.providerFacts.find((candidate) =>
      isRecord(candidate) && candidate.providerId === providerId,
    );
    const providerFacts = readDocumentedFacts(catalogProvider, input.snapshot);
    const documentationStatus = isRecord(catalogProvider) && isDocumentationStatus(catalogProvider.documentationStatus)
      ? catalogProvider.documentationStatus
      : "source_not_localized";
    const comparison = compareProviderDocumentation({
      providerId,
      sourceStatus: documentationStatus === "located" ? "located"
        : documentationStatus === "source_unavailable" ? "unavailable" : "not_located",
      siteStatements: declaration?.siteStatements ?? [],
      providerFacts: documentationStatus === "located" ? providerFacts : [],
      legalRules: input.snapshot.legalRules,
    });
    if (comparison) {
      const sourceEvidence = readSourceEvidence(providerId, catalogProvider, input.snapshot);
      output.push({ ...comparison, ...(sourceEvidence.length ? { sourceEvidence } : {}) });
    }
  }
  return output;
}

export function mergeProviderDocumentationComparison(
  base: PublicServiceComparison | null | undefined,
  providerDocumentation: readonly ProviderDocumentationContradiction[],
): PublicServiceComparison | null {
  if (!base) return null;
  const hasContradiction = providerDocumentation.some(({ status }) => status === "contradiction_confirmed");
  return {
    ...base,
    status: base.status === "fail" || hasContradiction ? "fail" : base.status,
    reasonCode: hasContradiction
      ? "provider_documentation_contradiction"
      : base.reasonCode,
    ...(providerDocumentation.length ? { providerDocumentation: [...providerDocumentation] } : {}),
  };
}

function readDocumentedFacts(provider: unknown, snapshot: ProviderCatalogSnapshot): ProviderFact[] {
  if (!isRecord(provider) || !Array.isArray(provider.documentedFacts) || provider.documentedFacts.length > MAX_DOCUMENTED_FACTS_PER_PROVIDER) return [];
  const documents = readOfficialDocuments(provider.officialDocuments);
  const output: ProviderFact[] = [];
  for (const entry of provider.documentedFacts) {
    if (!isRecord(entry) || typeof entry.factId !== "string" || typeof entry.value !== "boolean" ||
        typeof entry.documentId !== "string" || typeof entry.excerpt !== "string") continue;
    const document = documents.get(entry.documentId);
    if (!document) continue;
    const receipt = snapshot.sources.find((source) => source.documentId === entry.documentId && source.providerId === provider.providerId);
    if (!receipt || receipt.status !== "fetched" || !receipt.sha256) continue;
    const source: ProviderEvidenceSource = {
      sourceId: entry.documentId,
      version: receipt.sha256,
      title: document.title,
      url: document.url,
      capturedAt: receipt.checkedAt,
      excerpt: entry.excerpt.slice(0, 500),
      documentKind: document.kind,
      sourceKind: "provider_official",
    };
    output.push({ factId: entry.factId, value: entry.value, source });
  }
  return output;
}

function readSourceEvidence(
  providerId: string,
  provider: unknown,
  snapshot: ProviderCatalogSnapshot,
): ProviderDocumentationSourceReceipt[] {
  if (!isRecord(provider) || !Array.isArray(provider.officialDocuments) || provider.officialDocuments.length > 50) return [];
  const documents = new Map<string, { title: string; url: string }>();
  for (const entry of provider.officialDocuments) {
    if (!isRecord(entry) || typeof entry.documentId !== "string" || typeof entry.title !== "string" || typeof entry.url !== "string") continue;
    documents.set(entry.documentId, { title: entry.title, url: entry.url });
  }
  return snapshot.sources.flatMap((receipt) => {
    const document = receipt.providerId === providerId ? documents.get(receipt.documentId) : undefined;
    if (!document || !["seeded", "fetched", "unavailable", "failed", "not_localized"].includes(receipt.status)) return [];
    return [{
      documentId: receipt.documentId,
      title: document.title,
      url: document.url,
      status: receipt.status,
      sha256: receipt.sha256,
      checkedAt: receipt.checkedAt,
    }];
  }).slice(0, 50);
}

function readOfficialDocuments(value: unknown): Map<string, { title: string; url: string; kind: ProviderEvidenceSource["documentKind"] }> {
  const output = new Map<string, { title: string; url: string; kind: ProviderEvidenceSource["documentKind"] }>();
  if (!Array.isArray(value) || value.length > 50) return output;
  for (const document of value) {
    if (!isRecord(document) || typeof document.documentId !== "string" || typeof document.title !== "string" ||
        typeof document.url !== "string" || !["privacy", "terms", "dpa", "subprocessors", "service-documentation"].includes(String(document.kind))) continue;
    const kind = document.kind === "privacy" ? "privacy"
      : document.kind === "terms" ? "terms"
        : document.kind === "dpa" ? "legal"
          : document.kind === "subprocessors" ? "legal" : "service";
    output.set(document.documentId, { title: document.title, url: document.url, kind });
  }
  return output;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isDocumentationStatus(value: unknown): value is "located" | "source_unavailable" | "source_not_localized" {
  return value === "located" || value === "source_unavailable" || value === "source_not_localized";
}
