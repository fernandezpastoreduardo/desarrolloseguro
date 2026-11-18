const HASH = /^sha256:[a-f0-9]{64}$/u;
const MAX_PACKAGES = 10_000;

export type InternalDependencyInventory = {
  observedAt: string;
  inventoryDigest: string;
  packageCount: number;
  vulnerablePackageCount: number;
  highRiskCount: number;
  criticalRiskCount: number;
};

export function parseInternalDependencyInventory(input: unknown): InternalDependencyInventory {
  const requiredKeys = [
    "observedAt",
    "inventoryDigest",
    "packageCount",
    "vulnerablePackageCount",
    "highRiskCount",
    "criticalRiskCount",
  ] as const;
  if (!isRecord(input) || !hasExactKeys(input, requiredKeys)) {
    throw new Error("internal_dependency_inventory_invalid");
  }
  const observedAt = input.observedAt;
  const inventoryDigest = input.inventoryDigest;
  const packageCount = input.packageCount;
  const vulnerablePackageCount = input.vulnerablePackageCount;
  const highRiskCount = input.highRiskCount;
  const criticalRiskCount = input.criticalRiskCount;
  if (
    typeof observedAt !== "string" ||
    !isIsoDate(observedAt) ||
    typeof inventoryDigest !== "string" ||
    !HASH.test(inventoryDigest) ||
    !isBoundedCount(packageCount) ||
    !isBoundedCount(vulnerablePackageCount) ||
    !isBoundedCount(highRiskCount) ||
    !isBoundedCount(criticalRiskCount) ||
    vulnerablePackageCount > packageCount ||
    highRiskCount > vulnerablePackageCount ||
    criticalRiskCount > highRiskCount
  ) {
    throw new Error("internal_dependency_inventory_invalid");
  }
  return {
    observedAt,
    inventoryDigest,
    packageCount,
    vulnerablePackageCount,
    highRiskCount,
    criticalRiskCount,
  };
}

function isBoundedCount(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 && value <= MAX_PACKAGES;
}

function isIsoDate(value: string): boolean {
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) && new Date(timestamp).toISOString() === value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasExactKeys(value: Record<string, unknown>, required: readonly string[]): boolean {
  const keys = Object.keys(value).sort();
  return keys.length === required.length && required.every((key) => keys.includes(key));
}
