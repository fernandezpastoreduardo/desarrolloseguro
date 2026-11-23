import {
  INTERNAL_AUDIT_CRITERIA,
  type InternalAuditCriterion,
  type InternalAuditEvidence,
} from "./internal-audit-contract.js";
import type { InternalAuditReport } from "./internal-audit-report.js";

const CRITERIA = Object.keys(INTERNAL_AUDIT_CRITERIA) as InternalAuditCriterion[];
const PUBLIC_STATUSES = ["pass", "fail", "unknown", "not_applicable"] as const;

export type InternalAuditPublicSummary = {
  policyVersion: "internal-audit-public-v1";
  status: "complete" | "review";
  observedAt: string | null;
  criteria: readonly {
    id: InternalAuditCriterion;
    status: (typeof PUBLIC_STATUSES)[number];
  }[];
};

export function toInternalAuditPublicSummary(
  report: InternalAuditReport | null,
): InternalAuditPublicSummary {
  if (!report || report.assessment.status === "incomplete") {
    return reviewSummary(report?.observedAt ?? null);
  }

  const statuses = new Map<InternalAuditCriterion, InternalAuditEvidence["status"][]>();
  for (const evidence of report.evidence) {
    const items = statuses.get(evidence.criterionId) ?? [];
    items.push(evidence.status);
    statuses.set(evidence.criterionId, items);
  }

  const criteria = CRITERIA.map((id) => ({
    id,
    status: aggregatePublicStatus(statuses.get(id)),
  }));
  if (criteria.some((criterion) => criterion.status === "unknown")) {
    return reviewSummary(report.observedAt);
  }
  return {
    policyVersion: "internal-audit-public-v1",
    status: "complete",
    observedAt: report.observedAt,
    criteria,
  };
}

export function parseInternalAuditPublicSummary(
  input: unknown,
): InternalAuditPublicSummary | null {
  if (!isRecord(input) || !hasExactKeys(input, ["policyVersion", "status", "observedAt", "criteria"]) ||
      input.policyVersion !== "internal-audit-public-v1" ||
      !["complete", "review"].includes(String(input.status)) ||
      !(input.observedAt === null || (typeof input.observedAt === "string" && isIsoDate(input.observedAt))) ||
      !Array.isArray(input.criteria) || input.criteria.length !== CRITERIA.length) return null;

  const seen = new Set<string>();
  const criteria = [];
  for (const raw of input.criteria) {
    if (!isRecord(raw) || !hasExactKeys(raw, ["id", "status"]) ||
        typeof raw.id !== "string" || !Object.hasOwn(INTERNAL_AUDIT_CRITERIA, raw.id) ||
        !PUBLIC_STATUSES.includes(raw.status as (typeof PUBLIC_STATUSES)[number]) ||
        seen.has(raw.id)) return null;
    seen.add(raw.id);
    criteria.push({ id: raw.id as InternalAuditCriterion, status: raw.status as (typeof PUBLIC_STATUSES)[number] });
  }
  if (seen.size !== CRITERIA.length ||
      CRITERIA.some((id) => !seen.has(id)) ||
      input.status === "complete" && (input.observedAt === null || criteria.some((criterion) => criterion.status === "unknown")) ||
      input.status === "review" && criteria.some((criterion) => criterion.status !== "unknown")) return null;

  return {
    policyVersion: "internal-audit-public-v1",
    status: input.status as "complete" | "review",
    observedAt: input.observedAt as string | null,
    criteria,
  };
}

function aggregatePublicStatus(
  statuses: readonly InternalAuditEvidence["status"][] | undefined,
): InternalAuditPublicSummary["criteria"][number]["status"] {
  if (!statuses || statuses.length === 0 || statuses.includes("unknown")) return "unknown";
  if (statuses.includes("fail")) return "fail";
  if (statuses.includes("pass")) return "pass";
  return "not_applicable";
}

function reviewSummary(observedAt: string | null): InternalAuditPublicSummary {
  return {
    policyVersion: "internal-audit-public-v1",
    status: "review",
    observedAt,
    criteria: CRITERIA.map((id) => ({ id, status: "unknown" })),
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasExactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const compareKeys = (left: string, right: string): number =>
    left < right ? -1 : left > right ? 1 : 0;
  const actual = Object.keys(value).sort(compareKeys);
  const expected = [...keys].sort(compareKeys);
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}

function isIsoDate(value: string): boolean {
  const date = new Date(value);
  return Number.isFinite(date.getTime()) && date.toISOString() === value;
}
