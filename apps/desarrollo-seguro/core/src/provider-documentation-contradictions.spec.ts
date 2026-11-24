import { describe, expect, it } from "vitest";
import {
  compareProviderDocumentation,
  isProviderLegalEvidenceContext,
  parseProviderDocumentationContradiction,
  type ProviderEvidenceSource,
  type ProviderLegalEvidence,
} from "./provider-documentation-contradictions.js";
import { PROVIDER_LEGAL_RULES } from "./provider-legal-rules.js";

const siteSource: ProviderEvidenceSource = {
  sourceId: "audited-privacy-policy",
  version: "scan-2026-11-24",
  title: "Política de privacidad",
  url: "https://audited.example/privacy?lang=es",
  capturedAt: "2026-11-24T03:00:00Z",
  excerpt: "El responsable no comunica datos personales a proveedores externos.",
  documentKind: "privacy",
  sourceKind: "audited_site",
};
const providerSource: ProviderEvidenceSource = {
  sourceId: "vendor-data-controls",
  version: "catalog-2026-11",
  title: "Data controls",
  url: "https://vendor.example/privacy/data-controls",
  capturedAt: "2026-11-24T03:00:00Z",
  excerpt: "The API provider receives prompts and responses for abuse monitoring.",
  documentKind: "service",
  sourceKind: "provider_official",
};
const statement = {
  factId: "provider_receives_personal_data",
  value: false,
  basis: "explicit_claim" as const,
  source: siteSource,
};
const providerFact = { factId: "provider_receives_personal_data", value: true, source: providerSource };

function legalEvidence(dataOrigin: "obtained_from_subject" | "not_obtained_from_subject" = "obtained_from_subject"): ProviderLegalEvidence {
  const personalData: ProviderEvidenceSource = {
    sourceId: "observed-personal-data-category",
    version: "scan-2026-11-24",
    title: "Datos personales observados en el flujo",
    url: "https://audited.example/privacy",
    capturedAt: "2026-11-24T03:00:00Z",
    excerpt: "El flujo incluye la dirección de correo electrónico asociada a una cuenta.",
    documentKind: "technical-evidence",
    sourceKind: "auditor_observation",
  };
  const controller: ProviderEvidenceSource = {
    sourceId: "controller-declaration",
    version: "scan-2026-11-24",
    title: "Responsable del tratamiento",
    url: "https://audited.example/privacy",
    capturedAt: "2026-11-24T03:00:00Z",
    excerpt: "La entidad auditada se identifica como responsable del tratamiento.",
    documentKind: "privacy",
    sourceKind: "audited_site",
  };
  const jurisdiction: ProviderEvidenceSource = {
    sourceId: "spanish-jurisdiction-evidence",
    version: "scan-2026-11-24",
    title: "Ámbito de actividad",
    url: "https://audited.example/legal",
    capturedAt: "2026-11-24T03:00:00Z",
    excerpt: "El servicio se ofrece a personas usuarias en España.",
    documentKind: "legal",
    sourceKind: "audited_site",
  };
  const origin: ProviderEvidenceSource = {
    sourceId: "collection-origin",
    version: "scan-2026-11-24",
    title: "Origen de los datos",
    url: "https://audited.example/privacy",
    capturedAt: "2026-11-24T03:00:00Z",
    excerpt: dataOrigin === "obtained_from_subject"
      ? "La persona facilita directamente sus datos al registrarse."
      : "Los datos se reciben del comercio que gestiona la cuenta.",
    documentKind: "privacy",
    sourceKind: "audited_site",
  };
  return {
    dataOrigin: { value: dataOrigin, evidence: [origin] },
    elements: {
      site_denies_or_omits_recipient: { status: "satisfied", evidence: [siteSource] },
      provider_receives_matching_data: { status: "satisfied", evidence: [providerSource] },
      personal_data_in_flow: { status: "satisfied", evidence: [personalData] },
      audited_entity_is_controller: { status: "satisfied", evidence: [controller] },
      data_origin_is_established: { status: "satisfied", evidence: [origin] },
      aepd_jurisdiction_is_established: { status: "satisfied", evidence: [jurisdiction] },
    },
  };
}

