import { describe, expect, it } from "vitest";
import { identifyUnattributedProviderDestination } from "./provider-destination-identity.js";

describe("unattributed provider destination identity", () => {
  it("creates stable, bounded IDs and keeps the hostname as the display evidence", () => {
    const first = identifyUnattributedProviderDestination("CDN.Example.net.");
    const second = identifyUnattributedProviderDestination("cdn.example.net");

    expect(first).toEqual(second);
    expect(first.providerId).toMatch(/^dst_[a-z0-9_]{1,27}$/u);
    expect(first.providerId.length).toBeLessThanOrEqual(32);
    expect(first.hostname).toBe("cdn.example.net");
    expect(first.displayName).toBe("Destino externo cdn.example.net");
  });

  it("does not use the host as an attributed company name", () => {
    const identity = identifyUnattributedProviderDestination("analytics.example.net");
    expect(identity.displayName).toContain("Destino externo");
    expect(identity.displayName).not.toBe("Analytics");
  });
});
