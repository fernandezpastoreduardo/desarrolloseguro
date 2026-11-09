import { isIP } from "node:net";
import { domainToASCII } from "node:url";

export const REPORT_TTL_MS = 60 * 60 * 1000;
const INVALID_HOSTNAME_ERROR = "invalid_hostname";

const HOSTNAME_LABEL_PATTERN = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;
const RESERVED_SUFFIXES = [
  ".localhost",
  ".local",
  ".internal",
  ".test",
  ".invalid",
  ".example",
  ".home.arpa",
  ".onion",
];

const CHECK_STATUS = {
  PASS: "pass",
  FAIL: "fail",
  UNKNOWN: "unknown",
  NOT_APPLICABLE: "not_applicable",
} as const;

export type CheckStatus = (typeof CHECK_STATUS)[keyof typeof CHECK_STATUS];

export type CheckResult = {
  status: CheckStatus;
  required: boolean;
  justification?: string;
};

export type Verdict = "pass" | "fail" | "inconclusive";
export type ReportFreshness = "fresh" | "stale";

export function normalizeHostname(input: unknown): string {
  if (typeof input !== "string") {
    throw new Error(INVALID_HOSTNAME_ERROR);
  }

  const trimmed = input.trim();
  if (trimmed.length === 0 || /[\s/:?#@\\]/u.test(trimmed)) {
    throw new Error(INVALID_HOSTNAME_ERROR);
  }

  const withoutTrailingDot = trimmed.replace(/\.$/u, "");
  const asciiHostname = domainToASCII(withoutTrailingDot).toLowerCase();

  if (
    asciiHostname.length === 0 ||
    asciiHostname.length > 253 ||
    isIP(asciiHostname) !== 0 ||
    !asciiHostname.includes(".") ||
    RESERVED_SUFFIXES.some((suffix) => asciiHostname.endsWith(suffix))
  ) {
    throw new Error(INVALID_HOSTNAME_ERROR);
  }

  const labels = asciiHostname.split(".");
  if (
    labels.some(
      (label) => label.length > 63 || !HOSTNAME_LABEL_PATTERN.test(label),
    )
  ) {
    throw new Error(INVALID_HOSTNAME_ERROR);
  }

  return asciiHostname;
}

export function evaluateVerdict(checks: unknown): Verdict {
  if (!Array.isArray(checks) || checks.length === 0) {
    return "inconclusive";
  }

  const validChecks = checks.filter(isCheckResult);
  if (validChecks.length !== checks.length) {
    return "inconclusive";
  }

  const requiredChecks = validChecks.filter((check) => check.required);
  if (requiredChecks.length === 0) {
    return "inconclusive";
  }

  if (requiredChecks.some((check) => check.status === CHECK_STATUS.FAIL)) {
    return "fail";
  }

  const unresolvedRequiredCheck = requiredChecks.some((check) => {
    if (check.status === CHECK_STATUS.PASS) {
      return false;
    }
    if (check.status === CHECK_STATUS.NOT_APPLICABLE) {
      return !check.justification?.trim();
    }
    return true;
  });

  return unresolvedRequiredCheck ? "inconclusive" : "pass";
}

function isCheckResult(value: unknown): value is CheckResult {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }

  const candidate = value as Record<string, unknown>;
  const validStatuses: readonly CheckStatus[] = [
    CHECK_STATUS.PASS,
    CHECK_STATUS.FAIL,
    CHECK_STATUS.UNKNOWN,
    CHECK_STATUS.NOT_APPLICABLE,
  ];

  return (
    validStatuses.includes(candidate.status as CheckStatus) &&
    typeof candidate.required === "boolean" &&
    (candidate.justification === undefined ||
      typeof candidate.justification === "string")
  );
}

export function getReportFreshness(
  completedAtEpochMs: number,
  nowEpochMs: number,
): ReportFreshness {
  if (
    !Number.isFinite(completedAtEpochMs) ||
    !Number.isFinite(nowEpochMs) ||
    completedAtEpochMs > nowEpochMs
  ) {
    return "stale";
  }

  return nowEpochMs - completedAtEpochMs < REPORT_TTL_MS ? "fresh" : "stale";
}
