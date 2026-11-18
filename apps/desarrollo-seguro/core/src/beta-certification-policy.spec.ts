import { describe, expect, it } from "vitest";
import {
  assessBetaCertification,
  type BetaControlObservation,
} from "./beta-certification-policy.js";

const observation = (
  controlId: BetaControlObservation["controlId"],
  status: BetaControlObservation["status"],
): BetaControlObservation => ({
  controlId,
  status,
  summary: `${controlId}:${status}`,
});

const allPass = (): BetaControlObservation[] => [
  observation("DS-TLS-01", "pass"),
  observation("DS-TLS-02", "pass"),
  observation("DS-HDR-01", "pass"),
  observation("DS-PRIV-05", "pass"),
];

describe("assessBetaCertification", () => {
  it("returns an eligible provisional assessment when every beta category passes", () => {
    expect(assessBetaCertification(allPass())).toMatchObject({
      policyVersion: "beta-0.1",
      score: 100,
      eligibility: "eligible",
      assessedCategories: 3,
      totalCategories: 3,
    });
  });

  it("normalizes the score over observed categories but keeps missing evidence pending", () => {
    const result = assessBetaCertification([
      observation("DS-TLS-01", "pass"),
      observation("DS-TLS-02", "pass"),
      observation("DS-HDR-01", "pass"),
      observation("DS-PRIV-05", "unknown"),
    ]);

    expect(result.score).toBe(100);
    expect(result.eligibility).toBe("pending");
    expect(result.assessedCategories).toBe(2);
    expect(result.reasons).toContain(
      "Cookies y privacidad observable: falta evidencia concluyente.",
    );
  });

  it("blocks certification when a critical TLS control fails", () => {
    const result = assessBetaCertification([
      observation("DS-TLS-01", "fail"),
      observation("DS-TLS-02", "pass"),
      observation("DS-HDR-01", "pass"),
      observation("DS-PRIV-05", "pass"),
    ]);

    expect(result).toMatchObject({ score: 60, eligibility: "blocked" });
    expect(result.reasons).toContain(
      "Seguridad TLS: existe un incumplimiento crítico.",
    );
  });

  it("blocks certification below the beta threshold", () => {
    const result = assessBetaCertification([
      observation("DS-TLS-01", "pass"),
      observation("DS-TLS-02", "pass"),
      observation("DS-HDR-01", "fail"),
      observation("DS-PRIV-05", "pass"),
    ]);

    expect(result).toMatchObject({ score: 70, eligibility: "blocked" });
    expect(result.reasons).toContain(
      "La puntuación provisional queda por debajo de 90.",
    );
  });

  it("does not invent a score when no category is conclusive", () => {
    const result = assessBetaCertification([
      observation("DS-TLS-01", "unknown"),
      observation("DS-TLS-02", "unknown"),
      observation("DS-HDR-01", "unknown"),
      observation("DS-PRIV-05", "unknown"),
    ]);

    expect(result).toMatchObject({
      score: null,
      eligibility: "pending",
      assessedCategories: 0,
    });
  });

  it("treats contradictory observations as unknown instead of choosing one", () => {
    const result = assessBetaCertification([
      ...allPass(),
      observation("DS-HDR-01", "fail"),
    ]);

    expect(result.categories.find(({ id }) => id === "security-headers"))
      .toMatchObject({ status: "unknown" });
    expect(result.eligibility).toBe("pending");
  });
});
