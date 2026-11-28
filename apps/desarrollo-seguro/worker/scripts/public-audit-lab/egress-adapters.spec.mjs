import { describe, expect, it } from "vitest";
import { createLabEgressAdapters } from "./egress-adapters.mjs";

const hostname = "scan-12345678-1234-1234-1234-123456789abc.example.net";
const fixtureAddress = "172.28.0.4";
const certificatePem = "-----BEGIN CERTIFICATE-----\nfixture-cert-for-guard-tests\n-----END CERTIFICATE-----";

describe("public audit lab egress adapters", () => {
  it("resolves only the run-specific synthetic hostname", async () => {
    const adapters = createLabEgressAdapters({ hostname, fixtureAddress, certificatePem });

    expect(await adapters.dnsResolver(hostname)).toEqual([
      { address: adapters.syntheticAddress, family: 4 },
    ]);
    await expect(adapters.dnsResolver("other.example.net")).rejects.toThrow("lab_egress_hostname_blocked");
  });

  it("rejects non-synthetic names and fixture endpoints at construction", () => {
    expect(() => createLabEgressAdapters({ hostname: "talentoypersonas.com", fixtureAddress, certificatePem }))
      .toThrow("lab_egress_hostname_invalid");
    expect(() => createLabEgressAdapters({ hostname, fixtureHost: "127.0.0.1", fixtureAddress, certificatePem }))
      .toThrow("lab_fixture_host_invalid");
    expect(() => createLabEgressAdapters({ hostname, httpsPort: 0, fixtureAddress, certificatePem }))
      .toThrow("lab_fixture_port_invalid");
    expect(() => createLabEgressAdapters({ hostname, fixtureAddress: "203.0.113.9", certificatePem }))
      .toThrow("lab_fixture_address_invalid");
  });

  it("allows requests only for the exact host, scheme, port, and query-bearing path", () => {
    const adapters = createLabEgressAdapters({ hostname, fixtureAddress, certificatePem });
    const options = {
      hostname,
      port: 443,
      protocol: "https:",
      path: "/consent?case=synthetic",
      method: "GET",
      headers: { host: hostname },
    };

    expect(() => adapters.httpsRequestFactory({ ...options, hostname: "other.example.net" }, () => {}))
      .toThrow("lab_egress_request_blocked");
    expect(() => adapters.httpsRequestFactory({ ...options, port: 8443 }, () => {}))
      .toThrow("lab_egress_request_blocked");
    expect(() => adapters.httpsRequestFactory({ ...options, path: "/consent?case=x#fragment" }, () => {}))
      .toThrow("lab_egress_request_blocked");
    expect(() => adapters.httpRequestFactory({ ...options, protocol: "http:", port: 443 }, () => {}))
      .toThrow("lab_egress_request_blocked");
  });

  it("maps only the synthetic address and web ports to the internal fixture", () => {
    const adapters = createLabEgressAdapters({ hostname, fixtureAddress, certificatePem });
    expect(() => adapters.connectPinned("127.0.0.1", 443)).toThrow("lab_egress_destination_blocked");
    expect(() => adapters.connectPinned(adapters.syntheticAddress, 22)).toThrow("lab_egress_destination_blocked");
  });
});
