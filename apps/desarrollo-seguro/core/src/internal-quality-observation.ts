const STATUSES = ["pass", "fail", "unknown", "not_applicable"] as const;
const SAMPLE_HASH = /^sha256:[a-f0-9]{64}$/u;

const METRICS = {
  e2e_flow: {
    public_flow_loaded: "milliseconds",
    report_flow_loaded: "milliseconds",
  },
  performance_sample: {
    response_time: "milliseconds",
    first_contentful_paint: "milliseconds",
    interaction_to_next_paint: "milliseconds",
  },
  accessibility_snapshot: {
    accessibility_critical_violations: "count",
  },
  responsive_check: {
    responsive_breakpoint_pass: "boolean",
  },
} as const;

const MAX_DURATION_MS = 120_000;
const MAX_COUNT = 1_000;

export type InternalQualityObservation = {
  kind: keyof typeof METRICS;
  status: (typeof STATUSES)[number];
  metricCode: string;
  value: number;
  unit: "milliseconds" | "count" | "boolean";
  sampleRef: string;
  observedAt: string;
};

export function parseInternalQualityObservation(input: unknown): InternalQualityObservation {
  const requiredKeys = [
    "kind",
    "status",
    "metricCode",
    "value",
    "unit",
    "sampleRef",
    "observedAt",
  ] as const;
  if (!isRecord(input) || !hasExactKeys(input, requiredKeys)) {
    throw new Error("internal_quality_observation_invalid");
  }

  const kind = input.kind;
  const status = input.status;
  const metricCode = input.metricCode;
  const value = input.value;
  const unit = input.unit;
  const sampleRef = input.sampleRef;
  const observedAt = input.observedAt;

  if (
    !isMetricKind(kind) ||
    !isOneOf(STATUSES, status) ||
    typeof metricCode !== "string" ||
    typeof value !== "number" ||
    !Number.isFinite(value) ||
    !isQualityUnit(unit) ||
    !isSampleRef(sampleRef) ||
    typeof observedAt !== "string" ||
    !isIsoDate(observedAt) ||
    METRICS[kind][metricCode as keyof (typeof METRICS)[typeof kind]] !== unit ||
    !isValueBounded(value, unit)
  ) {
    throw new Error("internal_quality_observation_invalid");
  }

  return {
    kind,
    status,
    metricCode,
    value,
    unit,
    sampleRef,
    observedAt,
  };
}

function isMetricKind(value: unknown): value is keyof typeof METRICS {
  return typeof value === "string" && value in METRICS;
}

function isValueBounded(value: number, unit: string): boolean {
  if (unit === "milliseconds") return Number.isInteger(value) && value >= 0 && value <= MAX_DURATION_MS;
  if (unit === "count") return Number.isInteger(value) && value >= 0 && value <= MAX_COUNT;
  return value === 0 || value === 1;
}

function isQualityUnit(value: unknown): value is InternalQualityObservation["unit"] {
  return value === "milliseconds" || value === "count" || value === "boolean";
}

function isSampleRef(value: unknown): value is string {
  return typeof value === "string" && SAMPLE_HASH.test(value);
}

function isOneOf<const T extends readonly string[]>(values: T, value: unknown): value is T[number] {
  return typeof value === "string" && values.includes(value);
}

function isIsoDate(value: string): boolean {
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) && new Date(timestamp).toISOString() === value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasExactKeys(value: Record<string, unknown>, required: readonly string[]): boolean {
  const keys = Object.keys(value).sort();
  return keys.length === required.length && required.every((key) => keys.includes(key));
}
