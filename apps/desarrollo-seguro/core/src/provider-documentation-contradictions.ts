import {
  getProviderLegalRule,
  PROVIDER_LEGAL_CATALOG_VERSION,
  PROVIDER_RECIPIENT_DISCLOSURE_ELEMENT_IDS,
  PROVIDER_RECEIVES_PERSONAL_DATA_FACT,
  type ProviderLegalDataOrigin,
  type ProviderLegalElementId,
  type ProviderLegalRule,
} from "./provider-legal-rules.js";

const PROVIDER_ID = /^[a-z0-9][a-z0-9_-]{0,31}$/u;
const FACT_ID = /^[a-z][a-z0-9_]{0,47}$/u;
const EXCERPT_MAX_LENGTH = 500;
const MAX_COMPARISONS = 100;

export type ProviderEvidenceSource = {
  sourceId: string;
  version: string;
  title: string;
  url: string;
  capturedAt: string;
  excerpt: string;
  documentKind: "privacy" | "cookies" | "terms" | "legal" | "service" | "technical-evidence" | "legal-authority";
  sourceKind: "audited_site" | "provider_official" | "auditor_observation" | "legal_authority";
};

export type ProviderStatement = {
  factId: string;
  value: boolean;
  basis: "explicit_claim" | "documented_omission";
  source: ProviderEvidenceSource;
};

export type ProviderFact = {
  factId: string;
  value: boolean;
  source: ProviderEvidenceSource;
};

export type ProviderLegalElementEvidence = {
  status: "satisfied" | "not_satisfied" | "unknown";
  evidence: readonly ProviderEvidenceSource[];
};

export type ProviderLegalEvidence = {
  dataOrigin: {
    value: ProviderLegalDataOrigin | "unknown";
    evidence: readonly ProviderEvidenceSource[];
  };
  elements: Readonly<Partial<Record<ProviderLegalElementId, ProviderLegalElementEvidence>>>;
};

/** Explicit audited-site legal context carried from the public-policy crawl. */
export type ProviderLegalEvidenceContext = {
  dataOrigin?: {
    value: ProviderLegalDataOrigin;
    evidence: ProviderEvidenceSource[];
  };
  auditedEntityIsController?: { evidence: ProviderEvidenceSource[] };
  aepdJurisdictionIsEstablished?: { evidence: ProviderEvidenceSource[] };
};

export function isProviderLegalEvidenceContext(value: unknown): value is ProviderLegalEvidenceContext {
  if (!isRecord(value) || Object.keys(value).length === 0 || Object.keys(value).some((key) =>
    !["dataOrigin", "auditedEntityIsController", "aepdJurisdictionIsEstablished"].includes(key))) return false;
  if (Object.hasOwn(value, "dataOrigin")) {
    const origin = value.dataOrigin;
    if (!isRecord(origin) || Object.keys(origin).length !== 2 ||
        !["value", "evidence"].every((key) => Object.hasOwn(origin, key)) ||
        !["obtained_from_subject", "not_obtained_from_subject"].includes(String(origin.value)) ||
        !isAuditedSiteSourceList(origin.evidence)) return false;
  }
  for (const key of ["auditedEntityIsController", "aepdJurisdictionIsEstablished"] as const) {
    if (!Object.hasOwn(value, key)) continue;
    const claim = value[key];
    if (!isRecord(claim) || Object.keys(claim).length !== 1 || !Object.hasOwn(claim, "evidence") ||
        !isAuditedSiteSourceList(claim.evidence)) return false;
  }
  return true;
}

function isAuditedSiteSourceList(value: unknown): value is ProviderEvidenceSource[] {
  return Array.isArray(value) && value.length > 0 && value.length <= 5 &&
    value.every((source) => isRecord(source) && isValidSource(source as unknown as ProviderEvidenceSource) &&
      source.sourceKind === "audited_site");
}

