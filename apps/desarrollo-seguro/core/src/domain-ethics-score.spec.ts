import { describe, expect, it } from "vitest";
import { assessDomainEthics } from "./domain-ethics-score.js";

const check = (controlId: string, status: "pass" | "fail" | "unknown") => ({
  controlId,
  status,
  summary: `${controlId} ${status}`,
});

describe("assessDomainEthics", () => {
  it("scores only measured criteria and marks unmeasured privacy and performance unknown", () => {
    const result = assessDomainEthics([
      check("DS-DNS-01", "pass"),
      check("DS-TLS-01", "pass"),
      check("DS-HTTP-01", "pass"),
      check("DS-HDR-01", "pass"),
    ]);

    expect(result).toMatchObject({
      score: 100,
      assessedCriteria: 4,
      totalCriteria: 8,
      maturity: "partial",
    });
    expect(result.criteria.filter(({ status }) => status === "unknown")).toHaveLength(4);
  });

  it("reduces score for a failed observed security criterion and explains why", () => {
    const result = assessDomainEthics([
      check("DS-DNS-01", "pass"),
      check("DS-TLS-01", "fail"),
      check("DS-HTTP-01", "pass"),
      check("DS-HDR-01", "pass"),
    ]);

    expect(result.score).toBe(64);
    expect(result.reasons).toContain(
      "Seguridad del transporte TLS: el control observado presenta fallos.",
    );
  });

  it("does not infer third-party data selling, cookies, consent or tracking from absent evidence", () => {
    const result = assessDomainEthics([]);

    expect(result.score).toBeNull();
    expect(result.criteria.find(({ id }) => id === "third-party-data-use")?.status).toBe("unknown");
    expect(result.reasons).toContain(
      "No hay evidencia verificable sobre reutilización o venta de datos por terceros.",
    );
  });

  it("reduces the score when a future, explicit third-party data-use control fails", () => {
    const technicalPasses = [
      check("DS-DNS-01", "pass"),
      check("DS-TLS-01", "pass"),
      check("DS-HTTP-01", "pass"),
      check("DS-HDR-01", "pass"),
    ];
    const withoutFutureControl = assessDomainEthics(technicalPasses);
    const withVerifiedFutureFailure = assessDomainEthics([
      ...technicalPasses,
      check("DS-PRIV-04", "fail"),
    ]);

    expect(withoutFutureControl.score).toBe(100);
    expect(withVerifiedFutureFailure.criteria.find(({ id }) => id === "third-party-data-use")?.status).toBe("fail");
    expect(withVerifiedFutureFailure.score).toBe(88);
    expect(withVerifiedFutureFailure.score).toBeLessThan(withoutFutureControl.score ?? 100);
  });

  it("keeps unknown checks out of the denominator and rejects duplicate evidence", () => {
    const result = assessDomainEthics([
      check("DS-TLS-01", "unknown"),
      check("DS-TLS-01", "fail"),
    ]);

    expect(result.score).toBeNull();
    expect(result.criteria.find(({ id }) => id === "transport-security")?.status).toBe("unknown");
  });
});
