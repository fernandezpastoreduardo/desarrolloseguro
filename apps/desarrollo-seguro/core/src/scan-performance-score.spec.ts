import { describe, expect, it } from "vitest";
import { scoreScanPerformance, type ScanPerformanceMetrics } from "./scan-performance-score.js";

const GOOD_METRICS: ScanPerformanceMetrics = {
  fcpMs: 1_800,
  lcpMs: 2_500,
  cls: 0.1,
  tbtMs: 200,
  ttfbMs: 800,
  transferBytes: 1_600_000,
};

describe("scoreScanPerformance", () => {
  it("scores the good thresholds as 100 and reports each weighted subscore", () => {
    const result = scoreScanPerformance(GOOD_METRICS);

    expect(result?.score).toBe(100);
    expect(result?.metrics).toEqual([
      { id: "fcpMs", value: 1_800, weight: 15, subscore: 100, weightedPoints: 15 },
      { id: "lcpMs", value: 2_500, weight: 25, subscore: 100, weightedPoints: 25 },
      { id: "cls", value: 0.1, weight: 20, subscore: 100, weightedPoints: 20 },
      { id: "tbtMs", value: 200, weight: 20, subscore: 100, weightedPoints: 20 },
      { id: "ttfbMs", value: 800, weight: 15, subscore: 100, weightedPoints: 15 },
      { id: "transferBytes", value: 1_600_000, weight: 5, subscore: 100, weightedPoints: 5 },
    ]);
  });

  it("scores the bad thresholds as zero", () => {
    const result = scoreScanPerformance({
      fcpMs: 3_000,
      lcpMs: 4_000,
      cls: 0.25,
      tbtMs: 600,
      ttfbMs: 1_800,
      transferBytes: 4_000_000,
    });

    expect(result?.score).toBe(0);
    expect(result?.metrics.every(({ subscore, weightedPoints }) => subscore === 0 && weightedPoints === 0)).toBe(true);
  });

  it("linearly interpolates, clamps to range and returns an integer aggregate", () => {
    const result = scoreScanPerformance({
      fcpMs: 2_400,
      lcpMs: 3_250,
      cls: 0.175,
      tbtMs: 400,
      ttfbMs: 1_300,
      transferBytes: 2_800_000,
    });

    expect(result?.score).toBe(50);
    expect(result?.metrics.map(({ subscore }) => subscore)).toEqual([50, 50, 50, 50, 50, 50]);
    expect(scoreScanPerformance({ ...GOOD_METRICS, fcpMs: 0 })?.metrics[0]?.subscore).toBe(100);
    expect(scoreScanPerformance({ ...GOOD_METRICS, fcpMs: 10_000 })?.metrics[0]?.subscore).toBe(0);
  });

  it.each([
    ["missing", { ...GOOD_METRICS, lcpMs: undefined }],
    ["null", { ...GOOD_METRICS, lcpMs: null }],
    ["non-finite", { ...GOOD_METRICS, cls: Number.NaN }],
    ["negative", { ...GOOD_METRICS, tbtMs: -1 }],
  ])("returns null for %s metrics", (_description, metrics) => {
    expect(scoreScanPerformance(metrics)).toBeNull();
  });
});
