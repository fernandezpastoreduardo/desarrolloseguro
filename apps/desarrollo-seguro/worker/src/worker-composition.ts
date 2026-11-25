import { Pool } from "pg";
import { PostgresScanStore } from "@desarrolloseguro/persistence";
import { PostgresProviderCatalogStore } from "@desarrolloseguro/persistence/provider-catalog";
import { RuntimeCoordinatorExecutor } from "./runtime-coordinator-executor.js";
import { ProcessorAuditorClient } from "./processor-auditor-client.js";
import { ProcessorAuditorScanExecutor } from "./processor-auditor-scan-executor.js";
import { CatalogAwareScanExecutor } from "./catalog-aware-scan-executor.js";
import { ScanJobProcessor } from "./scan-job-processor.js";
import { createJsonLineScanJobTelemetry } from "./scan-job-telemetry.js";
import { resolveScanWorkerConfiguration } from "./worker-configuration.js";
import { resolveScanWorkerPoolConfig } from "./worker-pool-config.js";
import { runScanWorker } from "./worker-runtime.js";
import { runProviderCatalogScheduler } from "@desarrolloseguro/persistence/provider-catalog-scheduler";
import { refreshProviderCatalog } from "./provider-catalog-refresh.js";

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
  const catalogAwareExecutor = new CatalogAwareScanExecutor(executor, providerCatalog);
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
