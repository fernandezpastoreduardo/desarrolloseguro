import { describe, expect, it } from "vitest";
import { parsePrivacyBrowserObservation, PRIVACY_BROWSER_MAX_RESPONSE_BYTES } from "./privacy-browser-contract.js";

const EXPECTED = { requestId: "123e4567-e89b-42d3-a456-426614174000", hostname: "talentoypersonas.com" };

describe("privacy browser response contract", () => {
  it("allows the full evidence payload produced by a high-request site", () => {
    expect(PRIVACY_BROWSER_MAX_RESPONSE_BYTES).toBeGreaterThan(260_819);
    expect(parsePrivacyBrowserObservation(makeObservation(), EXPECTED).status).toBe("partial");
  });

  it("reports the dedicated size error instead of treating its envelope as an observation", () => {
    expect(() => parsePrivacyBrowserObservation({
      protocolVersion: 1,
      requestId: EXPECTED.requestId,
      hostname: EXPECTED.hostname,
      status: "unknown",
      code: "privacy_browser_output_too_large",
    }, EXPECTED)).toThrow("executor_response_too_large");
  });

  it("rejects an incomplete observation before assessor code can throw", () => {
    expect(() => parsePrivacyBrowserObservation({ ...makeObservation(), reject: {} }, EXPECTED))
      .toThrow("executor_response_invalid");
  });
});

function makeObservation() {
  const flow = {
    phaseEvidence: { beforeChoice: null, afterChoice: null, afterReload: null, networkRequests: [] },
    cookiesAfterChoice: [],
    storageKeysAfterChoice: [],
    signalHostsAfterChoice: [],
    completedHostsAfterChoice: [],
  };
  return {
    protocolVersion: 1,
    ...EXPECTED,
    status: "partial",
    initial: flow,
    accept: flow,
    reject: flow,
    vendorControls: [],
    thirdPartyRequestHosts: [],
  };
}
