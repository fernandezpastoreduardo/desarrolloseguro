import { parse } from "parse5";
import type { DefaultTreeAdapterMap } from "parse5";
import { PUBLIC_SERVICE_PROVIDER_INFO } from "@desarrolloseguro/core";
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
  { id: "ai_processing", category: "other", terms: ["inteligencia artificial", "funcion de ia", "representacion semantica", "moderacion de avatares", "generar una respuesta"] },
  { id: "email_delivery", category: "other", terms: ["smtp", "correo electronico", "envio de correos"] },
  { id: "infrastructure", category: "other", terms: ["vps", "servidor virtual", "base de datos", "alojamiento", "infraestructura"] },
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
  const siteStatements: NonNullable<PublicPolicyClassification["siteStatements"]>[number][] = [];
  let accessDenied = false;

  for (const { text: block, excerpt } of blocks) {
    if (ACCESS_DENIED_PHRASES.some((phrase) => block.includes(normalizeText(phrase)))) {
      accessDenied = true;
    }
    for (const sentence of splitStatements(excerpt)) {
      const normalizedSentence = normalizeText(sentence);
      const sentenceProviders = PROVIDERS.filter((provider) =>
        PROVIDER_IDENTIFIER.test(provider.id) && provider.aliases.some((alias) => includesPhrase(normalizedSentence, alias)),
      );
      const sentenceProviderIds = sentenceProviders.map(({ id }) => id);
      for (const providerId of sentenceProviderIds) providers.add(providerId);
      const providerFreeSentence = sentenceProviders.reduce((text, provider) =>
        provider.aliases.reduce((value, alias) => value.split(alias).join(" "), text), normalizedSentence);
      const sentencePurposes = PURPOSE_TERMS.filter(({ terms }) =>
        terms.some((term) => includesPhrase(providerFreeSentence, term)),
      );
      for (const purpose of sentencePurposes) {
        purposes.add(purpose.id);
        categories.add(purpose.category);
      }
      // The crawler has no dependency parser. When a sentence names multiple
      // providers, purpose attribution is ambiguous, so retain the mentions
      // without assigning the purpose to each provider.
      if (sentenceProviders.length === 1) {
        const [provider] = sentenceProviders;
        if (!provider) continue;
        const providerAliases = provider.aliases.filter((alias) => includesPhrase(normalizedSentence, alias));
        if (sentencePurposes.length > 0) {
          providersWithPurpose.add(provider.id);
          const providerPurposes = declaredServices.get(provider.id) ?? new Set<string>();
          for (const purpose of sentencePurposes) providerPurposes.add(purpose.id);
          declaredServices.set(provider.id, providerPurposes);
          siteStatements.push({
            providerId: provider.id,
            factId: "provider_performs_purpose",
            value: true,
            basis: "explicit_claim",
            excerpt: sentence.slice(0, MAX_BLOCK_LENGTH),
          });
        }
        const personalDataValue = classifyExplicitReceipt(normalizedSentence, providerAliases, true);
        if (personalDataValue !== null) {
          siteStatements.push({
            providerId: provider.id,
            factId: "provider_receives_personal_data",
            value: personalDataValue,
            basis: "explicit_claim",
            excerpt: sentence.slice(0, 500),
          });
          continue;
        }
        const contentValue = classifyExplicitReceipt(normalizedSentence, providerAliases, false);
        if (contentValue !== null) siteStatements.push({
          providerId: provider.id,
          factId: "provider_receives_content",
          value: contentValue,
          basis: "explicit_claim",
          excerpt: sentence.slice(0, 500),
        });
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
    siteStatements: deduplicateStatements(siteStatements).slice(0, 30),
    documentTitle: extractDocumentTitle(html),
    ...(accessDenied ? { accessDenied: true } : {}),
  };
}

export function getPublicPolicyProviderSources(): readonly {
  providerId: string;
  documentId: string;
  kind: string;
  title: string;
  sourceUrl: string;
  reviewedAt: string;
  license: string;
}[] {
  return PROVIDERS.flatMap((provider) => {
    const documents = PUBLIC_SERVICE_PROVIDER_INFO[provider.id]?.officialDocuments;
    if (!documents || documents.length === 0) return [{
      providerId: provider.id,
      documentId: `${provider.id}-service-source`,
      kind: "service-documentation",
      title: "Descripción del servicio",
      sourceUrl: provider.source.url,
      reviewedAt: provider.source.reviewedAt,
      license: provider.source.license,
    }];
    return documents.map((document) => ({
      providerId: provider.id,
      documentId: document.documentId,
      kind: document.kind,
      title: document.title,
      sourceUrl: document.url,
      reviewedAt: document.reviewedAt,
      license: "Official provider source; factual metadata only; no source text copied",
    }));
  });
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
  for (const [id, provider] of Object.entries(PUBLIC_SERVICE_PROVIDER_INFO)) {
    if (byId.has(id)) continue;
    const normalizedName = normalizeText(provider.displayName);
    const aliases = new Set([normalizedName, normalizeText(id)]);
    if (id === "openai-api") aliases.add("openai");
    const source: PrivacyKnowledgeRule["source"] = {
      url: provider.serviceSourceUrl,
      revision: `reviewed-${provider.reviewedAt}`,
      license: "Official provider documentation; factual metadata only",
      reviewedAt: provider.reviewedAt,
    };
    byId.set(id, { id, aliases: [...aliases], source });
  }
  return [...byId.values()].sort((left, right) => right.id.length - left.id.length);
}

type VisibleTextBlock = { text: string; excerpt: string };

function extractVisibleTextBlocks(html: string): VisibleTextBlock[] {
  const root = parse(html);
  const result: VisibleTextBlock[] = [];
  const pending: DefaultTreeAdapterMap["node"][] = [root];
  let visited = 0;
  while (pending.length > 0 && result.length < MAX_BLOCKS) {
    const node = pending.pop();
    if (!node) continue;
    visited += 1;
    if (visited > 50_000) throw new Error("public_policy_document_complexity_limit");
    if (isElement(node) && ["script", "style", "noscript", "template"].includes(node.tagName)) continue;
    if (isElement(node) && ["p", "li", "dd", "dt", "td", "th", "blockquote", "h1", "h2", "h3", "h4", "h5", "h6"].includes(node.tagName)) {
      const excerpt = collectText(node).replace(/\s+/gu, " ").trim().slice(0, MAX_BLOCK_LENGTH);
      const text = normalizeText(excerpt);
      if (text) result.push({ text, excerpt });
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

function extractDocumentTitle(html: string): string | undefined {
  const root = parse(html);
  const pending: DefaultTreeAdapterMap["node"][] = [root];
  let visited = 0;
  while (pending.length > 0 && visited < 50_000) {
    const node = pending.pop();
    if (!node) continue;
    visited += 1;
    if (isElement(node) && node.tagName === "title") {
      const title = collectText(node).replace(/\s+/gu, " ").trim().slice(0, 200);
      return title || undefined;
    }
    if ("childNodes" in node) {
      for (let index = node.childNodes.length - 1; index >= 0; index -= 1) {
        const child = node.childNodes[index];
        if (child) pending.push(child);
      }
    }
  }
  return undefined;
}

function splitStatements(value: string): string[] {
  return value.split(/(?<=[.!?;])\s+/u).map((sentence) => sentence.trim()).filter(Boolean).slice(0, 30);
}

function classifyExplicitReceipt(sentence: string, aliases: readonly string[], personalOnly: boolean): boolean | null {
  const aliasPattern = aliases.map(escapeRegularExpression).sort((left, right) => right.length - left.length).join("|");
  const receiver = `(?:${aliasPattern})`;
  const personal = personalOnly
    ? "(?:datos personales(?: de (?:los )?(?:usuarios|clientes|personas))?|informacion personal|personal data(?: of (?:users|customers|individuals))?|personal information)"
    : "(?:texto|mensaje|imagen|prompt|contenido|datos|correo electronico|contenido de usuario|text|message|image|prompt|content|data|email address)";
  const action = "(?:recibe|reciben|recibir|recibimos|procesa|procesan|procesar|trata|tratan|tratar|almacena|almacenan|almacenar|envia|envian|enviar|enviamos|comparte|comparten|compartir|transmite|transmiten|transmitir|accede|acceden|receive|receives|receiving|process|processes|processing|collect|collects|store|stores|send|sends|sending|share|shares|transmit|transmits|access|accesses)";
  const negation = "(?:no|nunca|not|never|does not|do not|doesn.t|don.t|will not|cannot|can.t)";
  const providerNegated = new RegExp(`${receiver}\\b.{0,50}\\b${negation}\\b.{0,24}\\b${action}\\b.{0,100}\\b${personal}\\b`, "u").test(sentence);
  const siteNegated = new RegExp(`(?:nosotros|la empresa|el responsable|we|our server|the controller).{0,40}\\b${negation}\\b.{0,24}\\b${action}\\b.{0,100}\\b${personal}\\b.{0,80}\\b(?:a|al|con|to|with)\\s+${receiver}`, "u").test(sentence);
  const providerPositive = new RegExp(`${receiver}\\b.{0,50}\\b${action}\\b.{0,100}\\b${personal}\\b`, "u").test(sentence);
  const sitePositive = new RegExp(`(?:nosotros|la empresa|el responsable|we|our server|the controller).{0,40}\\b${action}\\b.{0,100}\\b${personal}\\b.{0,80}\\b(?:a|al|to|with|by)\\s+${receiver}`, "u").test(sentence);
  const transferNegative = new RegExp(`(?:nosotros|la empresa|el responsable|we|our server|the controller).{0,40}\\b${negation}\\b.{0,24}\\b(?:envia|enviar|transmite|transmitir|comparte|compartir|send|sends|share|shares|transmit|transmits)\\b.{0,80}\\b${personal}\\b.{0,80}\\b(?:a|al|con|to|with)\\s+${receiver}`, "u").test(sentence);
  const implicitSubjectNegative = new RegExp(`\\b(?:no|nunca|not|never|does not|do not|doesn.t|don.t)\\b.{0,20}\\b(?:envia|envian|enviamos|enviar|transmite|transmiten|transmitimos|transmitir|comparte|comparten|compartimos|compartir|send|sends|share|shares|transmit|transmits)\\b.{0,80}\\b${personal}\\b.{0,80}\\b(?:a|al|con|to|with)\\s+${receiver}`, "u").test(sentence);
  const transferPositive = new RegExp(`\\b(?:envia|enviar|transmite|transmitir|comparte|compartir|send|sends|share|shares|transmit|transmits)\\b.{0,80}\\b(?:a|al|to|with)\\s+${receiver}.{0,80}\\b${personal}\\b`, "u").test(sentence);
  const passivePositive = new RegExp(`\\b${personal}\\b.{0,50}\\b(?:se envia|se transmite|is sent|are sent|is processed|are processed|received|processed|collected)\\b.{0,80}\\b(?:por|by|to|a)\\s+${receiver}`, "u").test(sentence);
  const passiveNegative = new RegExp(`\\b${personal}\\b.{0,50}\\b${negation}\\b.{0,24}\\b(?:se envia|se transmite|is sent|are sent|is processed|are processed)\\b.{0,80}\\b(?:por|by|to|a|con)\\s+${receiver}`, "u").test(sentence);
  const negative = providerNegated || siteNegated || transferNegative || implicitSubjectNegative || passiveNegative;
  const positive = providerPositive || sitePositive || transferPositive || passivePositive;
  return positive === negative ? null : positive;
}

function deduplicateStatements<T extends { providerId: string; factId: string; value: boolean; excerpt: string }>(
  input: readonly T[],
): T[] {
  const seen = new Set<string>();
  return input.filter((statement) => {
    const key = `${statement.providerId}\0${statement.factId}\0${statement.value}\0${statement.excerpt}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function escapeRegularExpression(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
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
