const FLOWS = ["login", "authorization_boundary", "logout"] as const;
const STATUSES = ["pass", "fail", "unknown", "not_applicable"] as const;
const PRINCIPAL_CLASS = "synthetic_auditor" as const;
const HASH = /^sha256:[a-f0-9]{64}$/u;
const REASON_CODE = /^[a-z0-9]+(?:_[a-z0-9]+)*$/u;

export type SyntheticAuthObservation = {
  flow: (typeof FLOWS)[number];
  status: (typeof STATUSES)[number];
  principalClass: typeof PRINCIPAL_CLASS;
  subjectRef: string;
  observedAt: string;
  reasonCode: string;
};

export function parseSyntheticAuthObservation(input: unknown): SyntheticAuthObservation {
  if (!isRecord(input) || !hasExactKeys(input, [
    "flow",
    "status",
    "principalClass",
    "subjectRef",
    "observedAt",
    "reasonCode",
  ])) {
    throw new Error("internal_synthetic_auth_observation_invalid");
  }
  const flow = input.flow;
  const status = input.status;
  const principalClass = input.principalClass;
  const subjectRef = input.subjectRef;
  const observedAt = input.observedAt;
  const reasonCode = input.reasonCode;
  if (
    !isOneOf(FLOWS, flow) ||
    !isOneOf(STATUSES, status) ||
    principalClass !== PRINCIPAL_CLASS ||
    typeof subjectRef !== "string" ||
    !HASH.test(subjectRef) ||
    typeof observedAt !== "string" ||
    !isIsoDate(observedAt) ||
    typeof reasonCode !== "string" ||
    reasonCode.length > 64 ||
    !REASON_CODE.test(reasonCode)
  ) {
    throw new Error("internal_synthetic_auth_observation_invalid");
  }
  return { flow, status, principalClass, subjectRef, observedAt, reasonCode };
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
  const keys = Object.keys(value);
  return keys.length === required.length && required.every((key) => keys.includes(key));
}
