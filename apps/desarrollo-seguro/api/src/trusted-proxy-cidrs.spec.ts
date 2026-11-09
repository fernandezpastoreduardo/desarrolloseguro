import { describe, expect, it } from "vitest";
import { parseTrustedProxyCidrs } from "./trusted-proxy-cidrs.js";

const INVALID_CIDRS_ERROR = "invalid_ds_trusted_proxy_cidrs";

describe("parseTrustedProxyCidrs", () => {
  it("does not trust a proxy unless CIDRs are explicitly configured", () => {
    expect(parseTrustedProxyCidrs(undefined)).toEqual([]);
    expect(parseTrustedProxyCidrs("  ")).toEqual([]);
  });

  it("parses explicit IPv4 and IPv6 addresses and networks", () => {
    expect(
      parseTrustedProxyCidrs("127.0.0.1, 172.20.0.0/16, ::1, fd00::/8"),
    ).toEqual(["127.0.0.1", "172.20.0.0/16", "::1", "fd00::/8"]);
  });

  it.each([
    "127.0.0.1,",
    "not-an-ip",
    "0.0.0.0/0",
    "::/0",
    "172.20.0.0/33",
    "fd00::/129",
    "127.0.0.1/24/2",
  ])("rejects invalid proxy configuration %s", (value) => {
    expect(() => parseTrustedProxyCidrs(value)).toThrow(INVALID_CIDRS_ERROR);
  });
});
