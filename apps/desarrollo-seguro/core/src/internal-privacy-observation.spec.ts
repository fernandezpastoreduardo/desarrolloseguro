import { describe, expect, it } from "vitest";
import { parseInternalPrivacyObservation } from "./internal-privacy-observation.js";

const validObservation = {
  area: "consent",
  status: "pass",
  signalCode: "consent_choice_recorded",
  value: 1,
  unit: "boolean",
  sampleRef: `sha256:${"e".repeat(64)}`,
  observedAt: "2026-11-18T17:30:00.000Z",
};

describe("internal privacy observation", () => {
  it("accepts a bounded consent signal", () => {
    expect(parseInternalPrivacyObservation(validObservation)).toEqual(validObservation);
  });

  it.each([
    { signalCode: "cookie_name" },
    { signalCode: "https://tracker.example" },
    { value: "consent text" },
    { domain: "tracker.example" },
    { cookieValue: "identifier" },
    { script: "analytics.js" },
  ])("rejects raw privacy data: %o", (override) => {
    expect(() => parseInternalPrivacyObservation({ ...validObservation, ...override }))
      .toThrow("internal_privacy_observation_invalid");
  });

  it("accepts aggregate third-party and storage signals", () => {
    expect(parseInternalPrivacyObservation({
      area: "third_party",
      status: "unknown",
      signalCode: "known_tracker_request_count",
      value: 3,
      unit: "count",
      sampleRef: `sha256:${"f".repeat(64)}`,
      observedAt: "2026-11-18T17:30:00.000Z",
    }).value).toBe(3);
    expect(parseInternalPrivacyObservation({
      area: "storage",
      status: "fail",
      signalCode: "nonessential_storage_before_consent",
      value: 1,
      unit: "boolean",
      sampleRef: `sha256:${"1".repeat(64)}`,
      observedAt: "2026-11-18T17:30:00.000Z",
    }).status).toBe("fail");
  });

  it("rejects signal and unit combinations outside the catalog", () => {
    expect(() => parseInternalPrivacyObservation({
      ...validObservation,
      signalCode: "known_tracker_request_count",
      unit: "boolean",
    })).toThrow("internal_privacy_observation_invalid");
  });
});
