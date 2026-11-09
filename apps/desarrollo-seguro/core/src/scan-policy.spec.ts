import { describe, expect, it } from "vitest";
import {
  evaluateVerdict,
  getReportFreshness,
  normalizeHostname,
  REPORT_TTL_MS,
  type CheckResult,
} from "./scan-policy.js";

const INVALID_HOSTNAMES = [
  "https://example.com",
  "example.com/path",
  "user@example.com",
  "example.com:443",
  "127.0.0.1",
  "127.1",
  "2001:db8::1",
  "localhost",
  "service.local",
  "example.com?next=other.example",
  "example.com#fragment",
  "a..example.com",
  "-label.example.com",
  "label-.example.com",
  "under_score.example.com",
  "example.com.localhost",
  "example.example",
  "hidden.onion",
  `${"a".repeat(64)}.example.com`,
  `${"a".repeat(250)}.com`,
];

const INVALID_HOSTNAME_INPUTS: unknown[] = [
  null,
  undefined,
  1,
  {},
  [],
  "",
  "   ",
];

const REQUIRED_CHECK: CheckResult = {
  status: "pass",
  required: true,
};

describe("normalizeHostname", () => {
  it("canonicalizes case, trailing dots and internationalized names", () => {
    expect(normalizeHostname("  WWW.Example.COM.  ")).toBe("www.example.com");
    expect(normalizeHostname("mañana.es")).toBe("xn--maana-pta.es");
  });

  it.each(INVALID_HOSTNAMES)("rejects non-hostname input: %s", (hostname) => {
    expect(() => normalizeHostname(hostname)).toThrow("invalid_hostname");
  });

  it.each(INVALID_HOSTNAME_INPUTS)(
    "rejects invalid input types/empty values: %s",
    (input) => {
      expect(() => normalizeHostname(input)).toThrow("invalid_hostname");
    },
  );

  it("accepts the maximum label length and removes only one terminal dot", () => {
    const maximumLabelHostname = `${"a".repeat(63)}.example.com`;

    expect(normalizeHostname(maximumLabelHostname)).toBe(maximumLabelHostname);
    expect(() => normalizeHostname("example.com..")).toThrow(
      "invalid_hostname",
    );
  });
});

describe("evaluateVerdict", () => {
  it("fails when any required check fails", () => {
    expect(
      evaluateVerdict([
        REQUIRED_CHECK,
        { status: "fail", required: true },
        { status: "unknown", required: true },
      ]),
    ).toBe("fail");
  });

  it("is inconclusive when a required check is unknown and none failed", () => {
    expect(
      evaluateVerdict([
        REQUIRED_CHECK,
        { status: "unknown", required: true },
        { status: "fail", required: false },
      ]),
    ).toBe("inconclusive");
  });

  it("passes only when every required check passed or was justified as not applicable", () => {
    expect(
      evaluateVerdict([
        REQUIRED_CHECK,
        {
          status: "not_applicable",
          required: true,
          justification: "No cookies observed",
        },
      ]),
    ).toBe("pass");
  });

  it("does not accept an unjustified not-applicable result", () => {
    expect(
      evaluateVerdict([{ status: "not_applicable", required: true }]),
    ).toBe("inconclusive");
  });

  it("is inconclusive when there are no required checks", () => {
    expect(evaluateVerdict([{ status: "fail", required: false }])).toBe(
      "inconclusive",
    );
  });

  it("does not let an optional failure override passing required checks", () => {
    expect(
      evaluateVerdict([REQUIRED_CHECK, { status: "fail", required: false }]),
    ).toBe("pass");
  });

  it("requires a non-blank justification for not-applicable checks", () => {
    expect(
      evaluateVerdict([
        { status: "not_applicable", required: true, justification: "   " },
      ]),
    ).toBe("inconclusive");
  });

  it.each([
    null,
    {},
    [{}],
    [{ status: "approved", required: true }],
    [{ status: "pass" }],
  ])("returns inconclusive for malformed external check data: %s", (checks) => {
    expect(evaluateVerdict(checks)).toBe("inconclusive");
  });
});

describe("getReportFreshness", () => {
  const COMPLETED_AT = Date.parse("2026-11-02T10:00:00.000Z");

  it("uses a strict 60-minute freshness window", () => {
    expect(REPORT_TTL_MS).toBe(60 * 60 * 1000);
    expect(
      getReportFreshness(COMPLETED_AT, COMPLETED_AT + REPORT_TTL_MS - 1),
    ).toBe("fresh");
    expect(getReportFreshness(COMPLETED_AT, COMPLETED_AT + REPORT_TTL_MS)).toBe(
      "stale",
    );
  });

  it("treats a future completion time as stale", () => {
    expect(getReportFreshness(COMPLETED_AT, COMPLETED_AT - 1)).toBe("stale");
  });

  it.each([Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY])(
    "treats a non-finite completion time (%s) as stale",
    (completedAt) => {
      expect(getReportFreshness(completedAt, COMPLETED_AT)).toBe("stale");
    },
  );

  it.each([Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY])(
    "treats a non-finite current time (%s) as stale",
    (now) => {
      expect(getReportFreshness(COMPLETED_AT, now)).toBe("stale");
    },
  );
});
