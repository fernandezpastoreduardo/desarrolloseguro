import { describe, expect, it, vi } from "vitest";
import { PRIVACY_BROWSER_BUDGET } from "@desarrolloseguro/core";
import { PERFORMANCE_OBSERVATION_DURATION_MS, type PerformanceBrowserEvidence } from "./performance-browser-observer.js";
import type { PrivacyBrowserObservation } from "./privacy-browser-observer.js";
import { observePrivacyAndPerformance } from "./privacy-browser-observation.js";

describe("observePrivacyAndPerformance", () => {
  it("gives performance a fresh deadline after privacy uses its own deadline", async () => {
    const input = {
      protocolVersion: 1 as const,
      requestId: "4ec30c51-98d1-4c22-8a0f-fba0c73a77ce",
      hostname: "example.com",
      targetUrl: "https://example.com/careers?source=lab",
    };
    const controllers: AbortController[] = [];
    const durations: number[] = [];
    const createTimeoutSignal = vi.fn((durationMs: number) => {
      durations.push(durationMs);
      const controller = new AbortController();
      controllers.push(controller);
      return controller.signal;
    });
    const performance: PerformanceBrowserEvidence = {
      profiles: [
        { profile: "mobile", status: "complete", fcpMs: 100, lcpMs: 200, cls: 0, tbtMs: 0, ttfbMs: 50, transferBytes: 100, score: 100 },
        { profile: "desktop", status: "complete", fcpMs: 100, lcpMs: 200, cls: 0, tbtMs: 0, ttfbMs: 50, transferBytes: 100, score: 100 },
      ],
    };
    const observePrivacy = vi.fn(async (_: unknown, options: { signal?: AbortSignal }) => {
      expect(options.signal).toBe(controllers[0].signal);
      controllers[0].abort();
      return { protocolVersion: 1, requestId: input.requestId, hostname: input.hostname } as PrivacyBrowserObservation;
    });
    const observePerformance = vi.fn(async (options: { signal?: AbortSignal; targetUrl: string }) => {
      expect(options.targetUrl).toBe(input.targetUrl);
      expect(options.signal).toBe(controllers[1].signal);
      expect(options.signal?.aborted).toBe(false);
      return performance;
    });

    const result = await observePrivacyAndPerformance(input, {
      proxyUrl: "http://privacy-egress:3128",
      createTimeoutSignal,
      observePrivacy: observePrivacy as never,
      observePerformance: observePerformance as never,
    });

    expect(durations).toEqual([PRIVACY_BROWSER_BUDGET.durationMs, PERFORMANCE_OBSERVATION_DURATION_MS]);
    expect(observePerformance).toHaveBeenCalledOnce();
    expect(result.performance).toEqual(performance);
  });

  it("does not launch performance when the request has no exact URL", async () => {
    const observePrivacy = vi.fn(async () => ({ protocolVersion: 1 } as PrivacyBrowserObservation));
    const observePerformance = vi.fn();

    await observePrivacyAndPerformance({
      protocolVersion: 1,
      requestId: "4ec30c51-98d1-4c22-8a0f-fba0c73a77ce",
      hostname: "example.com",
    }, {
      proxyUrl: "http://privacy-egress:3128",
      observePrivacy: observePrivacy as never,
      observePerformance: observePerformance as never,
    });

    expect(observePrivacy).toHaveBeenCalledOnce();
    expect(observePerformance).not.toHaveBeenCalled();
  });
});
