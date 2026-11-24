export type LegalCookieEvidence = {
  flow: "initial" | "reject";
  phase: "before_choice" | "after_choice" | "after_reload";
  capturedAtMs: number;
  cookieName: string;
  cookieDomain: string;
  provider: string;
  purpose: string;
  attributionRuleId: string;
  correlatedRequestHosts: string[];
};

export type LegalCookieFinding = {
  ruleId: "lssi-cookie-no-prior-consent-v1" | "lssi-cookie-after-rejection-v1";
  ruleVersion: "1.0.0";
  status: "accredited";
  title: string;
  description: string;
  jurisdiction: "ES";
  articles: Array<{ law: "LSSI"; article: "22.2" | "38.4.g" | "39.1.c" | "43.1"; url: string }>;
  infringementClass: "minor";
  sanction: { type: "statutory_maximum"; currency: "EUR"; maximum: 30000 };
  authority: "Agencia Española de Protección de Datos";
  evidence: LegalCookieEvidence[];
  evidenceComplete: true;
};

export function parseLegalCookieFindings(value: unknown): LegalCookieFinding[] | null {
  if (!Array.isArray(value) || value.length > 2) return null;
  const findings: LegalCookieFinding[] = [];
  const seenRules = new Set<string>();
  for (const item of value) {
    if (!isRecord(item) || !Array.isArray(item.evidence) || item.evidence.length < 1 || item.evidence.length > 50 ||
        (item.ruleId !== "lssi-cookie-no-prior-consent-v1" && item.ruleId !== "lssi-cookie-after-rejection-v1") ||
        item.ruleVersion !== "1.0.0" || item.status !== "accredited" || item.jurisdiction !== "ES" ||
        item.infringementClass !== "minor" || item.authority !== "Agencia Española de Protección de Datos" ||
        item.evidenceComplete !== true || !isSafeToken(item.title, 180) || !isSafeToken(item.description, 300) ||
        seenRules.has(item.ruleId) || !isRecord(item.sanction) || item.sanction.type !== "statutory_maximum" ||
        item.sanction.currency !== "EUR" || item.sanction.maximum !== 30000 || !Array.isArray(item.articles) ||
        item.articles.length !== 4 || !item.articles.every(isArticle)) return null;
    const evidence = item.evidence.map(parseEvidence);
    if (evidence.some((entry) => entry === null)) return null;
    findings.push(item as LegalCookieFinding);
    seenRules.add(item.ruleId);
  }
  return findings;
}

function isArticle(value: unknown): boolean {
  return isRecord(value) && value.law === "LSSI" &&
    ["22.2", "38.4.g", "39.1.c", "43.1"].includes(String(value.article)) &&
    value.url === "https://www.boe.es/buscar/act.php?id=BOE-A-2002-13758";
}

function parseEvidence(value: unknown): LegalCookieEvidence | null {
  if (!isRecord(value) || (value.flow !== "initial" && value.flow !== "reject") ||
      (value.phase !== "before_choice" && value.phase !== "after_choice" && value.phase !== "after_reload") ||
      typeof value.capturedAtMs !== "number" || !Number.isSafeInteger(value.capturedAtMs) || value.capturedAtMs < 0 ||
      !isSafeToken(value.cookieName, 128) || !isSafeToken(value.cookieDomain, 253) ||
      !isSafeToken(value.provider, 100) || !isSafeToken(value.purpose, 250) ||
      !isSafeToken(value.attributionRuleId, 100) || !Array.isArray(value.correlatedRequestHosts) ||
      value.correlatedRequestHosts.length > 20 || !value.correlatedRequestHosts.every((host) => isSafeToken(host, 253))) return null;
  return value as LegalCookieEvidence;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isSafeToken(value: unknown, maxLength: number): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= maxLength &&
    !/[\u0000-\u001f\u007f]/u.test(value);
}
