import { describe, expect, it } from "vitest";
import { parseSyntheticAuthObservation } from "./internal-synthetic-auth.js";

const validObservation = {
  flow: "authorization_boundary",
  status: "pass",
  principalClass: "synthetic_auditor",
  subjectRef: `sha256:${"a".repeat(64)}`,
  observedAt: "2026-11-18T16:00:00.000Z",
  reasonCode: "cross_account_denied",
};

describe("internal synthetic authentication evidence", () => {
  it("accepts a redacted synthetic account observation", () => {
    expect(parseSyntheticAuthObservation(validObservation)).toEqual(validObservation);
  });

  it.each([
    { flow: "password_reset" },
    { principalClass: "real_user" },
    { subjectRef: "user@example.com" },
    { status: "error details" },
    { token: "secret-token" },
  ])("rejects credentials or unapproved auth data: %o", (override) => {
    expect(() => parseSyntheticAuthObservation({ ...validObservation, ...override }))
      .toThrow("internal_synthetic_auth_observation_invalid");
  });
});
