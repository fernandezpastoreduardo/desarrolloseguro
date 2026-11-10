import { describe, expect, it } from "vitest";
import { parseTransportV1EgressBrokerStartupRequest } from "./transport-v1-egress-broker-startup.js";

describe("parseTransportV1EgressBrokerStartupRequest", () => {
  it("normalizes the per-job hostname and accepts only the fixed profile", () => {
    expect(
      parseTransportV1EgressBrokerStartupRequest({
        protocolVersion: 1,
        hostname: "EXAMPLE.org.",
        profileVersion: "transport-v1",
      }),
    ).toEqual({
      protocolVersion: 1,
      hostname: "example.org",
      profileVersion: "transport-v1",
    });
  });

  it.each([
    null,
    [],
    { protocolVersion: 2, hostname: "example.org", profileVersion: "transport-v1" },
    { protocolVersion: 1, hostname: "example.org", profileVersion: "controls-v1" },
    { protocolVersion: 1, hostname: "127.0.0.1", profileVersion: "transport-v1" },
    { protocolVersion: 1, hostname: "example.org", profileVersion: "transport-v1", port: 443 },
  ])("rejects malformed or expanded startup scope", (input) => {
    expect(() => parseTransportV1EgressBrokerStartupRequest(input)).toThrow(
      "egress_broker_startup_invalid",
    );
  });
});
