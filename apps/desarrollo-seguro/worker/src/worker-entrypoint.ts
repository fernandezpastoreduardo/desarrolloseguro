import { createScanWorker } from "./worker-composition.js";

const SHUTDOWN_SIGNALS = ["SIGINT", "SIGTERM"] as const;

async function main(): Promise<void> {
  const shutdown = new AbortController();
  const requestShutdown = () => shutdown.abort();
  for (const signal of SHUTDOWN_SIGNALS) {
    process.once(signal, requestShutdown);
  }

  let worker: ReturnType<typeof createScanWorker> | undefined;
  try {
    worker = createScanWorker(process.env);
    await worker.run(shutdown.signal);
  } finally {
    for (const signal of SHUTDOWN_SIGNALS) {
      process.removeListener(signal, requestShutdown);
    }
    await worker?.close();
  }
}

main().catch(() => {
  process.stderr.write("scan_worker_startup_or_shutdown_failed\n");
  process.exitCode = 1;
});
