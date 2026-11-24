import { describe, expect, it, vi } from "vitest";
import { nextProviderCatalogRefresh, runProviderCatalogScheduler } from "./provider-catalog-scheduler.js";

describe("provider catalog monthly schedule", () => {
  it.each([
    ["2026-01-01T01:59:59.000Z", "2026-01-01T02:00:00.000Z"],
    ["2026-03-01T01:59:59.000Z", "2026-03-01T02:00:00.000Z"],
    ["2026-10-01T00:59:59.000Z", "2026-10-01T01:00:00.000Z"],
    ["2026-11-01T01:00:00.000Z", "2026-11-01T02:00:00.000Z"],
    ["2026-11-01T02:00:00.000Z", "2026-12-01T02:00:00.000Z"],
    ["2026-12-31T23:59:59.000Z", "2027-01-01T02:00:00.000Z"],
  ])("returns 03:00 Madrid after %s", (now, expected) => {
    expect(nextProviderCatalogRefresh(new Date(now)).toISOString()).toBe(expected);
  });

  it("rejects an invalid clock", () => {
    expect(() => nextProviderCatalogRefresh(new Date(Number.NaN))).toThrow("provider_catalog_clock_invalid");
  });

  it("runs refresh when due and stops after abort", async () => {
    const controller = new AbortController();
    let now = new Date("2026-01-01T01:59:59.000Z");
    const refresh = vi.fn(async () => { controller.abort(); });
    const scheduler = runProviderCatalogScheduler({
      signal: controller.signal,
      now: () => now,
      refresh,
      wait: async (delay) => {
        now = new Date(now.getTime() + delay);
        return true;
      },
    });
    await scheduler;
    expect(refresh).toHaveBeenCalledOnce();
    expect(refresh).toHaveBeenCalledWith(new Date("2026-01-01T02:00:00.000Z"));
  });

  it("runs immediately after startup when day one has passed 03:00 Madrid", async () => {
    const controller = new AbortController();
    const refresh = vi.fn(async () => { controller.abort(); });
    const scheduler = runProviderCatalogScheduler({
      signal: controller.signal,
      now: () => new Date("2026-11-01T02:10:00.000Z"),
      refresh,
      wait: async () => true,
    });
    await scheduler;
    expect(refresh).toHaveBeenCalledOnce();
    expect(refresh).toHaveBeenCalledWith(new Date("2026-11-01T02:00:00.000Z"));
  });

  it("retries a failed refresh on the same Madrid day", async () => {
    const controller = new AbortController();
    let attempts = 0;
    const refresh = vi.fn(async () => {
      attempts += 1;
      if (attempts === 1) throw new Error("temporary source failure");
      controller.abort();
    });
    const scheduler = runProviderCatalogScheduler({
      signal: controller.signal,
      now: () => new Date("2026-11-01T02:10:00.000Z"),
      refresh,
      retryDelayMs: 1_000,
      wait: async (delay) => delay === 0 || delay === 1_000,
    });
    await scheduler;
    expect(refresh).toHaveBeenCalledTimes(2);
  });
});
