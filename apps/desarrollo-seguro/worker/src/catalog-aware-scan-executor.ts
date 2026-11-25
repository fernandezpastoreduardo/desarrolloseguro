import { createHash } from "node:crypto";
import type { ClaimedScanJob } from "@desarrolloseguro/persistence";
import {
  PostgresProviderCatalogStore,
  type ProviderCatalogSnapshot,
} from "@desarrolloseguro/persistence/provider-catalog";
import type { ScanExecutor } from "./scan-job-processor.js";
import type { ScanExecutorResult } from "./public-policy-document-boundary.js";
import { identifyUnattributedProviderDestination } from "./provider-destination-identity.js";
import { toCatalogedProviderDocumentDiscovery } from "./provider-document-discovery.js";
import {
  assessCatalogProviderDocumentation,
  getProviderLegalEvidenceContexts,
  mergeProviderDocumentationComparison,
} from "./provider-documentation-assessment.js";
import { withScanFailureStage } from "./runtime-diagnostics.js";

type ProviderCatalog = Pick<
  PostgresProviderCatalogStore,
  "readActive" | "recordDiscoveredProvider"
>;

export class CatalogAwareScanExecutor implements ScanExecutor {
  constructor(
    private readonly executor: ScanExecutor,
    private readonly providerCatalog: ProviderCatalog,
  ) {}

  assertReady(): Promise<void> {
    return this.executor.assertReady?.() ?? Promise.resolve();
  }

  async execute(job: ClaimedScanJob, signal: AbortSignal): Promise<ScanExecutorResult> {
    const result = await this.executor.execute(job, signal);
    let snapshot = await withScanFailureStage("provider_catalog_initial_read", async () => {
      const active = await this.providerCatalog.readActive();
      if (!active) throw new Error("provider_catalog_active_missing");
      return active;
    });

    const catalogedProviderIds = new Set(snapshot.providerFacts
      .filter(isRecord)
      .map((provider) => provider.providerId)
      .filter((providerId): providerId is string => typeof providerId === "string"));

    for (const item of result.publicServiceComparison?.items ?? []) {
      if (!item.providerId.startsWith("dst_") || catalogedProviderIds.has(item.providerId)) continue;
      const domain = item.observedDomains[0];
      if (!domain) continue;
      const identity = await withScanFailureStage("provider_discovery_identity", () => {
        const identified = identifyUnattributedProviderDestination(domain);
        if (identified.providerId !== item.providerId) {
          throw new Error("provider_destination_identity_mismatch");
        }
        return identified;
      });
      await withScanFailureStage("provider_discovery_record", () =>
        this.providerCatalog.recordDiscoveredProvider({
          providerId: identity.providerId,
          displayName: identity.displayName,
          aliases: [identity.hostname],
          products: [],
          evidence: {
            kind: "observed_destination",
            sourceId: `scan_${createHash("sha256").update(`${job.id}:${identity.hostname}`).digest("hex").slice(0, 24)}`,
            title: "Solicitud externa completada durante la auditoría",
            url: `https://${job.hostname.toLowerCase()}/`,
            capturedAt: result.startedAt.toISOString(),
            excerpt: `El navegador completó una solicitud desde ${job.hostname.toLowerCase()} hacia ${identity.hostname}. El dominio identifica el destino observado, no una empresa ni el tratamiento recibido.`,
            destinationHostname: identity.hostname,
          },
          officialDocuments: [],
        }));
      catalogedProviderIds.add(identity.providerId);
    }

    const documentDiscoveries = await withScanFailureStage(
      "provider_document_discovery",
      () => (result.publicPolicyDiscoveredDocuments ?? []).map((document) =>
        toCatalogedProviderDocumentDiscovery({
          document,
          providerFacts: snapshot.providerFacts,
          capturedAt: result.completedAt.toISOString(),
        })),
    );
    for (const discovery of documentDiscoveries) {
      if (discovery) {
        await withScanFailureStage("provider_document_discovery", () =>
          this.providerCatalog.recordDiscoveredProvider(discovery));
      }
    }

    snapshot = await withScanFailureStage("provider_catalog_refresh_read", async () => {
      const active = await this.providerCatalog.readActive();
      if (!active) throw new Error("provider_catalog_active_missing");
      return active;
    });

    const documentation = await withScanFailureStage(
      "provider_documentation_assessment",
      () => buildProviderDocumentation(result, snapshot),
    );
    const publicServiceComparison = await withScanFailureStage(
      "provider_comparison_merge",
      () => mergeProviderDocumentationComparison(
        result.publicServiceComparison,
        documentation,
      ),
    );

    return withScanFailureStage("provider_catalog_result_assembly", () => {
      const completed = { ...result, providerCatalogVersion: snapshot.catalogVersion };
      delete completed.publicServiceDeclarations;
      return {
        ...completed,
        ...(publicServiceComparison ? { publicServiceComparison } : {}),
      };
    });
  }
}

function buildProviderDocumentation(
  result: ScanExecutorResult,
  snapshot: ProviderCatalogSnapshot,
) {
  const providerDocumentUrls = new Set((result.publicPolicyDiscoveredDocuments ?? []).flatMap((document) =>
    toCatalogedProviderDocumentDiscovery({
      document,
      providerFacts: snapshot.providerFacts,
      capturedAt: result.completedAt.toISOString(),
    }) ? [document.href] : [],
  ));
  const siteDeclarations = (result.publicServiceDeclarations ?? []).map((declaration) => ({
    ...declaration,
    ...(declaration.siteStatements
      ? { siteStatements: declaration.siteStatements.filter((statement) =>
          !providerDocumentUrls.has(statement.source.url)) }
      : {}),
  }));
  return assessCatalogProviderDocumentation({
    declarations: siteDeclarations,
    observedProviderIds: (result.publicServiceComparison?.items ?? []).map(({ providerId }) => providerId),
    linkedProviderIds: (result.publicPolicyDiscoveredDocuments ?? []).flatMap((document) => {
      const discovery = toCatalogedProviderDocumentDiscovery({
        document,
        providerFacts: snapshot.providerFacts,
        capturedAt: result.completedAt.toISOString(),
      });
      return discovery ? [discovery.providerId] : [];
    }),
    legalEvidenceContexts: getProviderLegalEvidenceContexts(siteDeclarations),
    snapshot,
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
