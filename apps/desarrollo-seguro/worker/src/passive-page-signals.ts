import { parse } from "parse5";
import type { DefaultTreeAdapterMap } from "parse5";
import { COOKIE_CATALOG } from "./data/cookie-pattern-catalog.js";

const MAX_HTML_BYTES = 256 * 1024;
const MAX_COOKIE_HEADERS = 100;
const MAX_PAGE_NODES = 50_000;
const RESOURCE_ATTRIBUTES: Readonly<Record<string, readonly string[]>> = {
  script: ["src"],
  iframe: ["src"],
  img: ["src"],
  source: ["src"],
  video: ["src", "poster"],
  audio: ["src"],
  link: ["href"],
};
const TRACKING_HOSTS = new Set([
  "www.google-analytics.com",
  "google-analytics.com",
  "googletagmanager.com",
  "connect.facebook.net",
  "static.hotjar.com",
  "script.hotjar.com",
  "clarity.ms",
  "fullstory.com",
  "cdn.segment.com",
]);
const CONSENT_TEXT = /(?:aceptar|rechazar|consent|cookie settings|preferencias de privacidad)/iu;

export type PassivePageSignalInput = {
  hostname: string;
  html: string;
  setCookieHeaders: readonly string[];
  responseTimeMs: number;
  responseBytes: number;
  complete?: boolean;
};

/** Extracts aggregate signals only; markup, URLs, cookie names, and values are discarded. */
export function inspectPassivePageSignals(
  input: PassivePageSignalInput,
): {
  inspected: boolean;
  thirdPartyResourceReferences: number;
  knownTrackingResourceReferences: number;
  consentPromptDetected: boolean;
  cookieCount: number;
  insecureCookieCount: number;
  catalogMatchCount: number;
  responseTimeMs: number;
  responseBytes: number;
} {
  const responseTimeMs = boundedCount(input.responseTimeMs, 60_000);
  const responseBytes = boundedCount(input.responseBytes, 2 * 1024 * 1024);
  if (
    input.complete === false ||
    Buffer.byteLength(input.html, "utf8") > MAX_HTML_BYTES ||
    input.setCookieHeaders.length > MAX_COOKIE_HEADERS
  ) {
    return emptySignals(responseTimeMs, responseBytes);
  }

  const rootHostname = normalizeHostname(input.hostname);
  const document = parse(input.html);
  const aggregate = { thirdParty: 0, knownTracking: 0 };
  let consentPromptDetected = false;
  const complete = inspectNodes(document, rootHostname, aggregate, () => {
    consentPromptDetected = true;
  });
  if (!complete) return emptySignals(responseTimeMs, responseBytes);

  const cookies = input.setCookieHeaders.slice(0, MAX_COOKIE_HEADERS);
  let insecureCookieCount = 0;
  let catalogMatchCount = 0;
  for (const header of cookies) {
    const [cookiePair = ""] = header.split(";", 1);
    const separator = cookiePair.indexOf("=");
    if (separator <= 0) continue;
    const cookieName = cookiePair.slice(0, separator).trim();
    const attributes = header.slice(separator + 1).toLowerCase();
    if (!/(?:^|;)\s*secure(?:\s*;|\s*$)/u.test(attributes)) {
      insecureCookieCount += 1;
    }
    if (matchesCookieCatalog(cookieName)) {
      catalogMatchCount += 1;
    }
  }

  return {
    inspected: true,
    thirdPartyResourceReferences: aggregate.thirdParty,
    knownTrackingResourceReferences: aggregate.knownTracking,
    consentPromptDetected,
    cookieCount: cookies.length,
    insecureCookieCount,
    catalogMatchCount,
    responseTimeMs,
    responseBytes,
  };
}

function matchesCookieCatalog(cookieName: string): boolean {
  return COOKIE_CATALOG.some((entry) =>
    entry.match === "exact"
      ? cookieName === entry.pattern
      : cookieName.startsWith(entry.pattern),
  );
}

function inspectNodes(
  node: DefaultTreeAdapterMap["node"],
  rootHostname: string,
  aggregate: { thirdParty: number; knownTracking: number },
  onConsentText: () => void,
): boolean {
  const pending = [node];
  let inspectedNodes = 0;
  while (pending.length > 0) {
    const current = pending.pop();
    if (!current) continue;
    inspectedNodes += 1;
    if (inspectedNodes > MAX_PAGE_NODES) return false;
    if (isElement(current)) {
      const attributes = new Map(
        current.attrs.map(({ name, value }) => [name, value]),
      );
      for (const attribute of RESOURCE_ATTRIBUTES[current.tagName] ?? []) {
        const value = attributes.get(attribute);
        if (!value) continue;
        const referencedHostname = getPublicResourceHostname(value, rootHostname);
        if (!referencedHostname || referencedHostname === rootHostname) continue;
        aggregate.thirdParty += 1;
        if (isKnownTrackingHost(referencedHostname)) {
          aggregate.knownTracking += 1;
        }
      }
      if (current.tagName === "button") {
        const label = collectText(current, 512);
        if (CONSENT_TEXT.test(label)) onConsentText();
      }
    }

    if ("childNodes" in current) pending.push(...current.childNodes);
  }
  return true;
}

function collectText(node: DefaultTreeAdapterMap["node"], limit: number): string {
  const pending = [node];
  let text = "";
  while (pending.length > 0 && text.length < limit) {
    const current = pending.pop();
    if (!current) continue;
    if (current.nodeName === "#text" && "value" in current) {
      text += `${current.value} `;
    } else if ("childNodes" in current) {
      pending.push(...current.childNodes);
    }
  }
  return text.slice(0, limit);
}

function isElement(node: DefaultTreeAdapterMap["node"]): node is DefaultTreeAdapterMap["element"] {
  return "tagName" in node && Array.isArray(node.attrs);
}

function getPublicResourceHostname(value: string, rootHostname: string): string | undefined {
  try {
    const resource = new URL(value, `https://${rootHostname}/`);
    if (
      resource.protocol !== "http:" && resource.protocol !== "https:"
    ) return undefined;
    if (resource.username || resource.password || resource.port) return undefined;
    return normalizeHostname(resource.hostname);
  } catch {
    return undefined;
  }
}

function isKnownTrackingHost(hostname: string): boolean {
  for (const knownHost of TRACKING_HOSTS) {
    if (hostname === knownHost || hostname.endsWith(`.${knownHost}`)) return true;
  }
  return false;
}

function normalizeHostname(hostname: string): string {
  return hostname.toLowerCase().replace(/\.$/u, "");
}

function boundedCount(value: number, maximum: number): number {
  if (!Number.isSafeInteger(value) || value < 0) return 0;
  return Math.min(value, maximum);
}

function emptySignals(responseTimeMs: number, responseBytes: number) {
  return {
    inspected: false,
    thirdPartyResourceReferences: 0,
    knownTrackingResourceReferences: 0,
    consentPromptDetected: false,
    cookieCount: 0,
    insecureCookieCount: 0,
    catalogMatchCount: 0,
    responseTimeMs,
    responseBytes,
  };
}
