import { describe, expect, it, vi } from "vitest";
import {
  runScanWorker,
  type ScanWorkerRuntime,
} from "./worker-runtime.js";

describe("runScanWorker", () => {
  it("processes jobs serially and waits only when idle", async () => {
    const controller = new AbortController();
    const outcomes: Array<"completed" | "idle"> = [
      "completed",
      "idle",
      "completed",
    ];
    const processNext = vi.fn(async () => {
      const outcome = outcomes.shift() ?? "idle";
      if (processNext.mock.calls.length === 3) controller.abort();
      return outcome;
    });
    const wait = vi.fn(async () => undefined);
    const runtime = { processNext } as unknown as ScanWorkerRuntime;

    await runScanWorker(runtime, {
      signal: controller.signal,
      idleDelayMs: 25,
      errorDelayMs: 100,
      wait,
    });

    expect(processNext).toHaveBeenCalledTimes(3);
    expect(wait).toHaveBeenCalledTimes(1);
    expect(wait).toHaveBeenCalledWith(25, controller.signal);
  });

  it("backs off after an internal failure without exposing its message", async () => {
    const controller = new AbortController();
    let attempts = 0;
    const processNext = vi.fn(async () => {
      attempts += 1;
      if (attempts === 1) throw new Error("private database detail");
      controller.abort();
      return "idle" as const;
    });
    const wait = vi.fn(async () => undefined);
    const runtime = { processNext } as unknown as ScanWorkerRuntime;

    await expect(
      runScanWorker(runtime, {
        signal: controller.signal,
        idleDelayMs: 25,
        errorDelayMs: 250,
        wait,
      }),
    ).resolves.toBeUndefined();

    expect(wait).toHaveBeenCalledTimes(1);
    expect(wait).toHaveBeenCalledWith(250, controller.signal);
  });

  it("does not claim work after shutdown is requested", async () => {
    const controller = new AbortController();
    controller.abort();
    const processNext = vi.fn();
    const runtime = { processNext } as unknown as ScanWorkerRuntime;

    await runScanWorker(runtime, { signal: controller.signal });

    expect(processNext).not.toHaveBeenCalled();
  });

  it("interrupts the default idle wait when shutdown is requested", async () => {
    vi.useFakeTimers();
    const controller = new AbortController();
    const processNext = vi.fn().mockResolvedValue("idle");
    const runtime = { processNext } as unknown as ScanWorkerRuntime;
    try {
      const worker = runScanWorker(runtime, {
        signal: controller.signal,
        idleDelayMs: 60_000,
      });
      await vi.advanceTimersByTimeAsync(0);
      expect(processNext).toHaveBeenCalledOnce();

      controller.abort();
      await expect(worker).resolves.toBeUndefined();
      expect(processNext).toHaveBeenCalledOnce();
    } finally {
      controller.abort();
      vi.useRealTimers();
    }
  });
});
