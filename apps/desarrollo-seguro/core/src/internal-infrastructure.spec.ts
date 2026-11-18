import { describe, expect, it } from "vitest";
import { parseInternalInfrastructureSnapshot } from "./internal-infrastructure.js";

const validSnapshot = {
  observedAt: "2026-11-18T16:00:00.000Z",
  snapshotHash: "a".repeat(64),
  services: [{
    name: "web",
    imageDigest: `sha256:${"b".repeat(64)}`,
    exposure: "public",
    privilege: "restricted",
    transport: "tls_verified",
  }],
};

describe("internal infrastructure evidence", () => {
  it("accepts a bounded production inventory without sensitive fields", () => {
    expect(parseInternalInfrastructureSnapshot(validSnapshot)).toEqual(validSnapshot);
  });

  it.each([
    { services: [{ ...validSnapshot.services[0], command: "cat secrets" }] },
    { services: [{ ...validSnapshot.services[0], name: "../host" }] },
    { services: [{ ...validSnapshot.services[0], imageDigest: "latest" }] },
    { services: [{ ...validSnapshot.services[0], exposure: "ssh" }] },
    { observedAt: "2026-11-18T16:00:00.000Z", snapshotHash: "bad", services: [] },
  ])("rejects unbounded or unsafe inventory data: %o", (override) => {
    expect(() => parseInternalInfrastructureSnapshot({ ...validSnapshot, ...override }))
      .toThrow("internal_infrastructure_snapshot_invalid");
  });
});
