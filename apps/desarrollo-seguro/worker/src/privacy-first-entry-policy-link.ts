import { normalizeHostname, type FirstEntryPolicyLink } from "@desarrolloseguro/core";
import type { Page } from "playwright";

export type FirstEntryPolicyLinkDiscovery = {
  status: "evaluated" | "unknown";
  consentComponentDetected: boolean | null;
  consentComponentLink: FirstEntryPolicyLink | null;
  consentComponentDocumentAccess: "accessible" | "unavailable" | "not_checked" | "unknown";
  informationNoticeLink?: FirstEntryPolicyLink | null;
  informationNoticeDocumentAccess?: "accessible" | "unavailable" | "not_checked" | "unknown";
  footerLink: FirstEntryPolicyLink | null;
  footerLinkDocumentAccess: "accessible" | "unavailable" | "not_checked" | "unknown";
};

export function detectThirdPartyCookiePresence(input: {
  auditedHostname: string;
  cookies: readonly { domain: string }[];
  complete: boolean;
}): boolean | null {
  if (!input.complete) return null;
  let auditedHostname: string;
  try { auditedHostname = normalizeHostname(input.auditedHostname); } catch { return null; }
  let unresolvedDomain = false;
  for (const { domain } of input.cookies) {
    let cookieDomain: string;
    try { cookieDomain = normalizeHostname(domain.replace(/^\.+/u, "")); } catch { unresolvedDomain = true; continue; }
    const firstParty = auditedHostname === cookieDomain || auditedHostname.endsWith(`.${cookieDomain}`) ||
      cookieDomain.endsWith(`.${auditedHostname}`) || getSiteRootDomain(auditedHostname) === getSiteRootDomain(cookieDomain);
    if (!firstParty) return true;
  }
  return unresolvedDomain ? null : false;
}

function getSiteRootDomain(hostname: string): string {
  const labels = hostname.split(".");
  const publicSuffixDepth = labels.at(-1)?.length === 2 && (labels.at(-2)?.length ?? 0) <= 3 ? 2 : 1;
  return labels.slice(-Math.min(labels.length, publicSuffixDepth + 1)).join(".");
}

