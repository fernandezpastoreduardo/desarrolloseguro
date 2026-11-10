import { Pool } from "pg";
import { PostgresScanStore } from "@desarrolloseguro/persistence";
import { RuntimeCoordinatorExecutor } from "./runtime-coordinator-executor.js";
import { ScanJobProcessor } from "./scan-job-processor.js";
import { createJsonLineScanJobTelemetry } from "./scan-job-telemetry.js";
import { resolveScanWorkerConfiguration } from "./worker-configuration.js";
import { resolveScanWorkerPoolConfig } from "./worker-pool-config.js";
import { runScanWorker } from "./worker-runtime.js";

export function createScanWorker(
  environment: NodeJS.ProcessEnv,
  writeTelemetry?: (line: string) => void,
) {
  const configuration = resolveScanWorkerConfiguration(environment);
  const pool = new Pool(resolveScanWorkerPoolConfig(environment));
  const store = new PostgresScanStore(pool);
  const executor = new RuntimeCoordinatorExecutor({
    socketPath: configuration.coordinatorSocketPath,
    expectedSocketUid: configuration.coordinatorUid,
    expectedSocketGid: configuration.coordinatorGid,
  });
  const processor = new ScanJobProcessor(
    store,
    executor,
    undefined,
    undefined,
    createJsonLineScanJobTelemetry(writeTelemetry),
  );

  return {
    run: (signal: AbortSignal) =>
      runScanWorker(processor, {
        signal,
        idleDelayMs: configuration.idleDelayMs,
        errorDelayMs: configuration.errorDelayMs,
      }),
    close: () => store.close(),
  };
}