export type ProviderLegalFinding = {
  status: "infraccion_legal_acreditada";
  ruleId: string;
  catalogVersion: typeof PROVIDER_LEGAL_CATALOG_VERSION;
  instrument: ProviderLegalRule["instrument"];
  articles: readonly string[];
  classification: ProviderLegalRule["classification"];
  nationalClassification: ProviderLegalRule["nationalClassification"];
  authority: ProviderLegalRule["authority"];
  sanction: ProviderLegalRule["sanction"];
  officialSources: ProviderLegalRule["references"];
  supportingEvidence: Partial<Record<ProviderLegalElementId, string[]>>;
  supportingSources?: Partial<Record<ProviderLegalElementId, ProviderEvidenceSource[]>>;
};

export type ProviderDocumentationSourceReceipt = {
  documentId: string;
  title: string;
  url: string;
  status: "seeded" | "fetched" | "unavailable" | "failed" | "not_localized";
  sha256: string | null;
  checkedAt: string;
};

export type ProviderDocumentationContradiction = {
  providerId: string;
  status: "contradiction_confirmed" | "consistent" | "not_comparable" | "source_not_located" | "source_unavailable";
  reasonCode:
    | "opposing_explicit_statements"
    | "matching_explicit_statements"
    | "site_statement_missing"
    | "provider_fact_missing"
    | "official_source_not_located"
    | "official_source_unavailable";
  comparisons: Array<{
    factId: string;
    siteStatement: ProviderEvidenceSource;
    siteValue: boolean;
    providerFact: ProviderEvidenceSource;
    providerValue: boolean;
    relation: "opposes" | "supports";
    legalFinding?: ProviderLegalFinding;
    legalMappingStatus?: "not_available" | "elements_not_satisfied";
  }>;
  sourceEvidence?: ProviderDocumentationSourceReceipt[];
};

/** Validates contradiction data before it crosses a report or persistence boundary. */
export function parseProviderDocumentationContradiction(value: unknown): ProviderDocumentationContradiction | null {
  if (!isRecord(value) || !exactKeys(value, ["providerId", "status", "reasonCode", "comparisons"], ["sourceEvidence"]) ||
      typeof value.providerId !== "string" || !PROVIDER_ID.test(value.providerId) ||
      !["contradiction_confirmed", "consistent", "not_comparable", "source_not_located", "source_unavailable"].includes(String(value.status)) ||
      !["opposing_explicit_statements", "matching_explicit_statements", "site_statement_missing", "provider_fact_missing", "official_source_not_located", "official_source_unavailable"].includes(String(value.reasonCode)) ||
      !Array.isArray(value.comparisons) || value.comparisons.length > MAX_COMPARISONS) return null;
  const comparisons: ProviderDocumentationContradiction["comparisons"] = [];
  for (const entry of value.comparisons) {
    if (!isRecord(entry) || ["factId", "siteStatement", "siteValue", "providerFact", "providerValue", "relation"]
      .some((key) => !Object.hasOwn(entry, key)) ||
        Reflect.ownKeys(entry).some((key) => !["factId", "siteStatement", "siteValue", "providerFact", "providerValue", "relation", "legalFinding", "legalMappingStatus"].includes(String(key))) ||
        typeof entry.factId !== "string" || !FACT_ID.test(entry.factId) ||
        !isValidSource(entry.siteStatement as ProviderEvidenceSource) ||
        !isValidSource(entry.providerFact as ProviderEvidenceSource) ||
        typeof entry.siteValue !== "boolean" || typeof entry.providerValue !== "boolean" ||
        entry.relation !== (entry.siteValue === entry.providerValue ? "supports" : "opposes") ||
        entry.relation === "opposes" && !isIndependentEvidencePair(entry.siteStatement as ProviderEvidenceSource, entry.providerFact as ProviderEvidenceSource) ||
        entry.legalMappingStatus !== undefined && !["not_available", "elements_not_satisfied"].includes(String(entry.legalMappingStatus)) ||
        entry.legalFinding !== undefined && !isValidLegalFinding(entry.legalFinding)) return null;
    comparisons.push({
      factId: entry.factId,
      siteStatement: entry.siteStatement as ProviderEvidenceSource,
      siteValue: entry.siteValue,
      providerFact: entry.providerFact as ProviderEvidenceSource,
      providerValue: entry.providerValue,
      relation: entry.relation as "opposes" | "supports",
      ...(entry.legalFinding ? { legalFinding: entry.legalFinding as ProviderLegalFinding } : {}),
      ...(entry.legalMappingStatus ? { legalMappingStatus: entry.legalMappingStatus as "not_available" | "elements_not_satisfied" } : {}),
    });
  }
  const sourceEvidence = value.sourceEvidence === undefined ? undefined : parseSourceEvidence(value.sourceEvidence);
  if (value.sourceEvidence !== undefined && !sourceEvidence) return null;
  return {
    providerId: value.providerId,
    status: value.status as ProviderDocumentationContradiction["status"],
    reasonCode: value.reasonCode as ProviderDocumentationContradiction["reasonCode"],
    comparisons,
    ...(sourceEvidence ? { sourceEvidence } : {}),
  };
}

