export const PROVIDER_LEGAL_CATALOG_VERSION = "provider-legal-rules-v1" as const;
export const PROVIDER_RECEIVES_PERSONAL_DATA_FACT = "provider_receives_personal_data" as const;
export const PROVIDER_RECIPIENT_DISCLOSURE_ELEMENT_IDS = [
  "site_denies_or_omits_recipient",
  "provider_receives_matching_data",
  "personal_data_in_flow",
  "audited_entity_is_controller",
  "data_origin_is_established",
  "aepd_jurisdiction_is_established",
] as const;

export type ProviderLegalDataOrigin = "obtained_from_subject" | "not_obtained_from_subject";
export type ProviderLegalElementId = typeof PROVIDER_RECIPIENT_DISCLOSURE_ELEMENT_IDS[number];

export type ProviderLegalSourceRecord = {
  sourceId: string;
  issuer: "BOE" | "AEPD";
  title: string;
  url: string;
  version: string;
  checkedAt: string;
};

export type ProviderLegalSanctionScale = {
  type: "greater_of";
  alternatives: readonly [
    { type: "fixed_amount"; currency: "EUR"; amount: number },
    { type: "global_annual_turnover_percentage"; percentage: number },
  ];
  legalBasis: "GDPR Article 83(5)(b)";
  isSpecificFinePrediction: false;
};

export type ProviderLegalRule = {
  ruleId: string;
  catalogVersion: typeof PROVIDER_LEGAL_CATALOG_VERSION;
  factId: typeof PROVIDER_RECEIVES_PERSONAL_DATA_FACT;
  dataOrigin: ProviderLegalDataOrigin;
  instrument: "Reglamento (UE) 2016/679";
  articles: readonly string[];
  classification: "infraccion_formal_de_transparencia";
  nationalClassification: { instrument: "Ley Orgánica 3/2018"; article: "74(a)"; character: "formal" };
  authority: "Agencia Española de Protección de Datos";
  sanction: ProviderLegalSanctionScale;
  applicableWhen: readonly ProviderLegalElementId[];
  references: readonly ProviderLegalSourceRecord[];
  reasoning: string;
};

const CHECKED_AT = "2026-11-24T00:00:00Z";
const GDPR_SOURCE: ProviderLegalSourceRecord = {
  sourceId: "gdpr-official-text",
  issuer: "BOE",
  title: "Reglamento (UE) 2016/679, texto oficial",
  url: "https://www.boe.es/buscar/doc.php?id=DOUE-L-2016-80807",
  version: "DOUE-L-2016-119; versión oficial consultada 2026-11-24",
  checkedAt: CHECKED_AT,
};
const LOPDGDD_SOURCE: ProviderLegalSourceRecord = {
  sourceId: "lopdgdd-official-text",
  issuer: "BOE",
  title: "Ley Orgánica 3/2018, texto consolidado",
  url: "https://www.boe.es/buscar/act.php?id=BOE-A-2018-16673",
  version: "BOE-A-2018-16673; consolidación consultada 2026-11-24",
  checkedAt: CHECKED_AT,
};
const AEPD_DECISION_SOURCE: ProviderLegalSourceRecord = {
  sourceId: "aepd-pa-00027-2024",
  issuer: "AEPD",
  title: "Resolución PA-00027-2024",
  url: "https://www.aepd.es/documento/pa-00027-2024.pdf",
  version: "PA-00027-2024; referencia consultada 2026-11-24",
  checkedAt: CHECKED_AT,
};

const recipientDisclosureElements = [...PROVIDER_RECIPIENT_DISCLOSURE_ELEMENT_IDS] as const;
const gdprArticles = ["12(1)", "83(5)(b)"] as const;

export const PROVIDER_LEGAL_RULES: Readonly<Record<string, ProviderLegalRule>> = Object.freeze({
  "gdpr-recipient-disclosure-article-13-v1": {
    ruleId: "gdpr-recipient-disclosure-article-13-v1",
    catalogVersion: PROVIDER_LEGAL_CATALOG_VERSION,
    factId: PROVIDER_RECEIVES_PERSONAL_DATA_FACT,
    dataOrigin: "obtained_from_subject",
    instrument: "Reglamento (UE) 2016/679",
    articles: [...gdprArticles, "13(1)(e)"],
    classification: "infraccion_formal_de_transparencia",
    nationalClassification: { instrument: "Ley Orgánica 3/2018" as const, article: "74(a)" as const, character: "formal" as const },
    authority: "Agencia Española de Protección de Datos",
    sanction: {
      type: "greater_of",
      alternatives: [
        { type: "fixed_amount", currency: "EUR", amount: 20_000_000 },
        { type: "global_annual_turnover_percentage", percentage: 4 },
      ],
      legalBasis: "GDPR Article 83(5)(b)",
      isSpecificFinePrediction: false,
    },
    applicableWhen: recipientDisclosureElements,
    references: [GDPR_SOURCE, LOPDGDD_SOURCE, AEPD_DECISION_SOURCE],
    reasoning: "AEPD PA-00027-2024 trata el deber de información de los artículos 13 y 83(5)(b) del RGPD y cita LOPDGDD 74(a) para la infracción formal de transparencia. La regla solo se aplica a una discrepancia acreditada sobre destinatarios de datos personales del responsable.",
  },
  "gdpr-recipient-disclosure-article-14-v1": {
    ruleId: "gdpr-recipient-disclosure-article-14-v1",
    catalogVersion: PROVIDER_LEGAL_CATALOG_VERSION,
    factId: PROVIDER_RECEIVES_PERSONAL_DATA_FACT,
    dataOrigin: "not_obtained_from_subject",
    instrument: "Reglamento (UE) 2016/679",
    articles: [...gdprArticles, "14(1)(e)"],
    classification: "infraccion_formal_de_transparencia",
    nationalClassification: { instrument: "Ley Orgánica 3/2018" as const, article: "74(a)" as const, character: "formal" as const },
    authority: "Agencia Española de Protección de Datos",
    sanction: {
      type: "greater_of",
      alternatives: [
        { type: "fixed_amount", currency: "EUR", amount: 20_000_000 },
        { type: "global_annual_turnover_percentage", percentage: 4 },
      ],
      legalBasis: "GDPR Article 83(5)(b)",
      isSpecificFinePrediction: false,
    },
    applicableWhen: recipientDisclosureElements,
    references: [GDPR_SOURCE, LOPDGDD_SOURCE, AEPD_DECISION_SOURCE],
    reasoning: "La variante del artículo 14 solo se usa cuando la evidencia acredita que los datos no se obtuvieron del interesado. AEPD PA-00027-2024 apoya la clasificación formal de transparencia citando LOPDGDD 74(a); esta regla no califica la infracción como grave o muy grave.",
  },
});

export function getProviderLegalRule(
  factId: string,
  dataOrigin: ProviderLegalDataOrigin,
): ProviderLegalRule | null {
  if (factId !== PROVIDER_RECEIVES_PERSONAL_DATA_FACT) return null;
  const article = dataOrigin === "obtained_from_subject" ? "13" : "14";
  return PROVIDER_LEGAL_RULES[`gdpr-recipient-disclosure-article-${article}-v1`] ?? null;
}
