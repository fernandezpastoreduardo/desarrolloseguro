import { normalizeHostname } from "@desarrolloseguro/core";

export type CatalogedOfficialDocumentMatch = {
  providerId: string;
  displayName: string;
  kind: "privacy" | "cookies" | "terms" | "legal" | "service" | "technical";
  title: string;
  officialUrl: string;
};

/** Only an exact canonical URL with one catalog owner establishes attribution. */
export function findUniqueCatalogedOfficialDocument(
  discoveredHref: string,
  providerFacts: readonly unknown[],
): CatalogedOfficialDocumentMatch | null {
  const target = canonicalPublicUrl(discoveredHref);
  if (!target || providerFacts.length > 300) return null;
  const matches = new Map<string, CatalogedOfficialDocumentMatch>();
  for (const fact of providerFacts) {
    if (!isRecord(fact) || typeof fact.providerId !== "string" || !/^[a-z0-9][a-z0-9_-]{0,31}$/u.test(fact.providerId) ||
        typeof fact.displayName !== "string" || fact.displayName.length === 0 || fact.displayName.length > 120) continue;
    for (const candidate of readOfficialUrls(fact)) {
      if (canonicalPublicUrl(candidate.url) !== target) continue;
      matches.set(fact.providerId, {
        providerId: fact.providerId,
        displayName: fact.displayName,
        kind: candidate.kind,
        title: candidate.title,
        officialUrl: candidate.url,
      });
      break;
    }
  }
  if (matches.size !== 1) return null;
  return [...matches.values()][0] ?? null;
}

function readOfficialUrls(fact: Record<string, unknown>): Array<{
  url: string;
  title: string;
  kind: CatalogedOfficialDocumentMatch["kind"];
}> {
  const output: Array<{ url: string; title: string; kind: CatalogedOfficialDocumentMatch["kind"] }> = [];
  if (Array.isArray(fact.officialDocuments) && fact.officialDocuments.length <= 50) {
    for (const document of fact.officialDocuments) {
      if (!isRecord(document) || typeof document.url !== "string" || typeof document.title !== "string") continue;
      const kind = normalizeKind(document.kind);
      if (kind) output.push({ url: document.url, title: document.title.slice(0, 240), kind });
    }
  }
  if (typeof fact.privacyPolicyUrl === "string") output.push({
    url: fact.privacyPolicyUrl, title: `${String(fact.displayName).slice(0, 120)} privacy documentation`, kind: "privacy",
  });
  if (typeof fact.serviceSourceUrl === "string") output.push({
    url: fact.serviceSourceUrl, title: `${String(fact.displayName).slice(0, 120)} service documentation`, kind: "service",
  });
  return output;
}

function normalizeKind(value: unknown): CatalogedOfficialDocumentMatch["kind"] | null {
  if (value === "dpa" || value === "subprocessors") return "legal";
  if (value === "service-documentation") return "service";
  return value === "privacy" || value === "cookies" || value === "terms" || value === "legal" ||
    value === "service" || value === "technical" ? value : null;
}

function canonicalPublicUrl(value: string): string | null {
  if (value.length > 2048) return null;
  try {
    const url = new URL(value);
    const hostname = normalizeHostname(url.hostname);
    if (url.protocol !== "https:" || url.username || url.password || url.port ||
        !url.pathname.startsWith("/") || url.pathname.length > 512 ||
        Array.from(url.pathname).some((character) => {
          const codePoint = character.codePointAt(0) ?? 0;
          return character === "\\" || codePoint <= 0x1f || codePoint === 0x7f;
        }) || /%(?:0[0-9a-f]|1[0-9a-f]|7f)/iu.test(url.pathname)) return null;
    return `https://${hostname}${url.pathname}`;
  } catch {
    return null;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
