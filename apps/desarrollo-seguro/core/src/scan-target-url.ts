const MAX_SCAN_TARGET_URL_LENGTH = 2_048;
const INVALID_SCAN_TARGET_URL = "invalid_scan_target_url";
const RESERVED_SUFFIXES = [
  ".localhost", ".local", ".internal", ".test", ".invalid", ".example", ".home.arpa", ".onion",
];

export type ScanTargetUrl = {
  hostname: string;
  targetUrl: string;
  targetPath: string;
};

/** Validates and canonicalizes the exact public HTTPS page selected for a scan. */
export function parseScanTargetUrl(input: unknown): ScanTargetUrl {
  if (
    typeof input !== "string" ||
    input.length === 0 ||
    input.length > MAX_SCAN_TARGET_URL_LENGTH ||
    input.trim() !== input ||
    !/^https:\/\//iu.test(input) ||
    hasInvalidInputCharacter(input)
  ) {
    throw new Error(INVALID_SCAN_TARGET_URL);
  }

  let url: URL;
  try {
    url = new URL(input);
  } catch {
    throw new Error(INVALID_SCAN_TARGET_URL);
  }

  const authority = input.slice("https://".length).split(/[/?#]/u, 1)[0] ?? "";

  if (
    url.protocol !== "https:" ||
    authority.includes("@") ||
    url.username !== "" ||
    url.password !== "" ||
    url.port !== ""
  ) {
    throw new Error(INVALID_SCAN_TARGET_URL);
  }

  const hostname = normalizePublicHostname(url.hostname);

  url.hash = "";
  const targetPath = `${url.pathname}${url.search}`;
  const targetUrl = `https://${hostname}${targetPath}`;
  if (targetUrl.length > MAX_SCAN_TARGET_URL_LENGTH) {
    throw new Error(INVALID_SCAN_TARGET_URL);
  }

  return { hostname, targetUrl, targetPath };
}

function normalizePublicHostname(input: string): string {
  const hostname = input.toLowerCase().replace(/\.$/u, "");
  if (
    hostname.length === 0 || hostname.length > 253 || !hostname.includes(".") ||
    hostname.includes(":") || /^\d{1,3}(?:\.\d{1,3}){3}$/u.test(hostname) ||
    RESERVED_SUFFIXES.some((suffix) => hostname.endsWith(suffix))
  ) throw new Error(INVALID_SCAN_TARGET_URL);
  const labels = hostname.split(".");
  if (labels.some((label) => label.length > 63 || !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/u.test(label))) {
    throw new Error(INVALID_SCAN_TARGET_URL);
  }
  return hostname;
}

function hasInvalidInputCharacter(value: string): boolean {
  return Array.from(value).some((character) => {
    const codePoint = character.codePointAt(0) ?? 0;
    return codePoint <= 0x20 || codePoint === 0x7f || character === "\\";
  });
}
