import { authorizePrivacyTarget } from "./privacy-egress-policy.js";

export type PrivacyBrowserRequestDecision = {
  allowed: boolean;
  hostname: string | null;
  thirdParty: boolean | null;
  reason: "allowed_read" | "allowed_preference_preflight" | "allowed_preference_write" | "request_budget_exceeded" | "target_blocked" | "method_blocked";
};

export type PrivacyBrowserRequestGateOptions = {
  requestedHostname: string;
  isThirdPartyHost: (requestedHostname: string, observedHostname: string) => boolean;
  maxRequests: number;
  preferenceWriteWindowMs?: number;
  now?: () => number;
};

/** Enforces the browser-level request budget and the consent-only write window. */
export class PrivacyBrowserRequestGate {
  private requests = 0;
  private allowedPreferenceWrites = 0;
  private preferenceWriteUntil = 0;
  private budgetExceeded = false;

  constructor(private readonly options: PrivacyBrowserRequestGateOptions) {
    if (!Number.isSafeInteger(options.maxRequests) || options.maxRequests < 1) {
      throw new Error("privacy_request_gate_configuration_invalid");
    }
    const writeWindowMs = options.preferenceWriteWindowMs ?? 5_000;
    if (!Number.isSafeInteger(writeWindowMs) || writeWindowMs < 1 || writeWindowMs > 30_000) {
      throw new Error("privacy_request_gate_configuration_invalid");
    }
  }

  armPreferenceWrite(): void {
    this.preferenceWriteUntil = this.currentTime() + (this.options.preferenceWriteWindowMs ?? 5_000);
  }

  disarmPreferenceWrite(): void {
    this.preferenceWriteUntil = 0;
  }

  inspect(urlInput: string, methodInput: string): PrivacyBrowserRequestDecision {
    this.requests += 1;
    if (this.requests > this.options.maxRequests) {
      this.budgetExceeded = true;
      this.preferenceWriteUntil = 0;
      return decision(false, null, null, "request_budget_exceeded");
    }

    const method = methodInput.toUpperCase();
    const preferenceWriteArmed = this.preferenceWriteUntil > this.currentTime();
    if (method === "POST") this.preferenceWriteUntil = 0;

    let target;
    try {
      const targetInput = urlInput.startsWith("wss://")
        ? `https://${urlInput.slice(6)}`
        : urlInput.startsWith("ws://")
          ? `http://${urlInput.slice(5)}`
          : urlInput;
      target = authorizePrivacyTarget(targetInput);
    } catch {
      return decision(false, null, null, "target_blocked");
    }

    const thirdParty = this.options.isThirdPartyHost(this.options.requestedHostname, target.hostname);
    if (method === "GET" || method === "HEAD") {
      return decision(true, target.hostname, thirdParty, "allowed_read");
    }
    if (method === "OPTIONS" && preferenceWriteArmed) {
      return decision(true, target.hostname, thirdParty, "allowed_preference_preflight");
    }
    if (method === "POST" && preferenceWriteArmed) {
      this.allowedPreferenceWrites += 1;
      return decision(true, target.hostname, thirdParty, "allowed_preference_write");
    }
    return decision(false, target.hostname, thirdParty, "method_blocked");
  }

  getRequestCount(): number {
    return this.requests;
  }

  hasExceededBudget(): boolean {
    return this.budgetExceeded;
  }

  getAllowedPreferenceWrites(): number {
    return this.allowedPreferenceWrites;
  }

  private currentTime(): number {
    return this.options.now?.() ?? Date.now();
  }
}

function decision(
  allowed: boolean,
  hostname: string | null,
  thirdParty: boolean | null,
  reason: PrivacyBrowserRequestDecision["reason"],
): PrivacyBrowserRequestDecision {
  return { allowed, hostname, thirdParty, reason };
}
