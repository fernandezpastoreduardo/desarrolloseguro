export const FIRST_ENTRY_POLICY_ACCESS_VERSION = "first-entry-policy-access-v1" as const;

export type FirstEntryPolicyLink = {
  hostname: string;
  path: string;
  kind: "privacy" | "cookies" | "terms" | "legal";
};

export type FirstEntryPolicyStateSnapshot = {
  capturedAtMs: number;
  cookies: Array<{
    name: string;
    domain: string;
    secure: boolean;
    httpOnly: boolean;
    sameSite: "Strict" | "Lax" | "None" | "unspecified";
    expiresAtUnixSeconds: number | null;
  }>;
  storageKeys: Array<{ name: string; domain: string; kind: "local" | "session" | "indexeddb" | "cache" | "window-name" }>;
  cookieReadComplete: boolean;
  storageReadComplete: boolean;
};

export type FirstEntryPolicyLinkVisit = {
  status: "evaluated" | "unknown" | "not_applicable";
  link: FirstEntryPolicyLink | null;
  documentAccess: "accessible" | "unavailable" | "not_checked" | "unknown";
  navigationStartedAtMs: number | null;
  beforeNavigation: FirstEntryPolicyStateSnapshot | null;
  afterNavigation: FirstEntryPolicyStateSnapshot | null;
};

export type FirstEntryPolicyAccess = {
  policyVersion: typeof FIRST_ENTRY_POLICY_ACCESS_VERSION;
  status: "pass" | "fail" | "unknown";
  reasonCode:
    | "consent_component_link_accessible"
    | "information_notice_link_accessible_without_consent"
    | "consent_link_missing"
    | "consent_link_unavailable"
    | "footer_link_accessible_without_consent"
    | "footer_insufficient_with_third_party_cookies"
    | "information_notice_insufficient_with_third_party_cookies"
    | "policy_link_missing"
    | "auditor_error";
  consentPromptDetected: boolean | null;
  thirdPartyCookieDetected: boolean | null;
  nonEssentialThirdPartyStorageDetected: boolean | null;
  linkLocation: "consent_component" | "information_notice" | "footer" | "none" | "unknown";
  link: FirstEntryPolicyLink | null;
  documentAccess: "accessible" | "unavailable" | "not_checked" | "unknown";
  policyLinkVisit?: FirstEntryPolicyLinkVisit;
};

export type FirstEntryPolicyAccessInput = {
  consentPromptDetected: boolean | null;
  thirdPartyCookieDetected: boolean | null;
  nonEssentialThirdPartyStorageDetected: boolean | null;
  consentComponentLink: FirstEntryPolicyLink | null;
  informationNoticeLink?: FirstEntryPolicyLink | null;
  footerLink: FirstEntryPolicyLink | null;
  componentLinkDocumentAccess: "accessible" | "unavailable" | "not_checked" | "unknown";
  informationNoticeDocumentAccess?: "accessible" | "unavailable" | "not_checked" | "unknown";
  footerLinkDocumentAccess: "accessible" | "unavailable" | "not_checked" | "unknown";
  auditorError?: boolean;
};

