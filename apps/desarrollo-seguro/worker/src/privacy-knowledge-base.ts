export const PRIVACY_KNOWLEDGE_BASE_VERSION = "privacy-knowledge-v1" as const;

export type PrivacySignalType = "cookie_name" | "storage_key" | "request_host" | "script_url" | "cmp_vendor";
export type PrivacyRuleMatch = "exact" | "prefix";
export type PrivacyRuleConfidence = "high" | "medium" | "low";
export type PrivacyRuleCategory = "analytics" | "advertising" | "social" | "consent" | "other";

export type PrivacyKnowledgeRule = {
  ruleId: string;
  datasetVersion: string;
  signalType: PrivacySignalType;
  pattern: string;
  match: PrivacyRuleMatch;
  category: PrivacyRuleCategory;
  provider: string;
  providerHostnames: readonly string[];
  purpose: string;
  source: {
    url: string;
    revision: string;
    license: string;
    reviewedAt: string;
  };
  confidence: PrivacyRuleConfidence;
  knownFalsePositives: readonly string[];
};

export type PrivacyObservedSignal = {
  signalType: PrivacySignalType;
  value: string;
  observedHostname: string;
  corroboratingHostnames?: readonly string[];
};

export type PrivacyKnowledgeMatch = {
  ruleId: string;
  category: PrivacyRuleCategory;
  provider: string;
  purpose: string;
  confidence: PrivacyRuleConfidence;
  classification: "confirmed" | "unknown";
  source: PrivacyKnowledgeRule["source"];
};

/** Matches only reviewed literal or anchored-prefix rules; there is no regex execution. */
export function matchPrivacySignal(
  signal: PrivacyObservedSignal,
  rules: readonly PrivacyKnowledgeRule[],
): PrivacyKnowledgeMatch[] {
  const candidates = rules.filter((rule) => matchesRule(signal, rule));
  if (candidates.length === 0) return [];

  const hasConflict = new Set(candidates.map(({ category, provider }) => `${category}\0${provider}`)).size > 1;
  return candidates.map((rule) => ({
    ruleId: rule.ruleId,
    category: rule.category,
    provider: rule.provider,
    purpose: rule.purpose,
    confidence: rule.confidence,
    classification: !hasConflict && rule.confidence === "high" && hasProviderHostnameMatch(signal, rule)
      ? "confirmed"
      : "unknown",
    source: rule.source,
  }));
}

function matchesRule(signal: PrivacyObservedSignal, rule: PrivacyKnowledgeRule): boolean {
  if (signal.signalType !== rule.signalType || rule.pattern.length === 0) return false;
  const value = normalizeSignalValue(signal.signalType, signal.value);
  const pattern = normalizeSignalValue(rule.signalType, rule.pattern);
  if (!value || !pattern) return false;
  if (rule.match === "exact") return value === pattern;
  if (signal.signalType === "request_host" || signal.signalType === "script_url") {
    return value.endsWith(`.${pattern}`);
  }
  return value.startsWith(pattern);
}

function hasProviderHostnameMatch(signal: PrivacyObservedSignal, rule: PrivacyKnowledgeRule): boolean {
  const observed = [signal.observedHostname, ...(signal.corroboratingHostnames ?? [])]
    .map(normalizeHostname)
    .filter(Boolean);
  if (observed.length === 0) return false;
  return rule.providerHostnames.some((hostname) => {
    const expected = normalizeHostname(hostname);
    return expected !== "" && observed.some((observedHostname) =>
      observedHostname === expected || observedHostname.endsWith(`.${expected}`),
    );
  });
}

function normalizeSignalValue(type: PrivacySignalType, value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return "";
  if (type === "request_host") return normalizeHostname(trimmed);
  if (type === "script_url") {
    try {
      return normalizeHostname(new URL(trimmed).hostname);
    } catch {
      return normalizeHostname(trimmed);
    }
  }
  return type === "cmp_vendor" ? trimmed.toLowerCase() : trimmed;
}

function normalizeHostname(value: string): string {
  let normalized = value.trim().toLowerCase();
  while (normalized.startsWith(".")) normalized = normalized.slice(1);
  while (normalized.endsWith(".")) normalized = normalized.slice(0, -1);
  return normalized;
}
