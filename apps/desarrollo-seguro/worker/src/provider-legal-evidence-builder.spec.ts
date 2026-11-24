import {
  getProviderLegalRule,
  PROVIDER_RECEIVES_PERSONAL_DATA_FACT,
  type ProviderEvidenceSource,
  type ProviderFact,
  type ProviderLegalDataOrigin,
  type ProviderStatement,
} from "@desarrolloseguro/core";
import { describe, expect, it } from "vitest";
import { buildProviderLegalEvidence, type ProviderLegalEvidenceContext } from "./provider-legal-evidence-builder.js";

const siteSource = source("audited_site", "site-statement", "La política declara que el proveedor no recibe datos personales.");
const providerSource = source("provider_official", "provider-document", "La documentación describe la recepción de datos personales.");
const subjectOriginSource = source("audited_site", "data-origin-subject", "El usuario facilita los datos mediante el formulario.");
const indirectOriginSource = source("audited_site", "data-origin-third-party", "El sitio recibe estos datos del cliente empresarial.");
const flowSource = source("auditor_observation", "flow-observation", "Se observó el envío del campo identificado en la política.");
const controllerSource = source("audited_site", "controller-notice", "La entidad se identifica como responsable del tratamiento.");
const jurisdictionSource = source("audited_site", "jurisdiction-notice", "La entidad identifica su establecimiento en España.");
const hostOnlySource = source("auditor_observation", "host-only", "Se observó una solicitud a analytics.example.");

const siteStatement: ProviderStatement = {
  factId: PROVIDER_RECEIVES_PERSONAL_DATA_FACT,
  value: false,
  basis: "explicit_claim",
  source: siteSource,
};
const providerFact: ProviderFact = {
  factId: PROVIDER_RECEIVES_PERSONAL_DATA_FACT,
  value: true,
  source: providerSource,
};

describe("buildProviderLegalEvidence", () => {
  it.each([
    ["obtained_from_subject", "13(1)(e)"],
    ["not_obtained_from_subject", "14(1)(e)"],
  ] as const)("preserves explicit data origin %s for article %s without creating a finding", (origin, article) => {
    const result = buildProviderLegalEvidence(siteStatement, providerFact, completeContext(origin));

    expect(result.dataOrigin).toEqual({ value: origin, evidence: [originEvidence(origin)] });
    expect(result.elements).toMatchObject({
      site_denies_or_omits_recipient: { status: "satisfied", evidence: [siteSource] },
      provider_receives_matching_data: { status: "satisfied", evidence: [providerSource] },
      personal_data_in_flow: { status: "satisfied", evidence: [flowSource] },
      audited_entity_is_controller: { status: "satisfied", evidence: [controllerSource] },
      data_origin_is_established: { status: "satisfied", evidence: [originEvidence(origin)] },
      aepd_jurisdiction_is_established: { status: "satisfied", evidence: [jurisdictionSource] },
    });
    expect(getProviderLegalRule(PROVIDER_RECEIVES_PERSONAL_DATA_FACT, origin)?.articles).toContain(article);
    expect(result).not.toHaveProperty("legalFinding");
  });

  it.each([
    "site_denies_or_omits_recipient",
    "provider_receives_matching_data",
    "personal_data_in_flow",
    "audited_entity_is_controller",
    "data_origin_is_established",
    "aepd_jurisdiction_is_established",
  ] as const)("leaves %s unknown when its direct evidence is absent", (element) => {
    const context = completeContext();
    let statement = siteStatement;
    let fact = providerFact;
    if (element === "site_denies_or_omits_recipient") statement = { ...siteStatement, value: true };
    if (element === "provider_receives_matching_data") fact = { ...providerFact, value: false };
    if (element === "personal_data_in_flow") delete context.personalDataInFlow;
    if (element === "audited_entity_is_controller") delete context.auditedEntityIsController;
    if (element === "data_origin_is_established") delete context.dataOrigin;
    if (element === "aepd_jurisdiction_is_established") delete context.aepdJurisdictionIsEstablished;

    const result = buildProviderLegalEvidence(statement, fact, context);

    expect(result.elements[element]).toEqual({ status: "unknown", evidence: [] });
  });

  it("does not treat an observed destination host as evidence of personal data in the flow", () => {
    const result = buildProviderLegalEvidence(siteStatement, providerFact, {
      ...completeContext(),
      personalDataInFlow: { basis: "destination_host_only", evidence: [hostOnlySource] },
    });

    expect(result.elements.personal_data_in_flow).toEqual({ status: "unknown", evidence: [] });
    expect(result).not.toHaveProperty("legalFinding");
  });

  it("leaves the whole legal element unknown when the provider fact is about a different fact", () => {
    const result = buildProviderLegalEvidence(siteStatement, {
      ...providerFact,
      factId: "provider_receives_content",
    });

    expect(result.elements.site_denies_or_omits_recipient).toEqual({ status: "unknown", evidence: [] });
    expect(result.elements.provider_receives_matching_data).toEqual({ status: "unknown", evidence: [] });
  });
});

function completeContext(dataOrigin: ProviderLegalDataOrigin = "obtained_from_subject"): ProviderLegalEvidenceContext {
  return {
    dataOrigin: { value: dataOrigin, evidence: [originEvidence(dataOrigin)] },
    personalDataInFlow: { basis: "direct_personal_data_flow", evidence: [flowSource] },
    auditedEntityIsController: { evidence: [controllerSource] },
    aepdJurisdictionIsEstablished: { evidence: [jurisdictionSource] },
  };
}

function originEvidence(dataOrigin: ProviderLegalDataOrigin): ProviderEvidenceSource {
  return dataOrigin === "obtained_from_subject" ? subjectOriginSource : indirectOriginSource;
}

function source(
  sourceKind: ProviderEvidenceSource["sourceKind"],
  sourceId: string,
  excerpt: string,
): ProviderEvidenceSource {
  return {
    sourceId,
    version: "fixture-v1",
    title: "Prueba documental",
    url: `https://${sourceKind === "provider_official" ? "provider.example" : "site.example"}/${sourceId}`,
    capturedAt: "2026-11-24T03:00:00.000Z",
    excerpt,
    documentKind: sourceKind === "auditor_observation" ? "technical-evidence" : "privacy",
    sourceKind,
  };
}