function parseSourceEvidence(value: unknown): ProviderDocumentationSourceReceipt[] | null {
  if (!Array.isArray(value) || value.length > 50) return null;
  const output: ProviderDocumentationSourceReceipt[] = [];
  const seen = new Set<string>();
  for (const entry of value) {
    if (!isRecord(entry) || !exactKeys(entry, ["documentId", "title", "url", "status", "sha256", "checkedAt"]) ||
        typeof entry.documentId !== "string" || !/^[a-z0-9][a-z0-9_-]{0,95}$/u.test(entry.documentId) || seen.has(entry.documentId) ||
        !bounded(entry.title, 1, 240) || !isValidHttpsUrl(entry.url) ||
        !["seeded", "fetched", "unavailable", "failed", "not_localized"].includes(String(entry.status)) ||
        !(entry.sha256 === null || typeof entry.sha256 === "string" && /^[a-f0-9]{64}$/u.test(entry.sha256)) ||
        !isIsoDateTime(String(entry.checkedAt))) return null;
    seen.add(entry.documentId);
    output.push(entry as ProviderDocumentationSourceReceipt);
  }
  return output;
}

/**
 * Compares explicit, source-backed statements. Legal findings are emitted only
 * when a versioned legal mapping confirms that all of its required elements
 * are satisfied by the supplied evidence.
 */
export function compareProviderDocumentation(input: {
  providerId: string;
  sourceStatus: "located" | "not_located" | "unavailable";
  siteStatements: readonly ProviderStatement[];
  providerFacts: readonly ProviderFact[];
  legalEvidence?: ProviderLegalEvidence;
  legalRules?: readonly unknown[];
}): ProviderDocumentationContradiction | null {
  if (!PROVIDER_ID.test(input.providerId) || input.siteStatements.length > MAX_COMPARISONS ||
      input.providerFacts.length > MAX_COMPARISONS) return null;

  if (input.sourceStatus === "not_located") return {
    providerId: input.providerId,
    status: "source_not_located",
    reasonCode: "official_source_not_located",
    comparisons: [],
  };
  if (input.sourceStatus === "unavailable") return {
    providerId: input.providerId,
    status: "source_unavailable",
    reasonCode: "official_source_unavailable",
    comparisons: [],
  };

  const siteByFact = new Map<string, ProviderStatement>();
  for (const statement of input.siteStatements) {
    if (!isValidStatement(statement)) return null;
    if (siteByFact.has(statement.factId)) return null;
    siteByFact.set(statement.factId, statement);
  }
  const providerByFact = new Map<string, ProviderFact>();
  for (const fact of input.providerFacts) {
    if (!isValidStatement(fact)) return null;
    if (providerByFact.has(fact.factId)) return null;
    providerByFact.set(fact.factId, fact);
  }
  const comparisons: ProviderDocumentationContradiction["comparisons"] = [];
  let unmatched = false;
  for (const [factId, site] of siteByFact) {
    const provider = providerByFact.get(factId);
    if (!provider) {
      unmatched = true;
      continue;
    }
    const relation = site.value === provider.value ? "supports" : "opposes";
    if (relation === "opposes" && !isIndependentEvidencePair(site.source, provider.source)) return null;
    const legalFinding = relation === "opposes"
      ? resolveProviderLegalFinding(factId, site, provider, input.legalEvidence, input.legalRules)
      : { finding: undefined, status: undefined };
    comparisons.push({
      factId,
      siteStatement: site.source,
      siteValue: site.value,
      providerFact: provider.source,
      providerValue: provider.value,
      relation,
      ...(legalFinding.finding ? { legalFinding: legalFinding.finding } : {}),
      ...(legalFinding.status ? { legalMappingStatus: legalFinding.status } : {}),
    });
  }
  comparisons.sort((left, right) => left.factId.localeCompare(right.factId, "en"));
  const hasContradiction = comparisons.some(({ relation }) => relation === "opposes");
  if (hasContradiction) return {
    providerId: input.providerId,
    status: "contradiction_confirmed",
    reasonCode: "opposing_explicit_statements",
    comparisons,
  };
  if (unmatched || comparisons.length === 0) return {
    providerId: input.providerId,
    status: "not_comparable",
    reasonCode: siteByFact.size === 0 ? "site_statement_missing" : "provider_fact_missing",
    comparisons,
  };
  return {
    providerId: input.providerId,
    status: "consistent",
    reasonCode: "matching_explicit_statements",
    comparisons,
  };
}

