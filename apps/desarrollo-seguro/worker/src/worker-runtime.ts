import type { ScanJobOutcome } from "./scan-job-processor.js";

export type ScanWorkerRuntime = {
  processNext(): Promise<ScanJobOutcome>;
};

export type ScanWorkerLoopOptions = {
  signal: AbortSignal;
  idleDelayMs?: number;
  errorDelayMs?: number;
  wait?: (delayMs: number, signal: AbortSignal) => Promise<void>;
};

const DEFAULT_IDLE_DELAY_MS = 1_000;
const DEFAULT_ERROR_DELAY_MS = 5_000;

export async function runScanWorker(
  runtime: ScanWorkerRuntime,
  options: ScanWorkerLoopOptions,
): Promise<void> {
  const idleDelayMs = options.idleDelayMs ?? DEFAULT_IDLE_DELAY_MS;
  const errorDelayMs = options.errorDelayMs ?? DEFAULT_ERROR_DELAY_MS;
  const wait = options.wait ?? waitForDelay;
  assertDelay(idleDelayMs);
  assertDelay(errorDelayMs);

  while (!options.signal.aborted) {
    try {
      const outcome = await runtime.processNext();
      if (outcome === "idle" && !options.signal.aborted) {
        await wait(idleDelayMs, options.signal);
      }
    } catch {
      if (!options.signal.aborted) {
        await wait(errorDelayMs, options.signal);
      }
    }
  }
}

function assertDelay(value: number): void {
  if (!Number.isSafeInteger(value) || value < 1 || value > 600_000) {
    throw new Error("scan_worker_delay_invalid");
  }
}

function waitForDelay(delayMs: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.resolve();
  return new Promise((resolve) => {
    const finish = () => {
      clearTimeout(timer);
      signal.removeEventListener("abort", finish);
      resolve();
    };
    const timer = setTimeout(finish, delayMs);
    timer.unref?.();
    signal.addEventListener("abort", finish, { once: true });
  });
}
