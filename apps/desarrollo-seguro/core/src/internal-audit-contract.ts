import { normalizeHostname } from "./scan-policy.js";

export const INTERNAL_AUDIT_POLICY_VERSION = "beta-d-0.1" as const;
const APPROVED_HOSTNAME = "grumphya.com";
const APPROVED_AUDITOR = "desarrollo-seguro";
const APPROVED_ENVIRONMENT = "production";
const MAX_EVIDENCE_RETENTION_DAYS = 30;

const AUDIT_SCOPES = [
  "infrastructure",
  "application",
  "authentication",
  "quality",
  "privacy",
  "ethics",
  "ai",
] as const;
const AUDIT_STATUSES = ["pass", "fail", "unknown", "not_applicable"] as const;
const AUDIT_SOURCES = [
  "production_observation",
  "deployment_attestation",
  "synthetic_check",
] as const;
const AUDIT_EVIDENCE_UNITS = ["boolean", "count", "milliseconds"] as const;
export const INTERNAL_AUDIT_CRITERIA = {
  "infrastructure.tls": "infrastructure",
  "infrastructure.headers": "infrastructure",
  "infrastructure.network": "infrastructure",
  "application.dependencies": "application",
  "application.secrets": "application",
  "authentication.authorization": "authentication",
  "quality.e2e": "quality",
  "quality.accessibility": "quality",
  "performance.page_load": "quality",
  "privacy.cookies": "privacy",
  "privacy.third_parties": "privacy",
  "privacy.consent": "privacy",
  "ethics.transparency": "ethics",
  "ai.disclosure": "ai",
} as const;

type AuditScope = (typeof AUDIT_SCOPES)[number];
type AuditStatus = (typeof AUDIT_STATUSES)[number];
type AuditSource = (typeof AUDIT_SOURCES)[number];
type AuditEvidenceUnit = (typeof AUDIT_EVIDENCE_UNITS)[number];
export type InternalAuditCriterion = keyof typeof INTERNAL_AUDIT_CRITERIA;

export type InternalAuditRequest = {
  policyVersion: typeof INTERNAL_AUDIT_POLICY_VERSION;
  hostname: typeof APPROVED_HOSTNAME;
  environment: typeof APPROVED_ENVIRONMENT;
  auditor: typeof APPROVED_AUDITOR;
  scopes: readonly AuditScope[];
  evidenceRetentionDays: number;
};

export type InternalAuditEvidence = {
  criterionId: InternalAuditCriterion;
  scope: AuditScope;
  status: AuditStatus;
  source: AuditSource;
  observedAt: string;
  reasonCode: string;
  value?: number;
  unit?: AuditEvidenceUnit;
  limit?: number;
};

export function parseInternalAuditRequest(input: unknown): InternalAuditRequest {
  if (!isRecord(input) || !hasExactKeys(input, [
    "policyVersion",
    "hostname",
    "environment",
    "auditor",
    "scopes",
    "evidenceRetentionDays",
  ])) {
    throw new Error("internal_audit_request_invalid");
  }
  try {
    const evidenceRetentionDays = input.evidenceRetentionDays;
    if (
      input.policyVersion !== INTERNAL_AUDIT_POLICY_VERSION ||
      normalizeHostname(input.hostname) !== APPROVED_HOSTNAME ||
      input.environment !== APPROVED_ENVIRONMENT ||
      input.auditor !== APPROVED_AUDITOR ||
      typeof evidenceRetentionDays !== "number" ||
      !Number.isInteger(evidenceRetentionDays) ||
      evidenceRetentionDays < 1 ||
      evidenceRetentionDays > MAX_EVIDENCE_RETENTION_DAYS
    ) {
      throw new Error("internal_audit_request_invalid");
    }
    const scopes = parseScopes(input.scopes);
    return {
      policyVersion: INTERNAL_AUDIT_POLICY_VERSION,
      hostname: APPROVED_HOSTNAME,
      environment: APPROVED_ENVIRONMENT,
      auditor: APPROVED_AUDITOR,
      scopes,
      evidenceRetentionDays,
    };
  } catch {
    throw new Error("internal_audit_request_invalid");
  }
}

