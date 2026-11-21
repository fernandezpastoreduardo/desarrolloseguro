export const PRIVACY_POLICY_VERSION = "privacy-v1" as const;

export const PRIVACY_CRITERIA = [
  { id: "preference-before-tracking", label: "Actividad antes de elegir", weight: 30 },
  { id: "contextual-excess", label: "Exceso y redundancia", weight: 10 },
  { id: "choice-parity", label: "Visibilidad de aceptar y rechazar", weight: 20 },
  { id: "rejection-persistence", label: "Eficacia del rechazo y persistencia", weight: 20 },
  { id: "vendor-controls", label: "Controles de proveedores", weight: 20 },
] as const;

export const PRIVACY_SEVERITY_FACTOR = {
  low: 0.25,
  medium: 0.5,
  high: 1,
} as const;

export const PRIVACY_EXCESS_THRESHOLDS = {
  cookiesPerProviderAndPurpose: 5,
  cookiesPerPurpose: 10,
} as const;

export const PRIVACY_BROWSER_BUDGET = {
  durationMs: 120_000,
  requests: 300,
  receivedBytes: 20 * 1024 * 1024,
  individualProviders: 30,
  contexts: 8,
} as const;

export type PrivacyCriterionId = (typeof PRIVACY_CRITERIA)[number]["id"];
export type PrivacySeverity = keyof typeof PRIVACY_SEVERITY_FACTOR;
export type PrivacyCoverageStatus = "evaluated" | "unknown" | "not_applicable";

/** Treats only the explicit www alias as the same site; other hosts remain third parties. */
export function isThirdPartyPrivacyHost(requestedHostname: string, observedHostname: string): boolean {
  const requested = normalizeOwnershipHostname(requestedHostname);
  const observed = normalizeOwnershipHostname(observedHostname);
  return requested.length === 0 || observed.length === 0 || requested !== observed;
}

function normalizeOwnershipHostname(hostname: string): string {
  let normalized = hostname.trim().toLowerCase();
  while (normalized.startsWith(".")) normalized = normalized.slice(1);
  while (normalized.endsWith(".")) normalized = normalized.slice(0, -1);
  return normalized.startsWith("www.") ? normalized.slice(4) : normalized;
}
