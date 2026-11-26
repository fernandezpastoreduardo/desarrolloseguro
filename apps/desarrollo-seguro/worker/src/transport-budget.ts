export type TransportProfileVersion =
  | "transport-v1"
  | "domain-v1"
  | "domain-v2"
  | "domain-v3"
  | "domain-v4"
  | "domain-v5";

export type TransportBudget = {
  maxRequests: number;
  maxBytes: number;
  maxDurationMs: number;
};

const DEFAULT_BUDGET: TransportBudget = {
  maxRequests: 24,
  maxBytes: 2 * 1024 * 1024,
  maxDurationMs: 35_000,
};

const DOMAIN_V4_BUDGET: TransportBudget = {
  maxRequests: 64,
  maxBytes: 4 * 1024 * 1024,
  maxDurationMs: 120_000,
};

/** Gives public-policy profiles their separately approved network budget. */
export function getTransportBudget(profileVersion: string): TransportBudget {
  return profileVersion === "domain-v4" || profileVersion === "domain-v5" ? DOMAIN_V4_BUDGET : DEFAULT_BUDGET;
}