function isValidStatement(statement: ProviderStatement | ProviderFact): boolean {
  return typeof statement === "object" && statement !== null && FACT_ID.test(statement.factId) &&
    typeof statement.value === "boolean" && isValidSource(statement.source) &&
    ("basis" in statement ? ["explicit_claim", "documented_omission"].includes(statement.basis) : true);
}

export function isProviderStatement(value: unknown): value is ProviderStatement {
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype ||
      Reflect.ownKeys(value).length !== 4) return false;
  const candidate = value as Record<string, unknown>;
  return Object.hasOwn(candidate, "factId") && Object.hasOwn(candidate, "value") &&
    Object.hasOwn(candidate, "basis") && Object.hasOwn(candidate, "source") &&
    (candidate.basis === "explicit_claim" || candidate.basis === "documented_omission") &&
    isValidStatement(candidate as unknown as ProviderStatement) &&
    (candidate.source as ProviderEvidenceSource).sourceKind === "audited_site";
}

function isValidSource(source: ProviderEvidenceSource): boolean {
  if (!source || typeof source !== "object" || !bounded(source.sourceId, 1, 96) ||
      Reflect.ownKeys(source).length !== 8 ||
      !["sourceId", "version", "title", "url", "capturedAt", "excerpt", "documentKind", "sourceKind"]
        .every((key) => Object.hasOwn(source, key)) ||
      !bounded(source.version, 1, 64) || !bounded(source.title, 1, 200) ||
      !bounded(source.excerpt, 1, EXCERPT_MAX_LENGTH) || containsSensitiveValue(source.excerpt) ||
      !isIsoDateTime(source.capturedAt) ||
      !["privacy", "cookies", "terms", "legal", "service", "technical-evidence", "legal-authority"].includes(source.documentKind) ||
      !["audited_site", "provider_official", "auditor_observation", "legal_authority"].includes(source.sourceKind)) return false;
  try {
    const url = new URL(source.url);
    return url.protocol === "https:" && !url.username && !url.password &&
      url.port === "" && url.hostname.length <= 253;
  } catch {
    return false;
  }
}

