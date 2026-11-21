import { describe, expect, it } from "vitest";
import {
  authorizePrivacyTarget,
  isPublicIpv4,
  resolvePinnedPublicIpv4,
} from "./privacy-egress-policy.js";

describe("privacy egress policy", () => {
  it("accepts only public HTTP(S) host targets on web ports", () => {
    expect(authorizePrivacyTarget("https://www.example.net/path?x=1").hostname).toBe("www.example.net");
    expect(authorizePrivacyTarget("http://example.net:80/").port).toBe(80);
    expect(() => authorizePrivacyTarget("ftp://example.net/")).toThrow("privacy_target_scheme_blocked");
    expect(() => authorizePrivacyTarget("https://example.net:8443/")).toThrow("privacy_target_port_blocked");
    expect(() => authorizePrivacyTarget("https://user:pass@example.net/")).toThrow("privacy_target_invalid");
    expect(() => authorizePrivacyTarget("https://127.0.0.1/")).toThrow("privacy_target_hostname_blocked");
    expect(() => authorizePrivacyTarget("https://service.local/")).toThrow("privacy_target_hostname_blocked");
  });

  it("blocks private, special-use and non-IPv4 destinations", () => {
    for (const address of [
      "0.0.0.0", "10.1.2.3", "100.64.0.1", "127.0.0.1", "169.254.169.254",
      "172.16.0.1", "192.0.2.1", "192.168.1.1", "198.18.0.1", "203.0.113.10",
      "224.0.0.1", "240.0.0.1", "::1", "not-an-ip",
    ]) {
      expect(isPublicIpv4(address), address).toBe(false);
    }
    expect(isPublicIpv4("1.1.1.1")).toBe(true);
    expect(isPublicIpv4("8.8.8.8")).toBe(true);
  });

  it("pins one public IPv4 address from a single DNS resolution", async () => {
    const lookups: string[] = [];
    await expect(resolvePinnedPublicIpv4("example.net", async (hostname) => {
      lookups.push(hostname);
      return [{ address: "8.8.8.8", family: 4 }, { address: "2001:4860:4860::8888", family: 6 }];
    })).resolves.toBe("8.8.8.8");
    expect(lookups).toEqual(["example.net"]);
  });

  it("rejects mixed public/private DNS answers to prevent rebinding", async () => {
    await expect(resolvePinnedPublicIpv4("rebind.example.net", async () => [
      { address: "8.8.8.8", family: 4 },
      { address: "169.254.169.254", family: 4 },
    ])).rejects.toThrow("privacy_dns_address_blocked");
  });

  it("rejects IPv6-only answers until IPv6 egress can be independently contained", async () => {
    await expect(resolvePinnedPublicIpv4("ipv6-only.example.net", async () => [
      { address: "2001:4860:4860::8888", family: 6 },
    ])).rejects.toThrow("privacy_dns_address_blocked");
  });
});