describe("provider documentation contradictions", () => {
  it("accepts legal context only when each supporting source is an audited-site source", () => {
    const source = legalEvidence().dataOrigin.evidence[0];
    expect(isProviderLegalEvidenceContext({
      dataOrigin: { value: "obtained_from_subject", evidence: [source] },
      auditedEntityIsController: { evidence: [siteSource] },
    })).toBe(true);
    expect(isProviderLegalEvidenceContext({
      dataOrigin: { value: "obtained_from_subject", evidence: [providerSource] },
    })).toBe(false);
    expect(isProviderLegalEvidenceContext({})).toBe(false);
    expect(isProviderLegalEvidenceContext({ unrelated: true })).toBe(false);
  });

  it("preserves independent sources and maps directly evidenced recipient mismatch to GDPR art. 13", () => {
    const result = compareProviderDocumentation({
      providerId: "openai-api",
      sourceStatus: "located",
      siteStatements: [statement],
      providerFacts: [providerFact],
      legalEvidence: legalEvidence(),
    });
    expect(result).toMatchObject({
      status: "contradiction_confirmed",
      comparisons: [{
        factId: "provider_receives_personal_data",
        relation: "opposes",
        siteStatement: siteSource,
        providerFact: providerSource,
        legalFinding: {
          status: "infraccion_legal_acreditada",
          ruleId: "gdpr-recipient-disclosure-article-13-v1",
          catalogVersion: "provider-legal-rules-v1",
          articles: ["12(1)", "83(5)(b)", "13(1)(e)"],
          nationalClassification: { article: "74(a)", character: "formal" },
          sanction: { isSpecificFinePrediction: false },
          supportingEvidence: {
            personal_data_in_flow: ["observed-personal-data-category"],
            audited_entity_is_controller: ["controller-declaration"],
          },
          supportingSources: {
            personal_data_in_flow: [{ sourceId: "observed-personal-data-category", sourceKind: "auditor_observation" }],
            audited_entity_is_controller: [{ sourceId: "controller-declaration", sourceKind: "audited_site" }],
          },
        },
      }],
    });
    expect(result?.comparisons[0]?.legalFinding?.sanction.alternatives).toEqual([
      { type: "fixed_amount", currency: "EUR", amount: 20_000_000 },
      { type: "global_annual_turnover_percentage", percentage: 4 },
    ]);
    expect(parseProviderDocumentationContradiction(result)).toEqual(result);
    if (!result) throw new Error("expected_contradiction");
    const legacy = JSON.parse(JSON.stringify(result)) as typeof result;
    if (!legacy) throw new Error("expected_legacy_fixture");
    delete legacy.comparisons[0]?.legalFinding?.supportingSources;
    expect(parseProviderDocumentationContradiction(legacy)).toEqual(legacy);
    const forged = JSON.parse(JSON.stringify(result)) as {
      comparisons: Array<{ legalFinding: { sanction: { alternatives: Array<Record<string, unknown>> } } }>;
    };
    if (forged.comparisons[0]) {
      forged.comparisons[0].legalFinding.sanction.alternatives[0] = {
        type: "fixed_amount",
        currency: "EUR",
        amount: 1,
      };
    }
    expect(parseProviderDocumentationContradiction(forged)).toBeNull();
  });

  it("uses the cataloged legal rule and sanction scale, rejecting malformed catalog replacements", () => {
    const rule = PROVIDER_LEGAL_RULES["gdpr-recipient-disclosure-article-13-v1"];
    if (!rule) throw new Error("provider_legal_rule_missing");
    const changedSanction = {
      ...rule.sanction,
      alternatives: [
        { type: "fixed_amount", currency: "EUR", amount: 25_000_000 },
        { type: "global_annual_turnover_percentage", percentage: 4 },
      ],
    } as const;
    const dynamic = compareProviderDocumentation({
      providerId: "openai-api", sourceStatus: "located", siteStatements: [statement], providerFacts: [providerFact],
      legalEvidence: legalEvidence(), legalRules: [{ ...rule, sanction: changedSanction }],
    });
    expect(dynamic?.comparisons[0]?.legalFinding?.sanction.alternatives[0]).toEqual(changedSanction.alternatives[0]);

    const invalid = compareProviderDocumentation({
      providerId: "openai-api", sourceStatus: "located", siteStatements: [statement], providerFacts: [providerFact],
      legalEvidence: legalEvidence(), legalRules: [{ ...rule, sanction: { ...rule.sanction, alternatives: [] } }],
    });
    expect(invalid?.comparisons[0]).toMatchObject({ relation: "opposes", legalMappingStatus: "not_available" });
    expect(invalid?.comparisons[0]?.legalFinding).toBeUndefined();
  });

  it("selects article 14 only when the evidence says data were not obtained from the person", () => {
    const result = compareProviderDocumentation({
      providerId: "openai-api", sourceStatus: "located", siteStatements: [statement],
      providerFacts: [providerFact], legalEvidence: legalEvidence("not_obtained_from_subject"),
    });
    expect(result?.comparisons[0]?.legalFinding?.ruleId)
      .toBe("gdpr-recipient-disclosure-article-14-v1");
    expect(result?.comparisons[0]?.legalFinding?.articles).toContain("14(1)(e)");
  });

  it("keeps a demonstrated contradiction without a legal finding when required elements are missing", () => {
    const withoutEvidence = compareProviderDocumentation({
      providerId: "openai-api", sourceStatus: "located", siteStatements: [statement], providerFacts: [providerFact],
    });
    expect(withoutEvidence).toMatchObject({
      status: "contradiction_confirmed",
      comparisons: [{ relation: "opposes", legalMappingStatus: "elements_not_satisfied" }],
    });
    const completeEvidence = legalEvidence();
    const noPersonalData: ProviderLegalEvidence = {
      ...completeEvidence,
      elements: {
        ...completeEvidence.elements,
        personal_data_in_flow: { status: "unknown", evidence: [] },
      },
    };
    const unprovenPersonalData = compareProviderDocumentation({
      providerId: "openai-api", sourceStatus: "located", siteStatements: [statement], providerFacts: [providerFact],
      legalEvidence: noPersonalData,
    });
    expect(unprovenPersonalData?.comparisons[0]?.legalFinding).toBeUndefined();
    expect(unprovenPersonalData?.comparisons[0]?.legalMappingStatus).toBe("elements_not_satisfied");
  });

  it("requires site denial or omission; a positive site declaration is not this violation", () => {
    const positiveSiteStatement = { ...statement, value: true };
    expect(compareProviderDocumentation({
      providerId: "openai-api", sourceStatus: "located", siteStatements: [positiveSiteStatement],
      providerFacts: [{ ...providerFact, value: false }], legalEvidence: legalEvidence(),
    })?.comparisons[0]?.legalFinding).toBeUndefined();
  });

  it("distinguishes source and comparison failures from contradictions", () => {
    expect(compareProviderDocumentation({
      providerId: "openai-api", sourceStatus: "located", siteStatements: [statement],
      providerFacts: [{ ...providerFact, value: false }],
    })).toMatchObject({ status: "consistent", reasonCode: "matching_explicit_statements" });
    expect(compareProviderDocumentation({
      providerId: "openai-api", sourceStatus: "located", siteStatements: [statement], providerFacts: [],
    })).toMatchObject({ status: "not_comparable", reasonCode: "provider_fact_missing" });
    expect(compareProviderDocumentation({
      providerId: "openai-api", sourceStatus: "located", siteStatements: [], providerFacts: [providerFact],
    })).toMatchObject({ status: "not_comparable", reasonCode: "site_statement_missing" });
    expect(compareProviderDocumentation({
      providerId: "openai-api", sourceStatus: "not_located", siteStatements: [statement], providerFacts: [],
    })).toMatchObject({ status: "source_not_located", reasonCode: "official_source_not_located" });
    expect(compareProviderDocumentation({
      providerId: "openai-api", sourceStatus: "unavailable", siteStatements: [statement], providerFacts: [],
    })).toMatchObject({ status: "source_unavailable", reasonCode: "official_source_unavailable" });
  });

  it("rejects unsafe source records and malformed evidence", () => {
    expect(compareProviderDocumentation({
      providerId: "openai-api", sourceStatus: "located", siteStatements: [{
        ...statement, source: { ...siteSource, url: "http://audited.example/privacy" },
      }], providerFacts: [providerFact],
    })).toBeNull();
    expect(compareProviderDocumentation({
      providerId: "openai-api", sourceStatus: "located", siteStatements: [{
        ...statement, source: { ...siteSource, excerpt: "user@example.com" },
      }], providerFacts: [providerFact],
    })).toBeNull();
    const malformed = legalEvidence() as unknown as { elements: Record<string, unknown> };
    malformed.elements.personal_data_in_flow = { status: "satisfied", evidence: ["no source reference"] };
    expect(compareProviderDocumentation({
      providerId: "openai-api", sourceStatus: "located", siteStatements: [statement], providerFacts: [providerFact],
      legalEvidence: malformed as unknown as ProviderLegalEvidence,
    })?.comparisons[0]?.legalFinding).toBeUndefined();
  });

  it("validates official-source receipts and rejects duplicate or malformed entries", () => {
    const comparison = compareProviderDocumentation({
      providerId: "openai-api", sourceStatus: "located", siteStatements: [statement], providerFacts: [providerFact],
    });
    if (!comparison) throw new Error("expected_comparison");
    const receipt = {
      documentId: "openai-privacy",
      title: "Privacy documentation",
      url: "https://provider.example/privacy",
      status: "fetched",
      sha256: "a".repeat(64),
      checkedAt: "2026-11-24T03:00:00Z",
    };
    expect(parseProviderDocumentationContradiction({ ...comparison, sourceEvidence: [receipt] }))
      .toMatchObject({ sourceEvidence: [receipt] });
    expect(parseProviderDocumentationContradiction({ ...comparison, sourceEvidence: [receipt, receipt] })).toBeNull();
    expect(parseProviderDocumentationContradiction({ ...comparison, sourceEvidence: [{ ...receipt, url: "http://provider.example/privacy" }] })).toBeNull();
    const invalidMapping = JSON.parse(JSON.stringify({
      ...comparison,
      comparisons: [{ ...comparison.comparisons[0], legalMappingStatus: "unknown_mapping" }],
    })) as unknown;
    expect(parseProviderDocumentationContradiction(invalidMapping)).toBeNull();
  });
});