function isValidLegalFinding(value: unknown): value is ProviderLegalFinding {
  if (!isRecord(value) || value.status !== "infraccion_legal_acreditada" ||
      typeof value.ruleId !== "string" || !/^gdpr-recipient-disclosure-article-(13|14)-v1$/u.test(value.ruleId) ||
      value.catalogVersion !== PROVIDER_LEGAL_CATALOG_VERSION || typeof value.instrument !== "string" ||
      !Array.isArray(value.articles) || value.articles.length < 2 || value.articles.length > 5 ||
      !value.articles.every((item) => typeof item === "string" && item.length <= 32) ||
      !isRecord(value.sanction) || !isRecord(value.nationalClassification) ||
      !isValidOfficialLegalSources(value.officialSources) ||
      !isRecord(value.supportingEvidence)) return false;
  const article = value.ruleId.endsWith("article-13-v1") ? "13" : "14";
  const rule = getProviderLegalRule(PROVIDER_RECEIVES_PERSONAL_DATA_FACT,
    article === "13" ? "obtained_from_subject" : "not_obtained_from_subject");
  if (!rule || value.instrument !== rule.instrument || value.classification !== rule.classification ||
      !deepEqual(value.articles, rule.articles) || !deepEqual(value.nationalClassification, rule.nationalClassification) ||
      !isValidSanctionScale(value.sanction) ||
      value.authority !== rule.authority) return false;
  const evidence = value.supportingEvidence;
  const supportingEvidenceValid = Object.keys(evidence).length === PROVIDER_RECIPIENT_DISCLOSURE_ELEMENT_IDS.length &&
    PROVIDER_RECIPIENT_DISCLOSURE_ELEMENT_IDS.every((key) => Object.hasOwn(evidence, key)) &&
    Object.keys(evidence).every((key) => PROVIDER_RECIPIENT_DISCLOSURE_ELEMENT_IDS.includes(key as ProviderLegalElementId)) &&
    Object.values(evidence).every((sources) => Array.isArray(sources) && sources.length > 0 && sources.length <= 10 &&
      sources.every((sourceId) => typeof sourceId === "string" && sourceId.length <= 96));
  if (!supportingEvidenceValid) return false;
  if (value.supportingSources === undefined) return true;
  const supportingSources = value.supportingSources;
  if (!isRecord(supportingSources) ||
      Object.keys(supportingSources).length !== PROVIDER_RECIPIENT_DISCLOSURE_ELEMENT_IDS.length ||
      !PROVIDER_RECIPIENT_DISCLOSURE_ELEMENT_IDS.every((key) => Object.hasOwn(supportingSources, key))) return false;
  return PROVIDER_RECIPIENT_DISCLOSURE_ELEMENT_IDS.every((key) => {
    const sources = supportingSources[key];
    const sourceIds = evidence[key];
    return Array.isArray(sources) && sources.length > 0 && sources.length <= 10 &&
      sources.every(isValidSource) &&
      deepEqual(sources.map(({ sourceId }) => sourceId), sourceIds);
  });
}

function isIndependentEvidencePair(site: ProviderEvidenceSource, provider: ProviderEvidenceSource): boolean {
  if (site.sourceKind !== "audited_site" || provider.sourceKind !== "provider_official" ||
      site.sourceId === provider.sourceId || site.url === provider.url) return false;
  try {
    return new URL(site.url).hostname !== new URL(provider.url).hostname;
  } catch {
    return false;
  }
}

function isValidSanctionScale(value: unknown): boolean {
  if (!isRecord(value) || value.type !== "greater_of" || value.legalBasis !== "GDPR Article 83(5)(b)" ||
      value.isSpecificFinePrediction !== false || !Array.isArray(value.alternatives) || value.alternatives.length !== 2) return false;
  const fixed = value.alternatives[0];
  const turnover = value.alternatives[1];
  return isRecord(fixed) && fixed.type === "fixed_amount" && fixed.currency === "EUR" &&
    Number.isSafeInteger(fixed.amount) && Number(fixed.amount) >= 1_000 && Number(fixed.amount) <= 100_000_000 &&
    isRecord(turnover) && turnover.type === "global_annual_turnover_percentage" &&
    Number.isFinite(turnover.percentage) && Number(turnover.percentage) > 0 && Number(turnover.percentage) <= 100;
}

function isValidOfficialLegalSources(value: unknown): value is ProviderLegalRule["references"] {
  if (!Array.isArray(value) || value.length !== 3) return false;
  const requiredIds = new Set(["gdpr-official-text", "lopdgdd-official-text", "aepd-pa-00027-2024"]);
  const found = new Set<string>();
  for (const source of value) {
    if (!isRecord(source) || !exactKeys(source, ["sourceId", "issuer", "title", "url", "version", "checkedAt"]) ||
        typeof source.sourceId !== "string" || !requiredIds.has(source.sourceId) || found.has(source.sourceId) ||
        !["BOE", "AEPD"].includes(String(source.issuer)) || !bounded(source.title, 1, 200) ||
        !bounded(source.version, 1, 240) || !isIsoDateTime(String(source.checkedAt)) || !isValidHttpsUrl(source.url)) return false;
    found.add(source.sourceId);
  }
  return found.size === requiredIds.size;
}