export function assessFirstEntryPolicyAccess(input: FirstEntryPolicyAccessInput): FirstEntryPolicyAccess {
  if (input.auditorError || input.consentPromptDetected === null) {
    return result("unknown", "auditor_error", input, "unknown", null, "unknown");
  }
  if (input.consentPromptDetected) {
    if (!input.consentComponentLink) {
      return result("fail", "consent_link_missing", input, "none", null, "not_checked");
    }
    if (input.componentLinkDocumentAccess === "unknown" || input.componentLinkDocumentAccess === "not_checked") {
      return result("unknown", "auditor_error", input, "consent_component", input.consentComponentLink, input.componentLinkDocumentAccess);
    }
    if (input.componentLinkDocumentAccess === "unavailable") {
      return result("fail", "consent_link_unavailable", input, "consent_component", input.consentComponentLink, "unavailable");
    }
    return result("pass", "consent_component_link_accessible", input, "consent_component", input.consentComponentLink, "accessible");
  }
  if (input.thirdPartyCookieDetected === null) {
    const link = input.informationNoticeLink ?? input.footerLink;
    return result("unknown", "auditor_error", input, input.informationNoticeLink ? "information_notice" : input.footerLink ? "footer" : "unknown", link, input.informationNoticeLink ? input.informationNoticeDocumentAccess ?? "unknown" : input.footerLinkDocumentAccess);
  }
  const informationNoticeLink = input.informationNoticeLink ?? null;
  const firstEntryLink = informationNoticeLink ?? input.footerLink;
  const firstEntryAccess = informationNoticeLink ? input.informationNoticeDocumentAccess ?? "unknown" : input.footerLinkDocumentAccess;
  const firstEntryLocation = informationNoticeLink ? "information_notice" as const : "footer" as const;
  if (!firstEntryLink) {
    return result("fail", "policy_link_missing", input, "none", null, "not_checked");
  }
  if (input.thirdPartyCookieDetected) {
    return result("fail", informationNoticeLink ? "information_notice_insufficient_with_third_party_cookies" : "footer_insufficient_with_third_party_cookies", input, firstEntryLocation, firstEntryLink, firstEntryAccess);
  }
  if (firstEntryAccess === "unknown" || firstEntryAccess === "not_checked") {
    return result("unknown", "auditor_error", input, firstEntryLocation, firstEntryLink, firstEntryAccess);
  }
  if (firstEntryAccess === "unavailable") {
    return result("fail", "consent_link_unavailable", input, firstEntryLocation, firstEntryLink, "unavailable");
  }
  return informationNoticeLink
    ? result("pass", "information_notice_link_accessible_without_consent", input, "information_notice", informationNoticeLink, "accessible")
    : result("pass", "footer_link_accessible_without_consent", input, "footer", input.footerLink, "accessible");
}

export function parseFirstEntryPolicyAccess(value: unknown): FirstEntryPolicyAccess | null {
  if (!isRecord(value) || !exactKeys(value, [
    "policyVersion", "status", "reasonCode", "consentPromptDetected",
    "thirdPartyCookieDetected", "nonEssentialThirdPartyStorageDetected", "linkLocation", "link", "documentAccess",
  ], ["policyLinkVisit"]) || value.policyVersion !== FIRST_ENTRY_POLICY_ACCESS_VERSION ||
      !["pass", "fail", "unknown"].includes(String(value.status)) ||
      ![
        "consent_component_link_accessible", "information_notice_link_accessible_without_consent", "consent_link_missing", "consent_link_unavailable",
        "footer_link_accessible_without_consent", "footer_insufficient_with_third_party_cookies",
        "information_notice_insufficient_with_third_party_cookies",
        "policy_link_missing", "auditor_error",
      ].includes(String(value.reasonCode)) ||
      !(value.consentPromptDetected === true || value.consentPromptDetected === false || value.consentPromptDetected === null) ||
      !(value.thirdPartyCookieDetected === true || value.thirdPartyCookieDetected === false || value.thirdPartyCookieDetected === null) ||
      !(value.nonEssentialThirdPartyStorageDetected === true || value.nonEssentialThirdPartyStorageDetected === false || value.nonEssentialThirdPartyStorageDetected === null) ||
      !["consent_component", "information_notice", "footer", "none", "unknown"].includes(String(value.linkLocation)) ||
      !["accessible", "unavailable", "not_checked", "unknown"].includes(String(value.documentAccess)) ||
      (value.link !== null && !isPolicyLink(value.link))) return null;
  const policyLinkVisit = value.policyLinkVisit === undefined ? undefined : parsePolicyLinkVisit(value.policyLinkVisit);
  if (value.policyLinkVisit !== undefined && !policyLinkVisit) return null;

  const status = value.status as FirstEntryPolicyAccess["status"];
  const reasonCode = value.reasonCode as FirstEntryPolicyAccess["reasonCode"];
  const location = value.linkLocation as FirstEntryPolicyAccess["linkLocation"];
  const access = value.documentAccess as FirstEntryPolicyAccess["documentAccess"];
  if (status === "pass" && access !== "accessible") return null;
  if (status === "pass" && value.consentPromptDetected && (location !== "consent_component" || reasonCode !== "consent_component_link_accessible")) return null;
  if (status === "pass" && !value.consentPromptDetected && (value.thirdPartyCookieDetected !== false || !["footer", "information_notice"].includes(location) || !["footer_link_accessible_without_consent", "information_notice_link_accessible_without_consent"].includes(reasonCode))) return null;
  if (status === "pass" && reasonCode !== "consent_component_link_accessible" && reasonCode !== "footer_link_accessible_without_consent" && reasonCode !== "information_notice_link_accessible_without_consent") return null;
  if (status === "unknown" && reasonCode !== "auditor_error") return null;
  if (status === "fail" && reasonCode === "auditor_error") return null;
  if (reasonCode === "consent_link_missing" && (value.consentPromptDetected !== true || location !== "none" || value.link !== null)) return null;
  if (reasonCode === "consent_link_unavailable" && (access !== "unavailable" || value.link === null)) return null;
  if (reasonCode === "footer_link_accessible_without_consent" && (value.consentPromptDetected !== false || value.thirdPartyCookieDetected !== false || access !== "accessible" || location !== "footer")) return null;
  if (reasonCode === "information_notice_link_accessible_without_consent" && (value.consentPromptDetected !== false || value.thirdPartyCookieDetected !== false || access !== "accessible" || location !== "information_notice")) return null;
  if (reasonCode === "footer_insufficient_with_third_party_cookies" && (value.consentPromptDetected !== false || value.thirdPartyCookieDetected !== true || location !== "footer")) return null;
  if (reasonCode === "information_notice_insufficient_with_third_party_cookies" && (value.consentPromptDetected !== false || value.thirdPartyCookieDetected !== true || location !== "information_notice")) return null;
  if (reasonCode === "policy_link_missing" && (location !== "none" || value.link !== null)) return null;
  if (location === "none" && value.link !== null) return null;
  if (location !== "none" && location !== "unknown" && value.link === null) return null;
  return {
    policyVersion: FIRST_ENTRY_POLICY_ACCESS_VERSION,
    status,
    reasonCode,
    consentPromptDetected: value.consentPromptDetected,
    thirdPartyCookieDetected: value.thirdPartyCookieDetected,
    nonEssentialThirdPartyStorageDetected: value.nonEssentialThirdPartyStorageDetected,
    linkLocation: location,
    link: value.link as FirstEntryPolicyLink | null,
    documentAccess: access,
    ...(policyLinkVisit ? { policyLinkVisit } : {}),
  };
}

