export type ScanPerformanceMetrics = {
  fcpMs: number | null | undefined;
  lcpMs: number | null | undefined;
  cls: number | null | undefined;
  tbtMs: number | null | undefined;
  ttfbMs: number | null | undefined;
  transferBytes: number | null | undefined;
};

export type ScanPerformanceMetricId = keyof ScanPerformanceMetrics | "speedIndexMs";

export type ScanPerformanceMetricScore = {
  id: ScanPerformanceMetricId;
  value: number;
  weight: number;
  subscore: number;
  weightedPoints: number;
};

export type ScanPerformanceScore = {
  score: number;
  metrics: readonly ScanPerformanceMetricScore[];
};

export type LighthouseMobileMetrics = {
  fcpMs: number | null | undefined;
  speedIndexMs: number | null | undefined;
  lcpMs: number | null | undefined;
  cls: number | null | undefined;
  tbtMs: number | null | undefined;
};

type MetricDefinition = {
  id: keyof ScanPerformanceMetrics;
  weight: number;
  good: number;
  bad: number;
};

const METRICS: readonly MetricDefinition[] = [
  { id: "fcpMs", weight: 15, good: 1_800, bad: 3_000 },
  { id: "lcpMs", weight: 25, good: 2_500, bad: 4_000 },
  { id: "cls", weight: 20, good: 0.1, bad: 0.25 },
  { id: "tbtMs", weight: 20, good: 200, bad: 600 },
  { id: "ttfbMs", weight: 15, good: 800, bad: 1_800 },
  { id: "transferBytes", weight: 5, good: 1_600_000, bad: 4_000_000 },
];

/** Scores the approved lab metrics. Returns null unless every metric is valid. */
export function scoreScanPerformance(
  input: ScanPerformanceMetrics,
): ScanPerformanceScore | null {
  if (!input || typeof input !== "object") return null;

  const metricScores: ScanPerformanceMetricScore[] = [];
  let weightedTotal = 0;

  for (const metric of METRICS) {
    const value = input[metric.id];
    if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
      return null;
    }

    const subscore = Math.round(scoreMetric(value, metric.good, metric.bad) * 100) / 100;
    const weightedPoints = subscore * metric.weight / 100;
    metricScores.push({
      id: metric.id,
      value,
      weight: metric.weight,
      subscore,
      weightedPoints,
    });
    weightedTotal += weightedPoints;
  }

  return {
    score: Math.round(weightedTotal),
    metrics: metricScores,
  };
}

function scoreMetric(value: number, good: number, bad: number): number {
  if (value <= good) return 100;
  if (value >= bad) return 0;
  return 100 * (bad - value) / (bad - good);
}

type LighthouseMetricDefinition = {
  id: keyof LighthouseMobileMetrics;
  weight: number;
  p10: number;
  median: number;
};

const LIGHTHOUSE_MOBILE_METRICS: readonly LighthouseMetricDefinition[] = [
  { id: "fcpMs", weight: 10, p10: 1_800, median: 3_000 },
  { id: "speedIndexMs", weight: 10, p10: 3_387, median: 5_800 },
  { id: "lcpMs", weight: 25, p10: 2_500, median: 4_000 },
  { id: "tbtMs", weight: 30, p10: 200, median: 600 },
  { id: "cls", weight: 25, p10: 0.1, median: 0.25 },
];

/** Lighthouse 13.6.0 mobile metric weights and log-normal scoring curves. */
export function scoreLighthouseMobilePerformance(
  input: LighthouseMobileMetrics,
): ScanPerformanceScore | null {
  if (!input || typeof input !== "object") return null;

  const metricScores: ScanPerformanceMetricScore[] = [];
  let weightedTotal = 0;
  for (const metric of LIGHTHOUSE_MOBILE_METRICS) {
    const value = input[metric.id];
    if (typeof value !== "number" || !Number.isFinite(value) || value < 0) return null;

    const subscore = Math.round(logNormalScore(value, metric.p10, metric.median) * 10_000) / 100;
    const weightedPoints = subscore * metric.weight / 100;
    metricScores.push({ id: metric.id, value, weight: metric.weight, subscore, weightedPoints });
    weightedTotal += weightedPoints;
  }

  return { score: Math.round(weightedTotal), metrics: metricScores };
}

/*
 * Portions adapted from Lighthouse 13.6.0 shared/statistics.js and
 * shared/util.js. Copyright 2017–2018 Google LLC, licensed under Apache-2.0:
 * https://www.apache.org/licenses/LICENSE-2.0
 */
function logNormalScore(value: number, p10: number, median: number): number {
  if (value === 0) return 1;
  const standardized = Math.log(value / median) * 0.9061938024368232 / -Math.log(p10 / median);
  const raw = clamp((1 - errorFunction(standardized)) / 2, 0, 1);
  const bounded = value <= p10
    ? Math.max(0.9, Math.min(1, raw))
    : value <= median ? Math.max(0.5, Math.min(0.8999999999999999, raw))
      : Math.max(0, Math.min(0.49999999999999994, raw));
  const boosted = bounded > 0.9 ? bounded + 0.05 * (bounded - 0.9) : bounded;
  return Math.floor(boosted * 100) / 100;
}

// Abramowitz and Stegun 7.1.26, also used by Lighthouse 13.6.0.
function errorFunction(value: number): number {
  const sign = Math.sign(value);
  const absolute = Math.abs(value);
  const t = 1 / (1 + 0.3275911 * absolute);
  const result = t * (0.254829592 + t * (-0.284496736 + t * (1.421413741 +
    t * (-1.453152027 + t * 1.061405429))));
  return sign * (1 - result * Math.exp(-absolute * absolute));
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}