function isValidHttpsUrl(value: unknown): value is string {
  if (typeof value !== "string" || value.length > 2048) return false;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password && !url.port;
  } catch {
    return false;
  }
}

function deepEqual(left: unknown, right: unknown): boolean {
  return JSON.stringify(sortForComparison(left)) === JSON.stringify(sortForComparison(right));
}

function sortForComparison(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortForComparison);
  if (isRecord(value)) return Object.fromEntries(Object.keys(value).sort((left, right) => left.localeCompare(right, "en")).map((key) => [key, sortForComparison(value[key])]));
  return value;
}

function resolveProviderLegalFinding(
  factId: string,
  site: ProviderStatement,
  provider: ProviderFact,
  legalEvidence: ProviderLegalEvidence | undefined,
  legalRules: readonly unknown[] | undefined,
): { finding?: ProviderLegalFinding; status?: "not_available" | "elements_not_satisfied" } {
  if (factId !== PROVIDER_RECEIVES_PERSONAL_DATA_FACT) return { status: "not_available" };
  if (!isValidLegalEvidence(legalEvidence) || legalEvidence.dataOrigin.value === "unknown" ||
      !validateLegalEvidence(legalEvidence, site, provider)) return { status: "elements_not_satisfied" };
  const baseRule = getProviderLegalRule(factId, legalEvidence.dataOrigin.value);
  const rule = baseRule ? useDynamicSanction(baseRule, legalRules) : null;
  if (!rule) return { status: "not_available" };
  return { finding: toLegalFinding(rule, legalEvidence) };
}

function useDynamicSanction(rule: ProviderLegalRule, legalRules: readonly unknown[] | undefined): ProviderLegalRule | null {
  if (!legalRules) return rule;
  const candidate = legalRules.find((item) => isRecord(item) && item.ruleId === rule.ruleId);
  if (!candidate || !isRecord(candidate) || !isValidSanctionScale(candidate.sanction) ||
      !isValidOfficialLegalSources(candidate.references)) return null;
  return {
    ...rule,
    sanction: candidate.sanction as ProviderLegalRule["sanction"],
    references: candidate.references,
  };
}

function validateLegalEvidence(
  evidence: ProviderLegalEvidence,
  site: ProviderStatement,
  provider: ProviderFact,
): boolean {
  if (site.value !== false || !["explicit_claim", "documented_omission"].includes(site.basis) ||
      !Array.isArray(evidence.dataOrigin.evidence) || evidence.dataOrigin.evidence.length === 0 ||
      !evidence.dataOrigin.evidence.every(isValidSource)) return false;
  const originEvidence = evidence.elements.data_origin_is_established;
  if (!elementIsSatisfied(originEvidence) ||
      !originEvidence.evidence.some((source) => evidence.dataOrigin.evidence.some(({ sourceId }) => sourceId === source.sourceId)) ||
      !evidence.dataOrigin.evidence.every(({ sourceKind }) => sourceKind === "audited_site" || sourceKind === "auditor_observation")) return false;
  const siteEvidence = evidence.elements.site_denies_or_omits_recipient;
  if (!elementIsSatisfied(siteEvidence) || !siteEvidence.evidence.some(({ sourceId, sourceKind }) =>
    sourceId === site.source.sourceId && sourceKind === "audited_site")) return false;
  const providerEvidence = evidence.elements.provider_receives_matching_data;
  if (!elementIsSatisfied(providerEvidence) || !providerEvidence.evidence.some(({ sourceId, sourceKind }) =>
    sourceId === provider.source.sourceId && sourceKind === "provider_official")) return false;
  for (const requiredElement of [
    "personal_data_in_flow",
    "audited_entity_is_controller",
    "aepd_jurisdiction_is_established",
  ] as const) {
    const item = evidence.elements[requiredElement];
    if (!elementIsSatisfied(item)) return false;
    if (requiredElement === "personal_data_in_flow" && !item.evidence.some(({ sourceKind }) =>
      sourceKind === "audited_site" || sourceKind === "auditor_observation")) return false;
    if (requiredElement === "audited_entity_is_controller" && !item.evidence.some(({ sourceKind }) =>
      sourceKind === "audited_site")) return false;
    if (requiredElement === "aepd_jurisdiction_is_established" && !item.evidence.some(({ sourceKind }) =>
      sourceKind === "audited_site" || sourceKind === "auditor_observation")) return false;
  }
  return site.source.sourceKind === "audited_site" && provider.source.sourceKind === "provider_official" &&
    site.source.sourceId !== provider.source.sourceId && site.source.url !== provider.source.url;
}

