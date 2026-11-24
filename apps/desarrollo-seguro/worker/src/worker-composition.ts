import { createHash } from "node:crypto";
import { Pool } from "pg";
import { PostgresScanStore } from "@desarrolloseguro/persistence";
import { PostgresProviderCatalogStore } from "@desarrolloseguro/persistence/provider-catalog";
import { RuntimeCoordinatorExecutor } from "./runtime-coordinator-executor.js";
import { ProcessorAuditorClient } from "./processor-auditor-client.js";
import { ProcessorAuditorScanExecutor } from "./processor-auditor-scan-executor.js";
import { ScanJobProcessor } from "./scan-job-processor.js";
import { createJsonLineScanJobTelemetry } from "./scan-job-telemetry.js";
import { resolveScanWorkerConfiguration } from "./worker-configuration.js";
import { resolveScanWorkerPoolConfig } from "./worker-pool-config.js";
import { runScanWorker } from "./worker-runtime.js";
import { runProviderCatalogScheduler } from "@desarrolloseguro/persistence/provider-catalog-scheduler";
import { refreshProviderCatalog } from "./provider-catalog-refresh.js";
import { identifyUnattributedProviderDestination } from "./provider-destination-identity.js";
import { toCatalogedProviderDocumentDiscovery } from "./provider-document-discovery.js";
import {
  assessCatalogProviderDocumentation,
  getProviderLegalEvidenceContexts,
  mergeProviderDocumentationComparison,
} from "./provider-documentation-assessment.js";

export function createScanWorker(
  environment: NodeJS.ProcessEnv,
  writeTelemetry?: (line: string) => void,
) {
  const configuration = resolveScanWorkerConfiguration(environment);
  const pool = new Pool(resolveScanWorkerPoolConfig(environment));
  const store = new PostgresScanStore(pool);
  const providerCatalog = new PostgresProviderCatalogStore(pool);
  const scanExecutor = new RuntimeCoordinatorExecutor({
    socketPath: configuration.coordinatorSocketPath,
    expectedSocketUid: configuration.coordinatorUid,
    expectedSocketGid: configuration.coordinatorGid,
  });
  const executor = new ProcessorAuditorScanExecutor(
    scanExecutor,
    new ProcessorAuditorClient({
      socketPath: configuration.processorAuditorSocketPath,
      expectedSocketUid: configuration.processorAuditorUid,
      expectedSocketGid: configuration.processorAuditorGid,
    }),
    environment.DS_RELEASE_REVISION ?? "",
  );
  const catalogAwareExecutor = {
    assertReady: () => executor.assertReady(),
    async execute(job: Parameters<typeof executor.execute>[0], signal: AbortSignal) {
      const result = await executor.execute(job, signal);
      let snapshot = await providerCatalog.readActive();
      if (!snapshot) throw new Error("provider_catalog_active_missing");
      const firstParty = job.hostname.toLowerCase();
      const catalogedProviderIds = new Set(snapshot.providerFacts
        .filter(isRecord)
        .map((provider) => provider.providerId)
        .filter((providerId): providerId is string => typeof providerId === "string"));
      for (const item of result.publicServiceComparison?.items ?? []) {
        if (!item.providerId.startsWith("dst_") || catalogedProviderIds.has(item.providerId)) continue;
        const domain = item.observedDomains[0];
        if (!domain) continue;
        const identity = identifyUnattributedProviderDestination(domain);
        if (identity.providerId !== item.providerId) throw new Error("provider_destination_identity_mismatch");
        const scanDate = result.startedAt.toISOString();
        await providerCatalog.recordDiscoveredProvider({
          providerId: identity.providerId,
          displayName: identity.displayName,
          aliases: [identity.hostname],
          products: [],
          evidence: {
            kind: "observed_destination",
            sourceId: `scan_${createHash("sha256").update(`${job.id}:${identity.hostname}`).digest("hex").slice(0, 24)}`,
            title: "Solicitud externa completada durante la auditoría",
            url: `https://${firstParty}/`,
            capturedAt: scanDate,
            excerpt: `El navegador completó una solicitud desde ${firstParty} hacia ${identity.hostname}. El dominio identifica el destino observado, no una empresa ni el tratamiento recibido.`,
            destinationHostname: identity.hostname,
          },
          officialDocuments: [],
        });
        catalogedProviderIds.add(identity.providerId);
      }
      for (const document of result.publicPolicyDiscoveredDocuments ?? []) {
        const discovery = toCatalogedProviderDocumentDiscovery({
          document,
          providerFacts: snapshot.providerFacts,
          capturedAt: result.completedAt.toISOString(),
        });
        if (discovery) await providerCatalog.recordDiscoveredProvider(discovery);
      }
      snapshot = await providerCatalog.readActive();
      if (!snapshot) throw new Error("provider_catalog_active_missing");
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
      const providerDocumentation = assessCatalogProviderDocumentation({
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
      const publicServiceComparison = mergeProviderDocumentationComparison(
        result.publicServiceComparison,
        providerDocumentation,
      );
      const completed = { ...result, providerCatalogVersion: snapshot.catalogVersion };
      delete completed.publicServiceDeclarations;
      return {
        ...completed,
        ...(publicServiceComparison ? { publicServiceComparison } : {}),
      };
    },
  };
  const processor = new ScanJobProcessor(
    store,
    catalogAwareExecutor,
    undefined,
    undefined,
    createJsonLineScanJobTelemetry(writeTelemetry),
  );

  return {
    run: async (signal: AbortSignal) => {
      await providerCatalog.seedBundledCatalogIfMissing();
      await Promise.all([
        runScanWorker(processor, {
          signal,
          idleDelayMs: configuration.idleDelayMs,
          errorDelayMs: configuration.errorDelayMs,
        }),
        runProviderCatalogScheduler({
          signal,
          refresh: (scheduledAt) => refreshProviderCatalog({
            store: providerCatalog,
            scheduledAt,
            signal,
          }).then(() => undefined),
          onError: () => writeTelemetry?.("provider_catalog_refresh_failed\n"),
          onSuccess: () => writeTelemetry?.("provider_catalog_refresh_completed\n"),
        }),
      ]);
    },
    close: () => store.close(),
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
