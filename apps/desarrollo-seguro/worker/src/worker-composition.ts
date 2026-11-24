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
import {
  assessCatalogProviderDocumentation,
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
      const knownObservedDomains = new Set((result.publicServiceComparison?.items ?? [])
        .flatMap(({ observedDomains }) => observedDomains.map((domain) => domain.toLowerCase())));
      const firstParty = job.hostname.toLowerCase();
      for (const hostname of result.privacyAssessment?.evidence.domains ?? []) {
        const domain = hostname.toLowerCase().replace(/^\.|\.$/gu, "");
        if (!domain || domain === firstParty || domain.endsWith(`.${firstParty}`) || knownObservedDomains.has(domain)) continue;
        const suffix = createHash("sha256").update(domain).digest("hex").slice(0, 8);
        let slug = domain.replace(/[^a-z0-9]+/giu, "_");
        while (slug.startsWith("_")) slug = slug.slice(1);
        while (slug.endsWith("_")) slug = slug.slice(0, -1);
        slug = slug.slice(0, 20) || "external";
        const scanDate = result.startedAt.toISOString();
        await providerCatalog.recordDiscoveredProvider({
          providerId: `dst_${slug}_${suffix}`.slice(0, 32),
          displayName: `Destino externo ${domain}`.slice(0, 120),
          aliases: [domain],
          products: [],
          evidence: {
            kind: "observed_destination",
            sourceId: `scan_${suffix}`,
            title: "Solicitud de red observada durante la auditoría",
            url: `https://${firstParty}/`,
            capturedAt: scanDate,
            excerpt: `La auditoría observó una solicitud desde ${firstParty} hacia ${domain}. Esto identifica un destino de red y no atribuye por sí solo una empresa ni un tratamiento de datos.`,
            destinationHostname: domain,
            destinationPath: "/",
          },
          officialDocuments: [],
        });
      }
      snapshot = await providerCatalog.readActive();
      if (!snapshot) throw new Error("provider_catalog_active_missing");
      const providerDocumentation = assessCatalogProviderDocumentation({
        declarations: result.publicServiceDeclarations,
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
