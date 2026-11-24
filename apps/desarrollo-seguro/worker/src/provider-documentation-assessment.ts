import {
  compareProviderDocumentation,
  type ProviderDocumentationContradiction,
  type ProviderEvidenceSource,
  type ProviderFact,
} from "@desarrolloseguro/core";
import type { ProviderCatalogSnapshot } from "@desarrolloseguro/persistence/provider-catalog";
import type { PublicServiceComparison, PublicServiceDeclarationEvidence } from "@desarrolloseguro/core";

const MAX_DOCUMENTED_FACTS_PER_PROVIDER = 30;

export function assessCatalogProviderDocumentation(input: {
  declarations: readonly PublicServiceDeclarationEvidence[] | undefined;
  snapshot: ProviderCatalogSnapshot;
}): ProviderDocumentationContradiction[] {
  if (!input.declarations || input.declarations.length > 30) return [];
  const output: ProviderDocumentationContradiction[] = [];
  for (const declaration of input.declarations) {
    if (!declaration.siteStatements?.length) continue;
    const catalogProvider = input.snapshot.providerFacts.find((candidate) =>
      isRecord(candidate) && candidate.providerId === declaration.providerId,
    );
    const providerFacts = readDocumentedFacts(catalogProvider, input.snapshot);
    const comparison = compareProviderDocumentation({
      providerId: declaration.providerId,
      sourceStatus: "located",
      siteStatements: declaration.siteStatements,
      providerFacts,
      legalRules: input.snapshot.legalRules,
    });
    if (comparison) output.push(comparison);
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
