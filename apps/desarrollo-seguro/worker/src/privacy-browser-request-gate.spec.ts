import { describe, expect, it } from "vitest";
import { isThirdPartyPrivacyHost } from "@desarrolloseguro/core";
import { PrivacyBrowserRequestGate } from "./privacy-browser-request-gate.js";

function createGate(maxRequests = 10) {
  return new PrivacyBrowserRequestGate({
    requestedHostname: "grumphya.com",
    isThirdPartyHost: isThirdPartyPrivacyHost,
    maxRequests,
  });
}

describe("privacy browser request gate", () => {
  it("allows only public HTTP(S) reads by default", () => {
    const gate = createGate();

    expect(gate.inspect("https://cdn.example.net/app.js", "GET")).toMatchObject({ allowed: true, thirdParty: true });
    expect(gate.inspect("https://www.grumphya.com/app.js", "GET")).toMatchObject({ allowed: true, thirdParty: false });
    expect(gate.inspect("https://127.0.0.1/admin", "GET").reason).toBe("target_blocked");
    expect(gate.inspect("file:///etc/passwd", "GET").reason).toBe("target_blocked");
  });

  it("classifies and blocks a WebSocket while preserving its third-party hostname", () => {
    const decision = createGate().inspect("wss://tracker.example.net/socket", "WEBSOCKET");
    expect(decision).toMatchObject({ allowed: false, hostname: "tracker.example.net", thirdParty: true, reason: "method_blocked" });
  });

  it("allows at most one POST in the explicit preference-write window", () => {
    const gate = createGate();

    expect(gate.inspect("https://grumphya.com/consent", "POST").reason).toBe("method_blocked");
    gate.armPreferenceWrite();
    expect(gate.inspect("https://cmp.example.net/preferences", "OPTIONS").reason).toBe("allowed_preference_preflight");
    expect(gate.inspect("https://cmp.example.net/preferences", "POST").reason).toBe("allowed_preference_write");
    expect(gate.inspect("https://cmp.example.net/preferences", "POST").reason).toBe("method_blocked");
    expect(gate.inspect("https://grumphya.com/consent", "DELETE").reason).toBe("method_blocked");
  });

  it("counts blocked attempts and marks exhausted coverage", () => {
    const gate = createGate(2);
    gate.inspect("https://grumphya.com/", "GET");
    gate.inspect("https://private.local/", "GET");
    expect(gate.inspect("https://third.example.net/", "GET").reason).toBe("request_budget_exceeded");
    expect(gate.getRequestCount()).toBe(3);
    expect(gate.hasExceededBudget()).toBe(true);
  });

  it("expires a preference-write permission shortly after the explicit click", () => {
    let now = 1_000;
    const gate = new PrivacyBrowserRequestGate({
      requestedHostname: "grumphya.com",
      isThirdPartyHost: isThirdPartyPrivacyHost,
      maxRequests: 10,
      preferenceWriteWindowMs: 1_000,
      now: () => now,
    });
    gate.armPreferenceWrite();
    now += 1_001;

    expect(gate.inspect("https://grumphya.com/consent", "POST").reason).toBe("method_blocked");
  });
});
