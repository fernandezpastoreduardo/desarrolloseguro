import { describe, expect, it } from "vitest";
import { assessDomainEthics, assessDomainEthicsV4, assessDomainEthicsV5 } from "./domain-ethics-score.js";
import { assessProcessorTransparency, type ProcessorTransparencyAssessment } from "./processor-inventory.js";
import { assessPublicPolicyTransparency } from "./public-policy-assessment.js";

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
      assessedCriteria: 3,
      totalCriteria: 8,
      maturity: "preliminary",
    });
    expect(result.criteria.filter(({ status }) => status === "unknown")).toHaveLength(5);
    expect(result.criteria.find(({ id }) => id === "transport-security")?.status).toBe("unknown");
  });

  it("reduces score for a failed observed security criterion and explains why", () => {
    const result = assessDomainEthics([
      check("DS-DNS-01", "pass"),
      check("DS-TLS-01", "fail"),
      check("DS-TLS-02", "pass"),
      check("DS-HTTP-01", "pass"),
      check("DS-HDR-01", "pass"),
    ]);

    expect(result.score).toBe(64);
    expect(result.reasons).toContain(
      "Seguridad del transporte TLS: el control observado presenta fallos.",
    );
  });

  it("keeps the public transparency criterion under review when the auditor has no evidence", () => {
    const result = assessDomainEthics([]);

    expect(result.score).toBeNull();
    expect(result.criteria.find(({ id }) => id === "third-party-data-use")?.status).toBe("unknown");
    expect(result.reasons).toContain(
      "El auditor no pudo terminar la revisión de la información pública sobre servicios externos.",
    );
  });

  it("reduces the score when a future, explicit third-party data-use control fails", () => {
    const technicalPasses = [
      check("DS-DNS-01", "pass"),
      check("DS-TLS-01", "pass"),
      check("DS-TLS-02", "pass"),
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

  it("scores the initial cookie observation without treating it as consent evidence", () => {
    const result = assessDomainEthics([
      check("DS-DNS-01", "pass"),
      check("DS-PRIV-05", "fail"),
    ]);

    expect(result.policyVersion).toBe("domain-ethics-v3");
    expect(result.criteria.find(({ id }) => id === "initial-cookie-risk"))
      .toMatchObject({ status: "fail", weight: 10 });
    expect(result.score).toBe(50);
  });

  it("scores passive known-tracker references and initial response performance separately", () => {
    const observed = assessDomainEthics([
      check("DS-PRIV-06", "fail"),
      check("DS-QUAL-02", "pass"),
    ]);

    expect(observed).toMatchObject({ score: 50, assessedCriteria: 2, totalCriteria: 8 });
    expect(observed.criteria.find(({ id }) => id === "tracking")?.status).toBe("fail");
    expect(observed.criteria.find(({ id }) => id === "performance")?.status).toBe("pass");
  });

  it("keeps unknown checks out of the denominator and rejects duplicate evidence", () => {
    const result = assessDomainEthics([
      check("DS-TLS-01", "unknown"),
      check("DS-TLS-01", "fail"),
    ]);

    expect(result.score).toBeNull();
    expect(result.criteria.find(({ id }) => id === "transport-security")?.status).toBe("unknown");
  });

  it("requires every control in a composite criterion before awarding a pass", () => {
    const result = assessDomainEthics([
      check("DS-TLS-01", "pass"),
      check("DS-TLS-02", "pass"),
    ]);

    expect(result.criteria.find(({ id }) => id === "transport-security")?.status).toBe("pass");
  });

  it("keeps a conclusive failure when a different required control is unobserved", () => {
    const result = assessDomainEthics([
      check("DS-TLS-01", "unknown"),
      check("DS-TLS-02", "fail"),
    ]);

    expect(result.criteria.find(({ id }) => id === "transport-security")?.status).toBe("fail");
  });

  it("scores backend processor transparency independently from browser observations", () => {
    const allPublicControlsPass = [
      check("DS-DNS-01", "pass"), check("DS-TLS-01", "pass"), check("DS-TLS-02", "pass"),
      check("DS-HTTP-01", "pass"), check("DS-HDR-01", "pass"), check("DS-PRIV-05", "pass"),
      check("DS-PRIV-06", "pass"), check("DS-QUAL-02", "pass"),
    ];
    const auditorError = assessProcessorTransparency({ status: "auditor_error" });
    const incompleteInventory = {
      policyVersion: "processor-inventory-v1",
      status: "fail",
      reasonCode: "inventory_incomplete",
      inventory: null,
    } as ProcessorTransparencyAssessment;

    const unknown = assessDomainEthicsV4(allPublicControlsPass, auditorError);
    const fail = assessDomainEthicsV4(allPublicControlsPass, incompleteInventory);

    expect(unknown).toMatchObject({ policyVersion: "domain-ethics-v4", score: 100, assessedCriteria: 7, totalCriteria: 8 });
    expect(unknown.criteria.find(({ id }) => id === "backend-processor-transparency")?.status).toBe("unknown");
    expect(fail).toMatchObject({ score: 90, assessedCriteria: 8 });
    expect(fail.criteria.find(({ id }) => id === "backend-processor-transparency")?.status).toBe("fail");
    expect(fail.reasons).toContain("Grumphya declara que su inventario de procesadores backend está incompleto.");
    expect(assessDomainEthics(allPublicControlsPass).policyVersion).toBe("domain-ethics-v3");
  });

  it("scores public disclosures for non-clients while preserving the DS-PRIV-04 weight", () => {
    const allPublicControlsPass = [
      check("DS-DNS-01", "pass"), check("DS-TLS-01", "pass"), check("DS-TLS-02", "pass"),
      check("DS-HTTP-01", "pass"), check("DS-HDR-01", "pass"), check("DS-PRIV-05", "pass"),
      check("DS-PRIV-06", "pass"), check("DS-QUAL-02", "pass"),
    ];
    const disclosure = assessPublicPolicyTransparency({
      linksFound: 2,
      pagesInspected: 2,
      unavailablePages: 0,
      accessDeniedPages: 0,
      providerMentions: 3,
      providersMissingPurpose: 0,
      categories: ["analytics", "other"],
    });
    const missingDisclosure = assessPublicPolicyTransparency({
      linksFound: 1,
      pagesInspected: 1,
      unavailablePages: 0,
      accessDeniedPages: 0,
      providerMentions: 0,
      providersMissingPurpose: 0,
      categories: [],
    });

    expect(assessDomainEthicsV5(allPublicControlsPass, null, disclosure)).toMatchObject({
      policyVersion: "domain-ethics-v5",
      score: 100,
      assessedCriteria: 8,
      totalCriteria: 8,
      criteria: expect.arrayContaining([
        expect.objectContaining({ id: "external-service-transparency", weight: 10, status: "pass" }),
      ]),
    });
    expect(assessDomainEthicsV5(allPublicControlsPass, null, missingDisclosure)).toMatchObject({
      score: 90,
      criteria: expect.arrayContaining([
        expect.objectContaining({ id: "external-service-transparency", status: "fail" }),
      ]),
      reasons: expect.arrayContaining([
        "La información pública no explica qué servicios externos se usan ni para qué.",
      ]),
    });
  });

  it("prefers authenticated backend evidence and leaves auditor errors in review", () => {
    const allPublicControlsPass = [
      check("DS-DNS-01", "pass"), check("DS-TLS-01", "pass"), check("DS-TLS-02", "pass"),
      check("DS-HTTP-01", "pass"), check("DS-HDR-01", "pass"), check("DS-PRIV-05", "pass"),
      check("DS-PRIV-06", "pass"), check("DS-QUAL-02", "pass"),
    ];
    const backendError = assessProcessorTransparency({ status: "auditor_error" });
    const publicPass = assessPublicPolicyTransparency({
      linksFound: 2,
      pagesInspected: 2,
      unavailablePages: 0,
      accessDeniedPages: 0,
      providerMentions: 3,
      providersMissingPurpose: 0,
      categories: ["analytics"],
    });

    const assessment = assessDomainEthicsV5(allPublicControlsPass, backendError, publicPass);
    expect(assessment).toMatchObject({
      policyVersion: "domain-ethics-v5",
      score: 100,
      assessedCriteria: 7,
    });
    expect(assessment.criteria.find(({ id }) => id === "external-service-transparency")?.status).toBe("unknown");
    expect(assessment.reasons).toContain("El auditor no pudo verificar el inventario de procesadores backend.");
    expect(assessDomainEthicsV4(allPublicControlsPass, backendError).policyVersion).toBe("domain-ethics-v4");
  });
});
