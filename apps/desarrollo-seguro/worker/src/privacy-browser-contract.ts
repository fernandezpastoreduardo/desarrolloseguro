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
      !Array.isArray(value.vendorControls) || !Array.isArray(value.thirdPartyRequestHosts)) {
    throw new Error("executor_response_invalid");
  }
  return value as unknown as PrivacyBrowserObservation;
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