/** Reads visible legal links from the first rendered page and identifies CMP membership. */
export async function inspectFirstEntryPolicyLinks(
  page: Page,
  consentPromptDetected: boolean | null,
): Promise<FirstEntryPolicyLinkDiscovery> {
  try {
    const result = await page.locator("a[href]").evaluateAll((anchors, promptDetected) => {
      const controlSelector = 'button,[role="button"],input[type="button"],input[type="submit"]';
      const policyReference = /(?:privacy|privacidad|protecci[oó]n\s+(?:de\s+)?datos|data\s+protection|cookie|cookies|pol[ií]tica\s+(?:de\s+)?(?:privacidad|datos|cookies)|t[eé]rminos|terms|conditions|condiciones|aviso\s+legal|legal\s+notice|imprint)/iu;
      const visible = (element: Element): boolean => {
        if (!(element instanceof HTMLElement) || element.hidden || element.getAttribute("aria-hidden") === "true") return false;
        const rect = element.getBoundingClientRect();
        if (rect.width <= 0 || rect.height <= 0) return false;
        let current: HTMLElement | null = element;
        while (current) {
          const style = getComputedStyle(current);
          if (current.hidden || style.display === "none" || style.visibility === "hidden" || Number(style.opacity) === 0) return false;
          current = current.parentElement;
        }
        return true;
      };
      const consentKind = (element: Element): boolean => {
        const label = `${element.getAttribute("aria-label") ?? ""} ${(element as HTMLElement).innerText ?? element.textContent ?? ""}`.trim();
        return /\b(aceptar|accept|allow|consentir|permitir|agree|rechazar|reject|decline|denegar|solo necesarias|solo esenciales|essential only|configurar|preferencias|settings|manage|personalizar|customize|opciones)\b/iu.test(label);
      };
      const hasUnsafeUrlCharacter = (value: string): boolean => Array.from(value).some((character) => {
        const code = character.codePointAt(0) ?? 0;
        return character === "\\" || code <= 0x20 || code === 0x7f;
      });
      const visibleControls = Array.from(document.querySelectorAll(controlSelector)).filter((element) => visible(element) && consentKind(element));
      const mark = (element: Element): boolean => {
        const attrs = `${element.getAttribute("id") ?? ""} ${typeof element.className === "string" ? element.className : ""}`;
        return /(?:cookie|consent|privacy|privacidad|cmp|gdpr|rgpd)/iu.test(attrs);
      };
      const explicitRoot = visibleControls.map((control) => {
        let current: Element | null = control;
        let depth = 0;
        while (current && current !== document.body && depth < 12) {
          if (current.getAttribute("role") === "dialog" || current.getAttribute("aria-modal") === "true" || mark(current)) return current;
          current = current.parentElement;
          depth += 1;
        }
        return null;
      }).find((item): item is Element => item !== null);
      const commonAncestor = (items: Element[]): Element | null => {
        if (items.length === 0) return null;
        let current: Element | null = items[0] ?? null;
        while (current && current !== document.body) {
          if (items.every((item) => current?.contains(item))) return current;
          current = current.parentElement;
        }
        return null;
      };
      let consentRoot: Element | null = explicitRoot ?? null;
      if (!consentRoot && visibleControls.length > 0) {
        const candidate = commonAncestor(visibleControls.map((control) => control.parentElement ?? control));
        if (candidate && (visibleControls.length === 1 || /(?:cookie|consent|privacidad|privacy|datos personales|data protection)/iu.test(candidate.textContent ?? ""))) consentRoot = candidate;
      }
      if (consentRoot && (consentRoot === document.documentElement || consentRoot === document.body)) consentRoot = null;
      const publicLink = (anchor: Element): FirstEntryPolicyLink | null => {
        const href = anchor.getAttribute("href");
        const text = `${href ?? ""} ${(anchor as HTMLElement).innerText ?? anchor.textContent ?? ""}`;
        if (!href || !policyReference.test(text) || hasUnsafeUrlCharacter(href)) return null;
        let url: URL;
        try { url = new URL(href, document.location.href); } catch { return null; }
        if (url.protocol !== "https:" || url.username || url.password || url.port || url.pathname.length > 512 || /%(?:0[0-9a-f]|1[0-9a-f]|7f)/iu.test(url.pathname)) return null;
        const hostname = url.hostname.toLowerCase().replace(/\.$/u, "");
        if (hostname.length > 253 || !/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)(?:\.(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?))*$/iu.test(hostname)) return null;
        if (["localhost", ".localhost", ".local", ".internal", ".test", ".invalid", ".example", ".home.arpa", ".onion", ".lan", ".home", ".corp", ".intranet", ".private"].some((suffix) => suffix === "localhost" ? hostname === suffix : hostname.endsWith(suffix))) return null;
        const kind = /cookie/iu.test(text) ? "cookies"
          : /(?:t[eé]rminos|terms|conditions|condiciones)/iu.test(text) ? "terms"
            : /(?:aviso\s+legal|legal\s+notice|imprint)/iu.test(text) ? "legal" : "privacy";
        return { hostname, path: url.pathname || "/", kind };
      };
      const links = (anchors as Element[]).filter((anchor) => visible(anchor)).map((anchor) => ({ anchor, link: publicLink(anchor) }))
        .filter((item): item is { anchor: Element; link: FirstEntryPolicyLink } => item.link !== null);
      const consentLink = consentRoot ? links.find(({ anchor }) => consentRoot?.contains(anchor))?.link ?? null : null;
      const footerLink = links.find(({ anchor }) => {
        let current: Element | null = anchor;
        let depth = 0;
        while (current && current !== document.body && depth < 10) {
          const attrs = `${current.getAttribute("id") ?? ""} ${typeof current.className === "string" ? current.className : ""}`;
          if (current.tagName.toLowerCase() === "footer" || current.getAttribute("role") === "contentinfo" || /footer/iu.test(attrs)) return true;
          current = current.parentElement;
          depth += 1;
        }
        return false;
      })?.link ?? null;
      const informationNoticeLink = promptDetected === false ? links.find(({ anchor }) => {
        let current: Element | null = anchor;
        let depth = 0;
        while (current && current !== document.body && depth < 10) {
          if (mark(current) || current.getAttribute("role") === "dialog" || current.getAttribute("aria-modal") === "true") return true;
          current = current.parentElement;
          depth += 1;
        }
        return false;
      })?.link ?? null : null;
      return {
        status: promptDetected === true && visibleControls.length > 0 && !consentRoot ? "unknown" as const : "evaluated" as const,
        consentComponentDetected: promptDetected === true ? consentRoot !== null : promptDetected === false ? false : null,
        consentComponentLink: consentLink,
        consentComponentDocumentAccess: "not_checked" as const,
        informationNoticeLink,
        informationNoticeDocumentAccess: "not_checked" as const,
        footerLink,
        footerLinkDocumentAccess: "not_checked" as const,
      };
    }, consentPromptDetected);
    if (!isDiscovery(result)) return unknownDiscovery(consentPromptDetected);
    return result;
  } catch {
    return unknownDiscovery(consentPromptDetected);
  }
}