function parsePolicyLinkVisit(value: unknown): FirstEntryPolicyLinkVisit | null {
  if (!isRecord(value) || !exactKeys(value, [
    "status", "link", "documentAccess", "navigationStartedAtMs", "beforeNavigation", "afterNavigation",
  ]) || !["evaluated", "unknown", "not_applicable"].includes(String(value.status)) ||
      !(value.link === null || isPolicyLink(value.link)) ||
      !["accessible", "unavailable", "not_checked", "unknown"].includes(String(value.documentAccess)) ||
      !(value.navigationStartedAtMs === null || isNonNegativeInteger(value.navigationStartedAtMs)) ||
      !(value.beforeNavigation === null || isPolicyStateSnapshot(value.beforeNavigation)) ||
      !(value.afterNavigation === null || isPolicyStateSnapshot(value.afterNavigation))) return null;
  if (value.status === "evaluated" && value.link !== null &&
      (value.documentAccess === "not_checked" || value.navigationStartedAtMs === null || value.beforeNavigation === null ||
       value.afterNavigation === null ||
       value.beforeNavigation.capturedAtMs > value.navigationStartedAtMs ||
       value.navigationStartedAtMs > value.afterNavigation.capturedAtMs)) return null;
  if (value.status === "not_applicable" && (value.link !== null || value.navigationStartedAtMs !== null || value.afterNavigation !== null)) return null;
  return value as unknown as FirstEntryPolicyLinkVisit;
}

