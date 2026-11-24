import {
  PROVIDER_RECEIVES_PERSONAL_DATA_FACT,
  type ProviderEvidenceSource,
  type ProviderFact,
  type ProviderLegalDataOrigin,
  type ProviderLegalElementEvidence,
  type ProviderLegalEvidence,
  type ProviderStatement,
} from "@desarrolloseguro/core";

type ExplicitEvidence = {
  evidence: readonly ProviderEvidenceSource[];
};

type PersonalDataFlowEvidence = ExplicitEvidence & (
  | { basis: "direct_personal_data_flow" }
  | { basis: "destination_host_only" }
);

export type ProviderLegalEvidenceContext = {
  dataOrigin?: {
    value: ProviderLegalDataOrigin;
    evidence: readonly ProviderEvidenceSource[];
  };
  personalDataInFlow?: PersonalDataFlowEvidence;
  auditedEntityIsController?: ExplicitEvidence;
  aepdJurisdictionIsEstablished?: ExplicitEvidence;
};

/**
 * Assembles legal-element evidence from already classified, directly sourced
 * inputs. It does not classify data, decide jurisdiction, or emit findings.
 */
export function buildProviderLegalEvidence(
  siteStatement: ProviderStatement,
  providerFact: ProviderFact,
  context: ProviderLegalEvidenceContext = {},
): ProviderLegalEvidence {
  const recipientFactMatches = siteStatement.factId === PROVIDER_RECEIVES_PERSONAL_DATA_FACT &&
    providerFact.factId === PROVIDER_RECEIVES_PERSONAL_DATA_FACT;
  const siteDenial = recipientFactMatches && siteStatement.value === false &&
    siteStatement.source.sourceKind === "audited_site"
    ? satisfied([siteStatement.source])
    : unknown();
  const providerReceipt = recipientFactMatches && providerFact.value === true &&
    providerFact.source.sourceKind === "provider_official"
    ? satisfied([providerFact.source])
    : unknown();

  const dataOrigin = context.dataOrigin &&
    isDataOrigin(context.dataOrigin.value) &&
    hasDirectEvidence(context.dataOrigin.evidence, ["audited_site", "auditor_observation"])
    ? { value: context.dataOrigin.value, evidence: [...context.dataOrigin.evidence] }
    : { value: "unknown" as const, evidence: [] };

  const personalDataInFlow = context.personalDataInFlow?.basis === "direct_personal_data_flow" &&
    hasDirectEvidence(context.personalDataInFlow.evidence, ["audited_site", "auditor_observation"])
    ? satisfied(context.personalDataInFlow.evidence)
    : unknown();
  const controller = context.auditedEntityIsController &&
    hasDirectEvidence(context.auditedEntityIsController.evidence, ["audited_site"])
    ? satisfied(context.auditedEntityIsController.evidence)
    : unknown();
  const jurisdiction = context.aepdJurisdictionIsEstablished &&
    hasDirectEvidence(context.aepdJurisdictionIsEstablished.evidence, ["audited_site", "auditor_observation"])
    ? satisfied(context.aepdJurisdictionIsEstablished.evidence)
    : unknown();

  return {
    dataOrigin,
    elements: {
      site_denies_or_omits_recipient: siteDenial,
      provider_receives_matching_data: providerReceipt,
      personal_data_in_flow: personalDataInFlow,
      audited_entity_is_controller: controller,
      data_origin_is_established: dataOrigin.value === "unknown" ? unknown() : satisfied(dataOrigin.evidence),
      aepd_jurisdiction_is_established: jurisdiction,
    },
  };
}

function satisfied(evidence: readonly ProviderEvidenceSource[]): ProviderLegalElementEvidence {
  return { status: "satisfied", evidence: [...evidence] };
}

function unknown(): ProviderLegalElementEvidence {
  return { status: "unknown", evidence: [] };
}

function hasDirectEvidence(
  evidence: readonly ProviderEvidenceSource[],
  allowedKinds: readonly ProviderEvidenceSource["sourceKind"][],
): boolean {
  return evidence.length > 0 && evidence.every((source) => allowedKinds.includes(source.sourceKind));
}

function isDataOrigin(value: unknown): value is ProviderLegalDataOrigin {
  return value === "obtained_from_subject" || value === "not_obtained_from_subject";
}
