import { createHash } from "node:crypto";
import {
  INTERNAL_AUDIT_CRITERIA,
  expectedInternalAuditMetricLimit,
  type InternalAuditCriterion,
} from "./internal-audit-contract.js";
import { canonicalizeForSignature } from "./internal-audit-evidence-envelope.js";

const STATUSES = ["pass", "fail", "unknown", "not_applicable"] as const;
const UNITS = ["boolean", "count", "milliseconds"] as const;
const SAMPLE_HASH = /^sha256:[a-f0-9]{64}$/u;
const REASON_CODE = /^[a-z0-9]+(?:_[a-z0-9]+)*$/u;
const MAX_SIGNALS = 14;
const MAX_COUNT = 1_000;
const MAX_DURATION_MS = 120_000;

export type InternalAuditSignalStatus = (typeof STATUSES)[number];
export type InternalAuditSignalUnit = (typeof UNITS)[number];

export type InternalAuditSignal = {
  criterionId: InternalAuditCriterion;
  status: InternalAuditSignalStatus;
  reasonCode: string;
  value: number | null;
  unit: InternalAuditSignalUnit;
  limit?: number;
};

export type InternalAuditSignalEnvelope = {
  observedAt: string;
  sampleRef: string;
  signals: readonly InternalAuditSignal[];
};

const REASON_CODES: Readonly<Record<InternalAuditCriterion, readonly string[]>> = {
  "infrastructure.tls": [
    "infrastructure_transport_verified",
    "infrastructure_transport_incomplete",
    "infrastructure_transport_not_applicable",
  ],
  "infrastructure.headers": [
    "security_headers_verified",
    "security_headers_missing",
    "security_headers_unobserved",
  ],
  "infrastructure.network": [
    "network_surface_allowlisted",
    "network_surface_restricted",
    "network_surface_unobserved",
  ],
  "application.dependencies": [
    "dependency_risk_not_observed",
    "high_dependency_risk_observed",
    "critical_dependency_risk_observed",
  ],
  "application.secrets": [
    "secrets_not_in_image",
    "secrets_check_unavailable",
  ],
  "authentication.authorization": [
    "technical_contract_verified",
    "technical_contract_mismatch",
    "authorization_flow_passed",
    "authorization_flow_failed",
  ],
  "quality.e2e": [
    "public_flow_loaded",
    "report_flow_loaded",
    "release_checks",
  ],
  "quality.accessibility": ["accessibility_critical_violations"],
  "performance.page_load": [
    "response_time",
    "first_contentful_paint",
    "interaction_to_next_paint",
  ],
  "privacy.cookies": [
    "nonessential_storage_before_consent",
    "essential_storage_only_before_consent",
    "raw_identifier_storage_observed",
  ],
  "privacy.third_parties": [
    "third_party_request_count",
    "known_tracker_request_count",
    "external_ingest_enabled",
    "third_party_origin_count",
    "third_party_origins_allowlisted",
  ],
  "privacy.consent": [
    "consent_choice_recorded",
    "consent_state_respected",
    "consent_choice_selected",
  ],
  "ethics.transparency": [
    "privacy_notice_present",
    "privacy_notice_missing",
    "privacy_notice_unobserved",
  ],
  "ai.disclosure": [
    "ai_disclosure_present",
    "ai_disclosure_missing",
    "ai_disclosure_unobserved",
  ],
};

export function parseInternalAuditSignalEnvelope(
  input: unknown,
  allowedCriteria: readonly InternalAuditCriterion[],
): InternalAuditSignalEnvelope {
  if (!isRecord(input) || !hasExactKeys(input, ["observedAt", "sampleRef", "signals"])) {
    throw new Error("internal_audit_signal_envelope_invalid");
  }
  const observedAt = input.observedAt;
  const sampleRef = input.sampleRef;
  const signals = input.signals;
  if (
    typeof observedAt !== "string" ||
    !isIsoDate(observedAt) ||
    typeof sampleRef !== "string" ||
    !SAMPLE_HASH.test(sampleRef) ||
    !Array.isArray(signals) ||
    signals.length === 0 ||
    signals.length > MAX_SIGNALS
  ) {
    throw new Error("internal_audit_signal_envelope_invalid");
  }
  const allowed = new Set(allowedCriteria);
  const parsedSignals = signals.map((signal) => parseSignal(signal, allowed));
  const signalKeys = parsedSignals.map(
    (signal) => `${signal.criterionId}:${signal.reasonCode}`,
  );
  if (new Set(signalKeys).size !== signalKeys.length) {
    throw new Error("internal_audit_signal_duplicate");
  }
  if (sampleRef !== createInternalAuditSampleRef(parsedSignals)) {
    throw new Error("internal_audit_sample_ref_mismatch");
  }
  return { observedAt, sampleRef, signals: parsedSignals };
}

