import { parse } from "parse5";
import type { DefaultTreeAdapterMap } from "parse5";
import { PRIVACY_KNOWLEDGE_RULES } from "./privacy-knowledge-catalog.js";
import type { PrivacyKnowledgeRule } from "./privacy-knowledge-base.js";
import type { PublicPolicyClassification } from "./public-policy-crawler.js";

const MAX_POLICY_TEXT_BYTES = 64 * 1024;
const MAX_BLOCKS = 2_000;
const MAX_BLOCK_LENGTH = 4_096;
const PROVIDER_IDENTIFIER = /^[a-z0-9][a-z0-9_-]{0,31}$/u;
const PURPOSE_TERMS = [
  { id: "analytics", category: "analytics", terms: ["analytics", "analitica", "estadisticas", "medicion de audiencia", "medicion del uso", "analisis de uso"] },
  { id: "advertising", category: "advertising", terms: ["publicidad", "advertising", "anuncios", "marketing", "publicidad personalizada", "publicidad dirigida"] },
  { id: "social", category: "social", terms: ["redes sociales", "social media", "contenido social", "botones sociales"] },
  { id: "consent", category: "consent", terms: ["consentimiento", "consent management", "preferencias de cookies", "gestion de consentimiento"] },
  { id: "payments", category: "other", terms: ["pagos", "payment processing", "procesamiento de pagos", "facturacion"] },
  { id: "hosting", category: "other", terms: ["hosting", "alojamiento", "infraestructura en la nube", "cloud hosting"] },
  { id: "support", category: "other", terms: ["soporte tecnico", "atencion al cliente", "customer support"] },
  { id: "security", category: "other", terms: ["seguridad", "prevencion del fraude", "fraud prevention"] },
] as const;
const ACCESS_DENIED_PHRASES = [
  "access denied",
  "acceso denegado",
  "verify you are human",
  "verifica que eres una persona",
  "checking your browser",
  "comprueba tu navegador",
  "complete the security check",
  "completa la comprobacion de seguridad",
] as const;

type ProviderEntry = {
  id: string;
  aliases: readonly string[];
  source: PrivacyKnowledgeRule["source"];
};

const PROVIDERS = buildProviderCatalog();

/**
 * Classifies only literal provider and purpose names found in one visible text
 * block. It does not infer that a named provider performs a purpose the policy
 * does not state.
 */
export function classifyPublicPolicyHtml(html: string): PublicPolicyClassification {
  if (Buffer.byteLength(html, "utf8") > MAX_POLICY_TEXT_BYTES) {
    throw new Error("public_policy_text_limit_exceeded");
  }
  const blocks = extractVisibleTextBlocks(html);
  const providers = new Set<string>();
  const providersWithPurpose = new Set<string>();
  const purposes = new Set<string>();
  const categories = new Set<string>();
  const declaredServices = new Map<string, Set<string>>();
  let accessDenied = false;

  for (const block of blocks) {
    if (ACCESS_DENIED_PHRASES.some((phrase) => block.includes(normalizeText(phrase)))) {
      accessDenied = true;
    }
    const providerFreeText = PROVIDERS.reduce((text, provider) =>
      provider.aliases.reduce((value, alias) => value.split(alias).join(" "), text), block);
    const blockPurposes = PURPOSE_TERMS.filter(({ terms }) =>
      terms.some((term) => includesPhrase(providerFreeText, term)),
    );
    for (const purpose of blockPurposes) {
      purposes.add(purpose.id);
      categories.add(purpose.category);
    }
    for (const provider of PROVIDERS) {
      if (!provider.aliases.some((alias) => includesPhrase(block, alias))) continue;
      if (!PROVIDER_IDENTIFIER.test(provider.id)) continue;
      providers.add(provider.id);
      if (blockPurposes.length > 0) {
        providersWithPurpose.add(provider.id);
        const purposes = declaredServices.get(provider.id) ?? new Set<string>();
        for (const purpose of blockPurposes) purposes.add(purpose.id);
        declaredServices.set(provider.id, purposes);
      }
    }
  }

  return {
    providerIds: [...providers].sort(compareIdentifiers).slice(0, 30),
    providersWithPurpose: [...providersWithPurpose].sort(compareIdentifiers).slice(0, 30),
    purposeIds: [...purposes].sort(compareIdentifiers).slice(0, 30),
    categories: [...categories].sort(compareIdentifiers).slice(0, 5),
    declaredServices: [...declaredServices.entries()].map(([providerId, purposeIds]) => ({
      providerId,
      purposeIds: [...purposeIds].sort(compareIdentifiers),
    })).sort((left, right) => compareIdentifiers(left.providerId, right.providerId)).slice(0, 30),
    ...(accessDenied ? { accessDenied: true } : {}),
  };
}

