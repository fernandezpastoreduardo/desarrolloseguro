import { describe, expect, it } from "vitest";
import { parseInternalQualityObservation } from "./internal-quality-observation.js";

const validObservation = {
  kind: "performance_sample",
  status: "pass",
  metricCode: "response_time",
  value: 842,
  unit: "milliseconds",
  sampleRef: `sha256:${"b".repeat(64)}`,
  observedAt: "2026-11-18T17:00:00.000Z",
};

describe("internal quality observation", () => {
  it("accepts a bounded production metric", () => {
    expect(parseInternalQualityObservation(validObservation)).toEqual(validObservation);
  });

  it.each([
    { kind: "raw_trace" },
    { metricCode: "full_html" },
    { value: 120001 },
    { unit: "url" },
    { sampleRef: "run-123" },
    { screenshot: "base64" },
  ])("rejects unbounded or sensitive quality data: %o", (override) => {
    expect(() => parseInternalQualityObservation({ ...validObservation, ...override }))
      .toThrow("internal_quality_observation_invalid");
  });

  it("accepts boolean accessibility and responsive checks", () => {
    expect(parseInternalQualityObservation({
      kind: "accessibility_snapshot",
      status: "pass",
      metricCode: "accessibility_critical_violations",
      value: 0,
      unit: "count",
      sampleRef: `sha256:${"c".repeat(64)}`,
      observedAt: "2026-11-18T17:00:00.000Z",
    }).value).toBe(0);
    expect(parseInternalQualityObservation({
      kind: "responsive_check",
      status: "pass",
      metricCode: "responsive_breakpoint_pass",
      value: 1,
      unit: "boolean",
      sampleRef: `sha256:${"d".repeat(64)}`,
      observedAt: "2026-11-18T17:00:00.000Z",
    }).unit).toBe("boolean");
  });

  it("rejects metric and unit combinations outside the catalog", () => {
    expect(() => parseInternalQualityObservation({
      ...validObservation,
      metricCode: "accessibility_critical_violations",
      unit: "milliseconds",
    })).toThrow("internal_quality_observation_invalid");
  });
});