/** SHA-256 of the canonical UTF-8 JSON representation of the signals array. */
export function createInternalAuditSampleRef(
  signals: readonly InternalAuditSignal[],
): string {
  return `sha256:${createHash("sha256")
    .update(canonicalizeForSignature(signals), "utf8")
    .digest("hex")}`;
}

export function signalCriteriaForResource(
  resource: string,
): readonly InternalAuditCriterion[] {
  switch (resource) {
    case "infrastructure_snapshot":
      return ["infrastructure.tls", "infrastructure.headers", "infrastructure.network"];
    case "deployment_attestation":
      return ["application.secrets"];
    case "dependency_inventory":
      return ["application.dependencies"];
    case "synthetic_browser_flow":
      return ["authentication.authorization"];
    case "performance_observation":
      return ["quality.e2e", "quality.accessibility", "performance.page_load"];
    case "privacy_observation":
      return ["privacy.cookies", "privacy.third_parties", "privacy.consent", "ethics.transparency"];
    case "ai_observation":
      return ["ai.disclosure"];
    default:
      return [];
  }
}

function parseSignal(
  input: unknown,
  allowedCriteria: ReadonlySet<InternalAuditCriterion>,
): InternalAuditSignal {
  if (!isRecord(input) || !hasKeys(input, ["criterionId", "status", "reasonCode", "value", "unit"], ["limit"])) {
    throw new Error("internal_audit_signal_invalid");
  }
  const criterionId = input.criterionId;
  const status = input.status;
  const reasonCode = input.reasonCode;
  const value = input.value;
  const unit = input.unit;
  const limit = input.limit;
  const hasNullValue = value === null;
  const expectedLimit = typeof criterionId === "string" && typeof reasonCode === "string"
    ? expectedInternalAuditMetricLimit(criterionId, reasonCode)
    : undefined;
  if (
    typeof criterionId !== "string" ||
    !(criterionId in INTERNAL_AUDIT_CRITERIA) ||
    !allowedCriteria.has(criterionId as InternalAuditCriterion) ||
    !isOneOf(STATUSES, status) ||
    typeof reasonCode !== "string" ||
    reasonCode.length > 64 ||
    !REASON_CODE.test(reasonCode) ||
    !REASON_CODES[criterionId as InternalAuditCriterion].includes(reasonCode) ||
    !isOneOf(UNITS, unit) ||
    (hasNullValue
      ? (status !== "unknown" && status !== "not_applicable")
      : (typeof value !== "number" || !Number.isFinite(value) || !isValueBounded(value, unit))) ||
    (unit !== "boolean" && limit === undefined) ||
    (limit !== undefined && (typeof limit !== "number" || !Number.isFinite(limit) || !isValueBounded(limit, unit))) ||
    (expectedLimit !== undefined && (unit !== expectedLimit.unit || limit !== expectedLimit.limit))
  ) {
    throw new Error("internal_audit_signal_invalid");
  }
  return {
    criterionId: criterionId as InternalAuditCriterion,
    status,
    reasonCode,
    value: value as number | null,
    unit,
    ...(limit === undefined ? {} : { limit }),
  };
}

function isValueBounded(value: number, unit: InternalAuditSignalUnit): boolean {
  if (unit === "boolean") return value === 0 || value === 1;
  if (unit === "count") return Number.isInteger(value) && value >= 0 && value <= MAX_COUNT;
  return Number.isInteger(value) && value >= 0 && value <= MAX_DURATION_MS;
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

function hasKeys(
  value: Record<string, unknown>,
  required: readonly string[],
  optional: readonly string[],
): boolean {
  const keys = Object.keys(value);
  return required.every((key) => keys.includes(key)) &&
    keys.every((key) => required.includes(key) || optional.includes(key));
}