export function parseInternalAuditEvidence(input: unknown): InternalAuditEvidence {
  if (!isRecord(input) || !hasKeys(input, [
    "criterionId",
    "scope",
    "status",
    "source",
    "observedAt",
    "reasonCode",
  ], ["value", "unit", "limit"])) {
    throw new Error("internal_audit_evidence_invalid");
  }
  const criterionId = input.criterionId;
  const scope = input.scope;
  const observedAt = input.observedAt;
  const reasonCode = input.reasonCode;
  const value = input.value;
  const unit = input.unit;
  const limit = input.limit;
  const hasValue = value !== undefined || unit !== undefined;
  if (
    typeof criterionId !== "string" ||
    !(criterionId in INTERNAL_AUDIT_CRITERIA) ||
    typeof scope !== "string" ||
    !isAuditScope(scope) ||
    INTERNAL_AUDIT_CRITERIA[criterionId as InternalAuditCriterion] !== scope ||
    !isOneOf(AUDIT_STATUSES, input.status) ||
    !isOneOf(AUDIT_SOURCES, input.source) ||
    typeof observedAt !== "string" ||
    !isIsoDate(observedAt) ||
    typeof reasonCode !== "string" ||
    !/^[a-z0-9]+(?:_[a-z0-9]+)*$/u.test(reasonCode) ||
    reasonCode.length > 64 ||
    (hasValue && (typeof value !== "number" || !Number.isFinite(value) || !isEvidenceUnit(unit) || !isEvidenceValueBounded(value, unit))) ||
    (isEvidenceUnit(unit) && unit !== "boolean" && limit === undefined) ||
    (limit !== undefined && (typeof limit !== "number" || !Number.isFinite(limit) || !isEvidenceUnit(unit) || !isEvidenceValueBounded(limit, unit)))
  ) {
    throw new Error("internal_audit_evidence_invalid");
  }
  return {
    criterionId: criterionId as InternalAuditCriterion,
    scope,
    status: input.status as AuditStatus,
    source: input.source as AuditSource,
    observedAt,
    reasonCode,
    ...(hasValue ? { value: value as number, unit: unit as AuditEvidenceUnit } : {}),
    ...(limit === undefined ? {} : { limit }),
  };
}

function parseScopes(value: unknown): readonly AuditScope[] {
  if (!Array.isArray(value) || value.length === 0 || value.length > AUDIT_SCOPES.length) {
    throw new Error("internal_audit_request_invalid");
  }
  const scopes = value.map((scope) => {
    if (!isAuditScope(scope)) throw new Error("internal_audit_request_invalid");
    return scope;
  });
  if (new Set(scopes).size !== scopes.length) {
    throw new Error("internal_audit_request_invalid");
  }
  return scopes;
}

function isAuditScope(value: unknown): value is AuditScope {
  return isOneOf(AUDIT_SCOPES, value);
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

function hasKeys(
  value: Record<string, unknown>,
  required: readonly string[],
  optional: readonly string[],
): boolean {
  const keys = Object.keys(value);
  return required.every((key) => keys.includes(key)) &&
    keys.every((key) => required.includes(key) || optional.includes(key));
}

function isEvidenceUnit(value: unknown): value is AuditEvidenceUnit {
  return typeof value === "string" && AUDIT_EVIDENCE_UNITS.includes(value as AuditEvidenceUnit);
}

function isEvidenceValueBounded(value: number, unit: AuditEvidenceUnit): boolean {
  if (unit === "boolean") return value === 0 || value === 1;
  if (unit === "count") return Number.isInteger(value) && value >= 0 && value <= 1_000;
  return Number.isInteger(value) && value >= 0 && value <= 120_000;
}
