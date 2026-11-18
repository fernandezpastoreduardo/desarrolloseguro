const EXPOSURES = ["public", "internal", "none", "unknown"] as const;
const PRIVILEGES = ["restricted", "rootless", "unknown"] as const;
const TRANSPORTS = ["tls_verified", "internal_tls_verified", "not_applicable", "unknown"] as const;
const MAX_SERVICES = 32;
const SAFE_NAME = /^[a-z0-9](?:[a-z0-9._-]{0,62}[a-z0-9])?$/u;
const SHA256 = /^sha256:[a-f0-9]{64}$/u;

export type InternalInfrastructureService = {
  name: string;
  imageDigest: string;
  exposure: (typeof EXPOSURES)[number];
  privilege: (typeof PRIVILEGES)[number];
  transport: (typeof TRANSPORTS)[number];
};

export type InternalInfrastructureSnapshot = {
  observedAt: string;
  snapshotHash: string;
  services: readonly InternalInfrastructureService[];
};

export function parseInternalInfrastructureSnapshot(
  input: unknown,
): InternalInfrastructureSnapshot {
  if (!isRecord(input) || !hasExactKeys(input, ["observedAt", "snapshotHash", "services"])) {
    throw new Error("internal_infrastructure_snapshot_invalid");
  }
  const observedAt = input.observedAt;
  const snapshotHash = input.snapshotHash;
  const services = input.services;
  if (
    typeof observedAt !== "string" ||
    !isIsoDate(observedAt) ||
    typeof snapshotHash !== "string" ||
    !/^[a-f0-9]{64}$/u.test(snapshotHash) ||
    !Array.isArray(services) ||
    services.length === 0 ||
    services.length > MAX_SERVICES
  ) {
    throw new Error("internal_infrastructure_snapshot_invalid");
  }
  const parsedServices = services.map(parseService);
  if (new Set(parsedServices.map((service) => service.name)).size !== parsedServices.length) {
    throw new Error("internal_infrastructure_snapshot_invalid");
  }
  return { observedAt, snapshotHash, services: parsedServices };
}

function parseService(input: unknown): InternalInfrastructureService {
  if (!isRecord(input) || !hasExactKeys(input, ["name", "imageDigest", "exposure", "privilege", "transport"])) {
    throw new Error("internal_infrastructure_snapshot_invalid");
  }
  const name = input.name;
  const imageDigest = input.imageDigest;
  const exposure = input.exposure;
  const privilege = input.privilege;
  const transport = input.transport;
  if (
    typeof name !== "string" ||
    !SAFE_NAME.test(name) ||
    typeof imageDigest !== "string" ||
    !SHA256.test(imageDigest) ||
    !isOneOf(EXPOSURES, exposure) ||
    !isOneOf(PRIVILEGES, privilege) ||
    !isOneOf(TRANSPORTS, transport)
  ) {
    throw new Error("internal_infrastructure_snapshot_invalid");
  }
  return { name, imageDigest, exposure, privilege, transport };
}

function isOneOf<const T extends readonly string[]>(values: T, value: unknown): value is T[number] {
  return typeof value === "string" && values.includes(value);
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
