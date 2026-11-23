import { parse } from "parse5";
import type { DefaultTreeAdapterMap } from "parse5";
import { normalizeHostname } from "@desarrolloseguro/core";

const MAX_HTML_BYTES = 256 * 1024;
const MAX_DOCUMENT_NODES = 50_000;
const MAX_ANCHOR_TEXT_LENGTH = 1_024;
const MAX_POLICY_PATH_LENGTH = 512;
export const MAX_PUBLIC_POLICY_LINKS = 30;

const POLICY_REFERENCE = /(?:privacy|privacidad|protecci[oó]n\s+de\s+datos|data\s+protection|cookie|cookies|pol[ií]tica\s+(?:de\s+)?(?:privacidad|datos|cookies)|t[eé]rminos|terms|conditions|condiciones|aviso\s+legal|legal\s+notice|imprint)/iu;
const PRIVATE_HOST_SUFFIXES = [
  ".localhost", ".local", ".internal", ".test", ".invalid", ".example",
  ".home.arpa", ".onion", ".lan", ".home", ".corp", ".intranet", ".private",
];

export type PublicPolicyLink = {
  hostname: string;
  path: string;
  kind: "privacy" | "cookies" | "terms" | "legal";
};

/**
 * Finds likely public privacy, cookie, legal, and terms pages linked from a
 * page. Only normalized HTTPS host/path pairs cross this boundary; query
 * strings, fragments, labels, and source HTML are discarded. DNS resolution
 * and private-address rejection must still be enforced by the network layer.
 */
export function extractPublicPolicyLinks(
  hostnameInput: unknown,
  html: unknown,
): PublicPolicyLink[] {
  if (typeof html !== "string" || Buffer.byteLength(html, "utf8") > MAX_HTML_BYTES) {
    return [];
  }

  let rootHostname: string;
  try {
    rootHostname = normalizeHostname(hostnameInput);
  } catch {
    return [];
  }

  const document = parse(html);
  const pending: DefaultTreeAdapterMap["node"][] = [document];
  const links: PublicPolicyLink[] = [];
  const seen = new Set<string>();
  let visitedNodes = 0;

  while (pending.length > 0 && links.length < MAX_PUBLIC_POLICY_LINKS) {
    const current = pending.pop();
    if (!current) continue;
    visitedNodes += 1;
    if (visitedNodes > MAX_DOCUMENT_NODES) return [];

    if (isElement(current)) {
      if (current.tagName === "a") {
        const href = getAttribute(current, "href");
        if (href) {
          const anchorText = collectText(current);
          const reference = `${href.split(/[?#]/u, 1)[0]} ${anchorText}`;
          if (!hasPolicyReference(reference)) continue;
          const kind = classifyPolicyReference(reference);
          const link = normalizePolicyLink(href, rootHostname, kind);
          if (link) {
            const key = `${link.hostname}${link.path}`;
            if (!seen.has(key)) {
              seen.add(key);
              links.push(link);
            }
          }
        }
      }
    }

    if ("childNodes" in current) {
      for (let index = current.childNodes.length - 1; index >= 0; index -= 1) {
        const child = current.childNodes[index];
        if (child) pending.push(child);
      }
    }
  }

  return links;
}

function normalizePolicyLink(
  href: string,
  rootHostname: string,
  kind: PublicPolicyLink["kind"],
): PublicPolicyLink | undefined {
  if (containsUnsafeUrlCharacter(href)) return undefined;

  let url: URL;
  try {
    url = new URL(href.trim(), `https://${rootHostname}/`);
  } catch {
    return undefined;
  }

  if (
    url.protocol !== "https:" ||
    url.username !== "" ||
    url.password !== "" ||
    url.port !== ""
  ) {
    return undefined;
  }

  let normalizedHostname: string;
  try {
    normalizedHostname = normalizeHostname(url.hostname);
  } catch {
    return undefined;
  }
  if (PRIVATE_HOST_SUFFIXES.some((suffix) => normalizedHostname.endsWith(suffix))) {
    return undefined;
  }

  url.search = "";
  url.hash = "";
  const path = url.pathname;
  if (path.length > MAX_POLICY_PATH_LENGTH || /%(?:0[0-9a-f]|1[0-9a-f]|7f)/iu.test(path)) {
    return undefined;
  }

  return { hostname: normalizedHostname, path, kind };
}

function hasPolicyReference(value: string): boolean {
  return POLICY_REFERENCE.test(value);
}

function classifyPolicyReference(value: string): PublicPolicyLink["kind"] {
  if (/(?:privacy|privacidad|protecci[oó]n\s+(?:de\s+)?datos|data\s+protection|cookie|cookies|pol[ií]tica\s+(?:de\s+)?(?:privacidad|datos|cookies))/iu.test(value)) {
    return /cookie/iu.test(value) ? "cookies" : "privacy";
  }
  if (/(?:t[eé]rminos|terms|conditions|condiciones)/iu.test(value)) return "terms";
  return "legal";
}

function containsUnsafeUrlCharacter(value: string): boolean {
  return Array.from(value).some((character) => {
    const code = character.codePointAt(0) ?? 0;
    return character === "\\" || code <= 0x1f || code === 0x7f;
  });
}

function getAttribute(element: DefaultTreeAdapterMap["element"], name: string): string | undefined {
  return element.attrs.find((attribute) => attribute.name === name)?.value;
}

function collectText(node: DefaultTreeAdapterMap["node"]): string {
  const pending: DefaultTreeAdapterMap["node"][] = [node];
  let text = "";
  while (pending.length > 0 && text.length < MAX_ANCHOR_TEXT_LENGTH) {
    const current = pending.pop();
    if (!current) continue;
    if (current.nodeName === "#text" && "value" in current) {
      text += `${current.value} `;
    } else if ("childNodes" in current) {
      for (let index = current.childNodes.length - 1; index >= 0; index -= 1) {
        const child = current.childNodes[index];
        if (child) pending.push(child);
      }
    }
  }
  return text.slice(0, MAX_ANCHOR_TEXT_LENGTH);
}

function isElement(node: DefaultTreeAdapterMap["node"]): node is DefaultTreeAdapterMap["element"] {
  return "tagName" in node && Array.isArray(node.attrs);
}