/** Performs a bounded read-only navigation to the link in its caller's fresh context. */
export async function verifyFirstEntryPolicyDocument(
  page: Page,
  link: FirstEntryPolicyLink | null,
): Promise<"accessible" | "unavailable" | "not_checked" | "unknown"> {
  if (!link) return "not_checked";
  try {
    const response = await page.goto(`https://${link.hostname}${link.path}`, { waitUntil: "domcontentloaded" });
    const status = response?.status();
    const contentType = response?.headers()["content-type"]?.split(";", 1)[0]?.trim().toLowerCase() ?? "";
    const supportedDocument = contentType === "text/html" || contentType === "application/pdf" || contentType === "text/plain";
    const finalUrl = response?.url() ?? page.url();
    const target = new URL(finalUrl);
    if (target.protocol !== "https:" || target.username || target.password || target.port) return "unavailable";
    if (!response || status === undefined || status < 200 || status >= 300 || !supportedDocument) return "unavailable";
    if (contentType === "application/pdf") {
      const body = await response.body();
      return body.byteLength >= 8 && body.subarray(0, 5).toString("ascii") === "%PDF-" ? "accessible" : "unavailable";
    }
    const bodyText = await page.locator("body").innerText({ timeout: 1_000 }).catch(() => "");
    if (bodyText.replace(/\s+/gu, " ").trim().length < 40) return "unavailable";
    return "accessible";
  } catch {
    return "unavailable";
  }
}

function isDiscovery(value: unknown): value is FirstEntryPolicyLinkDiscovery {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return (candidate.status === "evaluated" || candidate.status === "unknown") &&
    (candidate.consentComponentDetected === true || candidate.consentComponentDetected === false || candidate.consentComponentDetected === null) &&
    (candidate.consentComponentLink === null || isLink(candidate.consentComponentLink)) &&
    isDocumentAccess(candidate.consentComponentDocumentAccess) &&
    (candidate.informationNoticeLink === undefined || candidate.informationNoticeLink === null || isLink(candidate.informationNoticeLink)) &&
    (candidate.informationNoticeDocumentAccess === undefined || isDocumentAccess(candidate.informationNoticeDocumentAccess)) &&
    (candidate.footerLink === null || isLink(candidate.footerLink)) &&
    isDocumentAccess(candidate.footerLinkDocumentAccess);
}

function isLink(value: unknown): value is FirstEntryPolicyLink {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return typeof candidate.hostname === "string" && candidate.hostname.length <= 253 &&
    /^[a-z0-9.-]+$/iu.test(candidate.hostname) && typeof candidate.path === "string" &&
    candidate.path.startsWith("/") && candidate.path.length <= 512 && !/[?#]/u.test(candidate.path) && !hasUnsafeUrlCharacter(candidate.path) &&
    ["privacy", "cookies", "terms", "legal"].includes(String(candidate.kind));
}

function unknownDiscovery(consentPromptDetected: boolean | null): FirstEntryPolicyLinkDiscovery {
  return { status: "unknown", consentComponentDetected: consentPromptDetected === false ? false : null, consentComponentLink: null, consentComponentDocumentAccess: "unknown", informationNoticeLink: null, informationNoticeDocumentAccess: "unknown", footerLink: null, footerLinkDocumentAccess: "unknown" };
}

function hasUnsafeUrlCharacter(value: string): boolean {
  return Array.from(value).some((character) => {
    const code = character.codePointAt(0) ?? 0;
    return code <= 0x20 || code === 0x7f;
  });
}

function isDocumentAccess(value: unknown): value is FirstEntryPolicyLinkDiscovery["consentComponentDocumentAccess"] {
  return ["accessible", "unavailable", "not_checked", "unknown"].includes(String(value));
}