function isPolicyStateSnapshot(value: unknown): value is FirstEntryPolicyStateSnapshot {
  if (!isRecord(value) || !exactKeys(value, ["capturedAtMs", "cookies", "storageKeys", "cookieReadComplete", "storageReadComplete"]) ||
      !isNonNegativeInteger(value.capturedAtMs) || !Array.isArray(value.cookies) || value.cookies.length > 200 ||
      !Array.isArray(value.storageKeys) || value.storageKeys.length > 200 ||
      typeof value.cookieReadComplete !== "boolean" || typeof value.storageReadComplete !== "boolean") return false;
  return value.cookies.every((cookie) => isRecord(cookie) && exactKeys(cookie, ["name", "domain", "secure", "httpOnly", "sameSite", "expiresAtUnixSeconds"]) &&
    isSafeEvidenceName(cookie.name, 100) && isSafeEvidenceName(cookie.domain, 253) &&
    typeof cookie.secure === "boolean" && typeof cookie.httpOnly === "boolean" &&
    ["Strict", "Lax", "None", "unspecified"].includes(String(cookie.sameSite)) &&
    (cookie.expiresAtUnixSeconds === null || isNonNegativeInteger(cookie.expiresAtUnixSeconds))) &&
    value.storageKeys.every((entry) => isRecord(entry) && exactKeys(entry, ["name", "domain", "kind"]) &&
      isSafeEvidenceName(entry.name, 100) && isSafeEvidenceName(entry.domain, 253) &&
      ["local", "session", "indexeddb", "cache", "window-name"].includes(String(entry.kind)));
}

function isNonNegativeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 0;
}

function isSafeEvidenceName(value: unknown, maxLength: number): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= maxLength &&
    !Array.from(value).some((character) => {
      const code = character.codePointAt(0) ?? 0;
      return code <= 0x20 || code === 0x7f;
    });
}

function result(
  status: FirstEntryPolicyAccess["status"],
  reasonCode: FirstEntryPolicyAccess["reasonCode"],
  input: FirstEntryPolicyAccessInput,
  linkLocation: FirstEntryPolicyAccess["linkLocation"],
  link: FirstEntryPolicyLink | null,
  documentAccess: FirstEntryPolicyAccess["documentAccess"],
): FirstEntryPolicyAccess {
  return {
    policyVersion: FIRST_ENTRY_POLICY_ACCESS_VERSION,
    status,
    reasonCode,
    consentPromptDetected: input.consentPromptDetected,
    thirdPartyCookieDetected: input.thirdPartyCookieDetected,
    nonEssentialThirdPartyStorageDetected: input.nonEssentialThirdPartyStorageDetected,
    linkLocation,
    link,
    documentAccess,
  };
}

function isPolicyLink(value: unknown): value is FirstEntryPolicyLink {
  if (!isRecord(value) || !exactKeys(value, ["hostname", "path", "kind"]) ||
      typeof value.hostname !== "string" || value.hostname.length > 253 ||
      !/^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)(?:\.(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?))*$/iu.test(value.hostname) ||
      isPrivateHost(value.hostname) ||
      typeof value.path !== "string" || value.path.length > 512 || !value.path.startsWith("/") ||
      /[?#]/u.test(value.path) || hasUnsafeUrlCharacter(value.path) ||
      !["privacy", "cookies", "terms", "legal"].includes(String(value.kind))) return false;
  return true;
}

function isPrivateHost(hostname: string): boolean {
  const normalized = hostname.toLowerCase().replace(/\.$/u, "");
  return normalized === "localhost" || [
    ".localhost", ".local", ".internal", ".test", ".invalid", ".example",
    ".home.arpa", ".onion", ".lan", ".home", ".corp", ".intranet", ".private",
  ].some((suffix) => normalized.endsWith(suffix));
}

function hasUnsafeUrlCharacter(value: string): boolean {
  return Array.from(value).some((character) => {
    const code = character.codePointAt(0) ?? 0;
    return code <= 0x20 || code === 0x7f;
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype;
}

function exactKeys(value: Record<string, unknown>, keys: readonly string[], optionalKeys: readonly string[] = []): boolean {
  const allKeys = [...keys, ...optionalKeys];
  return Reflect.ownKeys(value).every((key) => typeof key === "string" && allKeys.includes(key)) &&
    keys.every((key) => Object.hasOwn(value, key)) &&
    Reflect.ownKeys(value).length >= keys.length &&
    Reflect.ownKeys(value).length <= allKeys.length;
}
