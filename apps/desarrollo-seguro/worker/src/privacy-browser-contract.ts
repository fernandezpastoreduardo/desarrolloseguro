import type { PrivacyBrowserObservation } from "./privacy-browser-observer.js";
import type { PerformanceDiagnosticCode, PerformanceDiagnosticField } from "./performance-browser-observer.js";

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
    const baseKeys = ["profile", "status", "fcpMs", "speedIndexMs", "lcpMs", "cls", "tbtMs", "ttfbMs", "transferBytes", "score"];
    if (!isRecord(profile) || Object.keys(profile).some((key) => !baseKeys.includes(key) && key !== "diagnostic") ||
        baseKeys.some((key) => !Object.hasOwn(profile, key)) ||
        profile.profile !== (index === 0 ? "mobile" : "desktop") ||
        (profile.status !== "complete" && profile.status !== "unknown")) return false;
    if (profile.diagnostic !== undefined && !isPerformanceDiagnostic(profile.diagnostic)) return false;
    const keys = ["fcpMs", "speedIndexMs", "lcpMs", "cls", "tbtMs", "ttfbMs", "transferBytes", "score"];
    if (keys.some((key) => profile[key] !== null &&
        (typeof profile[key] !== "number" || !Number.isFinite(profile[key]) || (profile[key] as number) < 0))) return false;
    if (profile.cls !== null && (profile.cls as number) > 1) return false;
    if (profile.score !== null && (profile.score as number) > 100) return false;
    return profile.status !== "complete" || keys.filter((key) => index === 0 || key !== "speedIndexMs")
      .every((key) => typeof profile[key] === "number");
  });
}

function isPerformanceDiagnostic(value: unknown): value is { code: PerformanceDiagnosticCode; missingMetrics?: readonly PerformanceDiagnosticField[] } {
  const codes: readonly PerformanceDiagnosticCode[] = ["observation_budget_exhausted", "observation_stopped_early",
    "request_budget_exceeded", "required_measurement_missing", "browser_timeout", "browser_observation_error"];
  const fields: readonly PerformanceDiagnosticField[] = ["fcpMs", "speedIndexMs", "lcpMs", "cls", "tbtMs", "ttfbMs", "transferBytes", "score"];
  if (!isRecord(value) || !codes.includes(value.code as PerformanceDiagnosticCode) ||
      Object.keys(value).some((key) => key !== "code" && key !== "missingMetrics")) return false;
  return value.missingMetrics === undefined || Array.isArray(value.missingMetrics) &&
    value.missingMetrics.every((field) => fields.includes(field as PerformanceDiagnosticField));
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