export function getPublicPolicyProviderSources(): readonly {
  providerId: string;
  sourceUrl: string;
  reviewedAt: string;
  license: string;
}[] {
  return PROVIDERS.map((provider) => ({
    providerId: provider.id,
    sourceUrl: provider.source.url,
    reviewedAt: provider.source.reviewedAt,
    license: provider.source.license,
  }));
}

function buildProviderCatalog(): ProviderEntry[] {
  const byId = new Map<string, ProviderEntry>();
  for (const rule of PRIVACY_KNOWLEDGE_RULES) {
    if (rule.confidence !== "high" || !rule.provider.trim()) continue;
    const label = rule.provider.trim();
    const id = toProviderId(label);
    if (!PROVIDER_IDENTIFIER.test(id)) continue;
    const aliases = new Set<string>([normalizeText(label)]);
    for (const segment of label.split(/[/|(),;]/u)) {
      const alias = normalizeText(segment);
      if (alias.length >= 4) aliases.add(alias);
    }
    const existing = byId.get(id);
    if (!existing) {
      byId.set(id, { id, aliases: [...aliases], source: rule.source });
    } else {
      byId.set(id, {
        ...existing,
        aliases: [...new Set([...existing.aliases, ...aliases])],
      });
    }
  }
  return [...byId.values()].sort((left, right) => right.id.length - left.id.length);
}

function extractVisibleTextBlocks(html: string): string[] {
  const root = parse(html);
  const result: string[] = [];
  const pending: DefaultTreeAdapterMap["node"][] = [root];
  let visited = 0;
  while (pending.length > 0 && result.length < MAX_BLOCKS) {
    const node = pending.pop();
    if (!node) continue;
    visited += 1;
    if (visited > 50_000) throw new Error("public_policy_document_complexity_limit");
    if (isElement(node) && ["script", "style", "noscript", "template"].includes(node.tagName)) continue;
    if (isElement(node) && ["p", "li", "dd", "dt", "td", "th", "blockquote", "h1", "h2", "h3", "h4", "h5", "h6"].includes(node.tagName)) {
      const text = normalizeText(collectText(node));
      if (text) result.push(text.slice(0, MAX_BLOCK_LENGTH));
      continue;
    }
    if ("childNodes" in node) {
      for (let index = node.childNodes.length - 1; index >= 0; index -= 1) {
        const child = node.childNodes[index];
        if (child) pending.push(child);
      }
    }
  }
  return result;
}

function collectText(node: DefaultTreeAdapterMap["node"]): string {
  const pending: DefaultTreeAdapterMap["node"][] = [node];
  let text = "";
  while (pending.length > 0 && text.length < MAX_BLOCK_LENGTH) {
    const current = pending.pop();
    if (!current) continue;
    if (current.nodeName === "#text" && "value" in current) {
      text += ` ${current.value}`;
    } else if (isElement(current) && ["script", "style", "noscript", "template"].includes(current.tagName)) {
      continue;
    } else if ("childNodes" in current) {
      for (let index = current.childNodes.length - 1; index >= 0; index -= 1) {
        const child = current.childNodes[index];
        if (child) pending.push(child);
      }
    }
  }
  return text.slice(0, MAX_BLOCK_LENGTH);
}

function normalizeText(value: string): string {
  return value.normalize("NFKD").replace(/[\u0300-\u036f]/gu, "").toLowerCase().replace(/[^a-z0-9]+/gu, " ").trim();
}

function toProviderId(label: string): string {
  let id = "";
  let needsSeparator = false;
  for (const character of normalizeText(label)) {
    const isAlphaNumeric = character >= "a" && character <= "z" || character >= "0" && character <= "9";
    if (isAlphaNumeric) {
      if (needsSeparator && id.length > 0 && id.length < 32) id += "-";
      if (id.length < 32) id += character;
      needsSeparator = false;
    } else if (id.length > 0 && id.length < 32) {
      needsSeparator = true;
    }
  }
  return id;
}

function compareIdentifiers(left: string, right: string): number {
  return left.localeCompare(right, "en");
}

function includesPhrase(text: string, phraseInput: string): boolean {
  const phrase = normalizeText(phraseInput);
  if (!phrase) return false;
  return ` ${text} `.includes(` ${phrase} `);
}

function isElement(node: DefaultTreeAdapterMap["node"]): node is DefaultTreeAdapterMap["element"] {
  return "tagName" in node && Array.isArray(node.attrs);
}
