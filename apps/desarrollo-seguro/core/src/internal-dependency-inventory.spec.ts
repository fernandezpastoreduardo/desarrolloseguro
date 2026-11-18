import { describe, expect, it } from "vitest";
import { parseInternalDependencyInventory } from "./internal-dependency-inventory.js";

const validInventory = {
  observedAt: "2026-11-18T19:00:00.000Z",
  inventoryDigest: `sha256:${"a".repeat(64)}`,
  packageCount: 42,
  vulnerablePackageCount: 0,
  highRiskCount: 0,
  criticalRiskCount: 0,
};

describe("internal dependency inventory", () => {
  it("accepts a bounded aggregate inventory", () => {
    expect(parseInternalDependencyInventory(validInventory)).toEqual(validInventory);
  });

  it.each([
    { packages: [{ name: "private-package", version: "1.0.0" }] },
    { sbom: "full sbom" },
    { packageCount: 10_001 },
    { criticalRiskCount: -1 },
    { inventoryDigest: "sha256:short" },
  ])("rejects package details or invalid counts: %o", (override) => {
    expect(() => parseInternalDependencyInventory({ ...validInventory, ...override }))
      .toThrow("internal_dependency_inventory_invalid");
  });

  it("rejects risk counters that exceed the package count", () => {
    expect(() => parseInternalDependencyInventory({
      ...validInventory,
      vulnerablePackageCount: 43,
    })).toThrow("internal_dependency_inventory_invalid");
  });
});
