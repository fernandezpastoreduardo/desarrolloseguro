export type ScanPerformanceMetrics = {
  fcpMs: number | null | undefined;
  lcpMs: number | null | undefined;
  cls: number | null | undefined;
  tbtMs: number | null | undefined;
  ttfbMs: number | null | undefined;
  transferBytes: number | null | undefined;
};

export type ScanPerformanceMetricId = keyof ScanPerformanceMetrics;

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

type MetricDefinition = {
  id: ScanPerformanceMetricId;
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
