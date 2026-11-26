import type { PrivacyBrowserObservation } from "./privacy-browser-observer.js";

export const PRIVACY_BROWSER_MAX_RESPONSE_BYTES = 1024 * 1024;

/** Validates the bounded browser-process response before either assessor reads it. */
export function parsePrivacyBrowserObservation(
  value: unknown,
  expected: { requestId: string; hostname: string },
): PrivacyBrowserObservation {
  if (isRecord(value) && value.code === "privacy_browser_output_too_large") {
    throw new Error("executor_response_too_large");
  }
  if (!isRecord(value) || value.protocolVersion !== 1 || value.requestId !== expected.requestId ||
      value.hostname !== expected.hostname || !["complete", "partial", "unknown"].includes(String(value.status)) ||
      !isFlow(value.initial) || !isFlow(value.accept) || !isFlow(value.reject) ||
      !Array.isArray(value.vendorControls) || !Array.isArray(value.thirdPartyRequestHosts) ||
      (value.performance !== undefined && !isPerformance(value.performance))) {
    throw new Error("executor_response_invalid");
  }
  return value as unknown as PrivacyBrowserObservation;
}

function isPerformance(value: unknown): boolean {
  if (!isRecord(value) || Object.keys(value).length !== 1 || !Array.isArray(value.profiles) || value.profiles.length !== 2) return false;
  return value.profiles.every((profile, index) => {
    if (!isRecord(profile) || Object.keys(profile).length !== 10 ||
        profile.profile !== (index === 0 ? "mobile" : "desktop") ||
        (profile.status !== "complete" && profile.status !== "unknown")) return false;
    const keys = ["fcpMs", "speedIndexMs", "lcpMs", "cls", "tbtMs", "ttfbMs", "transferBytes", "score"];
    if (keys.some((key) => profile[key] !== null &&
        (typeof profile[key] !== "number" || !Number.isFinite(profile[key]) || (profile[key] as number) < 0))) return false;
    if (profile.cls !== null && (profile.cls as number) > 1) return false;
    if (profile.score !== null && (profile.score as number) > 100) return false;
    return profile.status !== "complete" || keys.filter((key) => index === 0 || key !== "speedIndexMs")
      .every((key) => typeof profile[key] === "number");
  });
}

function isFlow(value: unknown): boolean {
  if (!isRecord(value) || !isRecord(value.phaseEvidence) || !Array.isArray(value.phaseEvidence.networkRequests) ||
      !Array.isArray(value.cookiesAfterChoice) || !Array.isArray(value.storageKeysAfterChoice) ||
      !Array.isArray(value.signalHostsAfterChoice) || !Array.isArray(value.completedHostsAfterChoice)) return false;
  const { beforeChoice, afterChoice, afterReload } = value.phaseEvidence;
  return [beforeChoice, afterChoice, afterReload].every((snapshot) => snapshot === null ||
    isRecord(snapshot) && Array.isArray(snapshot.cookies) && Array.isArray(snapshot.storageKeys));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
