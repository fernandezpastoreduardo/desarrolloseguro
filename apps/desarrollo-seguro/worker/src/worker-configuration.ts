import { readFileSync } from "node:fs";
import { isAbsolute } from "node:path";

const DATABASE_URL_FILE = "DS_WORKER_DATABASE_URL_FILE";
const COORDINATOR_SOCKET = "DS_RUNTIME_COORDINATOR_SOCKET";
const COORDINATOR_UID = "DS_RUNTIME_COORDINATOR_UID";
const COORDINATOR_GID = "DS_RUNTIME_COORDINATOR_GID";
const PROCESSOR_AUDITOR_SOCKET = "DS_PROCESSOR_AUDITOR_SOCKET";
const PROCESSOR_AUDITOR_UID = "DS_PROCESSOR_AUDITOR_UID";
const PROCESSOR_AUDITOR_GID = "DS_PROCESSOR_AUDITOR_GID";
const IDLE_DELAY = "DS_WORKER_IDLE_DELAY_MS";
const ERROR_DELAY = "DS_WORKER_ERROR_DELAY_MS";
const WORKER_DATABASE_NAME = "/desarrollo_seguro";
const WORKER_DATABASE_ROLE = "ds_worker";
const DEFAULT_IDLE_DELAY_MS = 1_000;
const DEFAULT_ERROR_DELAY_MS = 5_000;
const MAX_WORKER_DELAY_MS = 600_000;
const POSTGRES_PROTOCOLS = new Set(["postgres:", "postgresql:"]);

export type ScanWorkerConfiguration = {
  databaseUrlFile: string;
  coordinatorSocketPath: string;
  coordinatorUid: number;
  coordinatorGid: number;
  processorAuditorSocketPath: string;
  processorAuditorUid: number;
  processorAuditorGid: number;
  idleDelayMs: number;
  errorDelayMs: number;
};

export function resolveScanWorkerConfiguration(
  environment: NodeJS.ProcessEnv,
): ScanWorkerConfiguration {
  const databaseUrlFile = environment[DATABASE_URL_FILE];
  const coordinatorSocketPath = environment[COORDINATOR_SOCKET];
  const coordinatorUid = parseNonNegativeInteger(environment[COORDINATOR_UID]);
  const coordinatorGid = parseNonNegativeInteger(environment[COORDINATOR_GID]);
  const processorAuditorSocketPath = environment[PROCESSOR_AUDITOR_SOCKET] ?? "/run/development-security-audit/processor-auditor.sock";
  const processorAuditorUid = parseNonNegativeInteger(environment[PROCESSOR_AUDITOR_UID] ?? "1000");
  const processorAuditorGid = parseNonNegativeInteger(environment[PROCESSOR_AUDITOR_GID] ?? "1000");
  const idleDelayMs = parseBoundedDelay(
    environment[IDLE_DELAY],
    DEFAULT_IDLE_DELAY_MS,
  );
  const errorDelayMs = parseBoundedDelay(
    environment[ERROR_DELAY],
    DEFAULT_ERROR_DELAY_MS,
  );

  if (
    !databaseUrlFile ||
    !isAbsolute(databaseUrlFile) ||
    environment.DS_WORKER_DATABASE_URL !== undefined ||
    !coordinatorSocketPath ||
    !isAbsolute(coordinatorSocketPath) ||
    coordinatorUid === null ||
    coordinatorGid === null ||
    !isAbsolute(processorAuditorSocketPath) ||
    processorAuditorUid === null ||
    processorAuditorGid === null ||
    idleDelayMs === null ||
    errorDelayMs === null
  ) {
    throw new Error("scan_worker_configuration_invalid");
  }

  return {
    databaseUrlFile,
    coordinatorSocketPath,
    coordinatorUid,
    coordinatorGid,
    processorAuditorSocketPath,
    processorAuditorUid,
    processorAuditorGid,
    idleDelayMs,
    errorDelayMs,
  };
}

export function readScanWorkerDatabaseUrl(databaseUrlFile: string): string {
  let connectionString: string;
  try {
    connectionString = readFileSync(databaseUrlFile, "utf8").replace(/\r?\n$/, "");
  } catch {
    throw new Error("scan_worker_database_configuration_invalid");
  }

  if (!isWorkerDatabaseUrl(connectionString)) {
    throw new Error("scan_worker_database_configuration_invalid");
  }
  return connectionString;
}

function isWorkerDatabaseUrl(value: string): boolean {
  if (!value || value.trim() !== value || /[\r\n]/.test(value)) return false;
  try {
    const parsed = new URL(value);
    return (
      POSTGRES_PROTOCOLS.has(parsed.protocol) &&
      parsed.hostname.length > 0 &&
      parsed.pathname === WORKER_DATABASE_NAME &&
      parsed.username === WORKER_DATABASE_ROLE &&
      parsed.password.length > 0 &&
      parsed.search.length === 0 &&
      parsed.hash.length === 0
    );
  } catch {
    return false;
  }
}

function parseNonNegativeInteger(value: string | undefined): number | null {
  if (!value || !/^(0|[1-9]\d*)$/.test(value)) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

function parseBoundedDelay(
  value: string | undefined,
  fallback: number,
): number | null {
  if (value === undefined) return fallback;
  const parsed = parseNonNegativeInteger(value);
  return parsed !== null && parsed > 0 && parsed <= MAX_WORKER_DELAY_MS
    ? parsed
    : null;
}
