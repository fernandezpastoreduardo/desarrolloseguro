import { createHash } from "node:crypto";
import type { ProviderDiscoveryInput } from "@desarrolloseguro/persistence/provider-catalog";
import type { PublicPolicyDiscoveredDocument } from "./public-policy-document-boundary.js";
import { findUniqueCatalogedOfficialDocument } from "./provider-document-attribution.js";

export function toCatalogedProviderDocumentDiscovery(input: {
  document: PublicPolicyDiscoveredDocument;
  providerFacts: readonly unknown[];
  capturedAt: string;
}): ProviderDiscoveryInput | null {
  const { document } = input;
  if (document.fetchStatus === "not_fetched") return null;
  const match = findUniqueCatalogedOfficialDocument(document.href, input.providerFacts);
  if (!match) return null;
  const status = document.fetchStatus === "fetched" ? "fetched"
    : document.fetchStatus === "unavailable" ? "unavailable" : "failed";
  const documentId = `audited_${createHash("sha256").update(`${match.providerId}\n${document.href}\n${status}\n${document.sha256 ?? ""}`).digest("hex").slice(0, 32)}`;
  const sourceId = `site_ref_${createHash("sha256").update(`${match.providerId}\n${document.sourcePageUrl}\n${document.href}\n${document.anchorText}`).digest("hex").slice(0, 32)}`;
  return {
    providerId: match.providerId,
    displayName: match.displayName,
    aliases: [],
    products: [],
    evidence: {
      kind: "explicit_site_reference",
      sourceId,
      title: "La política del sitio enlaza documentación oficial catalogada",
      url: document.sourcePageUrl,
      capturedAt: input.capturedAt,
      excerpt: `La página auditada enlaza «${document.anchorText}» con la URL oficial exacta ya catalogada para ${match.displayName}.`,
    },
    officialDocuments: [{
      documentId,
      kind: match.kind,
      title: match.title,
      url: document.href,
      discoveryMethod: "audited_site_link",
      status,
      sha256: document.fetchStatus === "fetched" ? document.sha256 : null,
      checkedAt: input.capturedAt,
      ...(document.fetchStatus === "fetched" && document.documentRole === "provider_document" && document.documentedFacts?.length
        ? { documentedFacts: document.documentedFacts.map((fact) => ({
            factId: fact.factId as "provider_receives_personal_data",
            value: fact.value,
            excerpt: fact.excerpt,
          })) }
        : {}),
    }],
  };
}
