const STATUSES = ["pass", "fail", "unknown", "not_applicable"] as const;
const SAMPLE_HASH = /^sha256:[a-f0-9]{64}$/u;

const SIGNALS = {
  storage: {
    nonessential_storage_before_consent: "boolean",
    essential_storage_only_before_consent: "boolean",
    raw_identifier_storage_observed: "boolean",
  },
  third_party: {
    third_party_request_count: "count",
    known_tracker_request_count: "count",
    external_ingest_enabled: "boolean",
    third_party_origin_count: "count",
    third_party_origins_allowlisted: "boolean",
  },
  consent: {
    consent_choice_recorded: "boolean",
    consent_state_respected: "boolean",
    consent_choice_selected: "boolean",
  },
  transparency: {
    privacy_notice_present: "boolean",
    ai_disclosure_present: "boolean",
  },
  data_minimization: {
    unnecessary_field_submission_observed: "boolean",
  },
} as const;

const MAX_COUNT = 1_000;

export type InternalPrivacyObservation = {
  area: keyof typeof SIGNALS;
  status: (typeof STATUSES)[number];
  signalCode: string;
  value: number;
  unit: "count" | "boolean";
  sampleRef: string;
  observedAt: string;
};

export function parseInternalPrivacyObservation(input: unknown): InternalPrivacyObservation {
  const requiredKeys = [
    "area",
    "status",
    "signalCode",
    "value",
    "unit",
    "sampleRef",
    "observedAt",
  ] as const;
  if (!isRecord(input) || !hasExactKeys(input, requiredKeys)) {
    throw new Error("internal_privacy_observation_invalid");
  }

  const area = input.area;
  const status = input.status;
  const signalCode = input.signalCode;
  const value = input.value;
  const unit = input.unit;
  const sampleRef = input.sampleRef;
  const observedAt = input.observedAt;
  if (
    !isSignalArea(area) ||
    !isOneOf(STATUSES, status) ||
    typeof signalCode !== "string" ||
    typeof value !== "number" ||
    !Number.isFinite(value) ||
    !isPrivacyUnit(unit) ||
    !isSampleRef(sampleRef) ||
    typeof observedAt !== "string" ||
    !isIsoDate(observedAt) ||
    SIGNALS[area][signalCode as keyof (typeof SIGNALS)[typeof area]] !== unit ||
    !isValueBounded(value, unit)
  ) {
    throw new Error("internal_privacy_observation_invalid");
  }

  return { area, status, signalCode, value, unit, sampleRef, observedAt };
}

function isSignalArea(value: unknown): value is keyof typeof SIGNALS {
  return typeof value === "string" && value in SIGNALS;
}

function isPrivacyUnit(value: unknown): value is InternalPrivacyObservation["unit"] {
  return value === "count" || value === "boolean";
}

function isValueBounded(value: number, unit: string): boolean {
  if (unit === "count") return Number.isInteger(value) && value >= 0 && value <= MAX_COUNT;
  return value === 0 || value === 1;
}

function isOneOf<const T extends readonly string[]>(values: T, value: unknown): value is T[number] {
  return typeof value === "string" && values.includes(value);
}

function isSampleRef(value: unknown): value is string {
  return typeof value === "string" && SAMPLE_HASH.test(value);
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
