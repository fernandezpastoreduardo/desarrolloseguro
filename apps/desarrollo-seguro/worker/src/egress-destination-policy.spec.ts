import type { LookupAddress } from "node:dns";
import { describe, expect, it, vi } from "vitest";
import { createEgressDestinationAuthorizer } from "./egress-destination-policy.js";

const HOSTNAME = "sample.example.net";
const PUBLIC_IPV4: LookupAddress = { address: "93.184.216.34", family: 4 };
const PUBLIC_IPV6: LookupAddress = {
  address: "2606:4700:4700::1111",
  family: 6,
};

describe("createEgressDestinationAuthorizer", () => {
  it("authorizes the exact job hostname on HTTP and HTTPS and returns pinned addresses", async () => {
    const resolver = vi.fn().mockResolvedValue([PUBLIC_IPV4, PUBLIC_IPV6]);
    const authorize = createEgressDestinationAuthorizer(
      ` ${HOSTNAME.toUpperCase()}. `,
      resolver,
    );

    await expect(
      authorize({ hostname: HOSTNAME, port: 443 }),
    ).resolves.toEqual([PUBLIC_IPV4, PUBLIC_IPV6]);
    await expect(
      authorize({ hostname: HOSTNAME, port: 80 }),
    ).resolves.toEqual([PUBLIC_IPV4, PUBLIC_IPV6]);
    expect(resolver).toHaveBeenCalledTimes(2);
    expect(resolver).toHaveBeenNthCalledWith(1, HOSTNAME);
    expect(resolver).toHaveBeenNthCalledWith(2, HOSTNAME);
  });

  it.each([
    ["different hostname", { hostname: "other.example.net", port: 443 }],
    ["subdomain", { hostname: `child.${HOSTNAME}`, port: 443 }],
    ["alternate port", { hostname: HOSTNAME, port: 8080 }],
    ["string port", { hostname: HOSTNAME, port: "443" }],
    ["extra fields", { hostname: HOSTNAME, port: 443, path: "/admin" }],
    ["URL instead of hostname", { hostname: `https://${HOSTNAME}`, port: 443 }],
    ["malformed destination", null],
  ])("denies %s without resolving it", async (_label, destination) => {
    const resolver = vi.fn().mockResolvedValue([PUBLIC_IPV4]);
    const authorize = createEgressDestinationAuthorizer(HOSTNAME, resolver);

    await expect(authorize(destination)).rejects.toThrow(
      "egress_destination_denied",
    );
    expect(resolver).not.toHaveBeenCalled();
  });

  it("denies inherited and symbol properties in destination records", async () => {
    const resolver = vi.fn().mockResolvedValue([PUBLIC_IPV4]);
    const authorize = createEgressDestinationAuthorizer(HOSTNAME, resolver);
    const inherited = Object.assign(
      Object.create({ scope: "foreign" }) as object,
      { hostname: HOSTNAME, port: 443 },
    );
    const withSymbol = {
      hostname: HOSTNAME,
      port: 443,
      [Symbol("extra")]: "unexpected",
    };

    await expect(authorize(inherited)).rejects.toThrow(
      "egress_destination_denied",
    );
    await expect(authorize(withSymbol)).rejects.toThrow(
      "egress_destination_denied",
    );
    expect(resolver).not.toHaveBeenCalled();
  });

  it("denies the whole destination when DNS returns a private or mixed answer", async () => {
    const resolver = vi
      .fn()
      .mockResolvedValueOnce([{ address: "127.0.0.1", family: 4 }])
      .mockResolvedValueOnce([
        PUBLIC_IPV4,
        { address: "10.0.0.8", family: 4 },
      ]);
    const authorize = createEgressDestinationAuthorizer(HOSTNAME, resolver);

    await expect(
      authorize({ hostname: HOSTNAME, port: 443 }),
    ).rejects.toThrow("egress_destination_denied");
    await expect(
      authorize({ hostname: HOSTNAME, port: 443 }),
    ).rejects.toThrow("egress_destination_denied");
    expect(resolver).toHaveBeenCalledTimes(2);
  });

  it("denies a later DNS rebinding answer and does not expose resolver errors", async () => {
    const resolver = vi
      .fn()
      .mockResolvedValueOnce([PUBLIC_IPV4])
      .mockResolvedValueOnce([{ address: "127.0.0.1", family: 4 }]);
    const authorize = createEgressDestinationAuthorizer(HOSTNAME, resolver);

    await expect(
      authorize({ hostname: HOSTNAME, port: 443 }),
    ).resolves.toEqual([PUBLIC_IPV4]);
    await expect(
      authorize({ hostname: HOSTNAME, port: 443 }),
    ).rejects.toThrow("egress_destination_denied");
  });
});