function elementIsSatisfied(item: ProviderLegalElementEvidence | undefined): item is ProviderLegalElementEvidence {
  return item?.status === "satisfied" && item.evidence.length > 0 && item.evidence.every(isValidSource);
}

function toLegalFinding(rule: ProviderLegalRule, evidence: ProviderLegalEvidence): ProviderLegalFinding {
  const supportingEvidence: Partial<Record<ProviderLegalElementId, string[]>> = {};
  const supportingSources: Partial<Record<ProviderLegalElementId, ProviderEvidenceSource[]>> = {};
  for (const [elementId, item] of Object.entries(evidence.elements)) {
    if (elementIsSatisfied(item)) {
      supportingEvidence[elementId as ProviderLegalElementId] = item.evidence.map(({ sourceId }) => sourceId);
      supportingSources[elementId as ProviderLegalElementId] = [...item.evidence];
    }
  }
  return {
    status: "infraccion_legal_acreditada",
    ruleId: rule.ruleId,
    catalogVersion: rule.catalogVersion,
    instrument: rule.instrument,
    articles: rule.articles,
    classification: rule.classification,
    nationalClassification: rule.nationalClassification,
    authority: rule.authority,
    sanction: rule.sanction,
    officialSources: rule.references,
    supportingEvidence,
    supportingSources,
  };
}

function isValidLegalEvidence(value: ProviderLegalEvidence | undefined): value is ProviderLegalEvidence {
  if (!value || typeof value !== "object" || !value.dataOrigin || typeof value.dataOrigin !== "object" ||
      !["obtained_from_subject", "not_obtained_from_subject", "unknown"].includes(value.dataOrigin.value) ||
      !Array.isArray(value.dataOrigin.evidence) || !value.dataOrigin.evidence.every(isValidSource) ||
      !value.elements || typeof value.elements !== "object" || Array.isArray(value.elements)) return false;
  for (const item of Object.values(value.elements)) {
    if (!item || typeof item !== "object" ||
        !["satisfied", "not_satisfied", "unknown"].includes(item.status) ||
        !Array.isArray(item.evidence) || !item.evidence.every(isValidSource)) return false;
  }
  if (Object.keys(value.elements).some((key) => ![
    "site_denies_or_omits_recipient",
    "provider_receives_matching_data",
    "personal_data_in_flow",
    "audited_entity_is_controller",
    "data_origin_is_established",
    "aepd_jurisdiction_is_established",
  ].includes(key))) return false;
  return true;
}

function containsSensitiveValue(value: string): boolean {
  return /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b|\b(?:sk|key|token)[-_][A-Z0-9_-]{12,}\b/iu.test(value);
}

function bounded(value: unknown, minimum: number, maximum: number): value is string {
  return typeof value === "string" && value.trim().length >= minimum && value.length <= maximum;
}

function exactKeys(value: Record<string, unknown>, keys: readonly string[], optional: readonly string[] = []): boolean {
  const allowed = [...keys, ...optional];
  return keys.every((key) => Object.hasOwn(value, key)) &&
    Reflect.ownKeys(value).every((key) => typeof key === "string" && allowed.includes(key));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype;
}

function isIsoDateTime(value: string): boolean {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/u.test(value) && Number.isFinite(Date.parse(value));
}
