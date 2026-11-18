import { readFileSync } from "node:fs";
import { X509Certificate } from "node:crypto";
import { checkServerIdentity } from "node:tls";
import { pathToFileURL } from "node:url";
import { Pool, type PoolConfig } from "pg";

export const RETENTION_WINDOW_MS = 90 * 24 * 60 * 60 * 1_000;
export const PUBLIC_INACTIVITY_WINDOW_MS = 30 * 24 * 60 * 60 * 1_000;
export const RETENTION_INTERVAL_MS = 24 * 60 * 60 * 1_000;
const RETENTION_FAILURE = "retention_cycle_failed";
const RETENTION_RESULT_INVALID = "report_retention_result_invalid";
const RETENTION_CONFIGURATION_INVALID = "retention_configuration_invalid";
const RETENTION_DATABASE_URL_FILE = "DS_RETENTION_DATABASE_URL_FILE";
const RETENTION_TLS_CA_FILE = "DS_RETENTION_DATABASE_TLS_CA_FILE";
const RETENTION_HOST = "development-security-database";
const RETENTION_DATABASE = "desarrollo_seguro";
const RETENTION_ROLE = "ds_retention";
const PRODUCTION_ENVIRONMENT = "production";
const PEM_CERTIFICATE_PATTERN =
  /-----BEGIN CERTIFICATE-----[\s\S]+?-----END CERTIFICATE-----/gu;

export function resolveRetentionPoolConfig(
  environment: NodeJS.ProcessEnv,
): PoolConfig {
  const databaseUrl = readSecretFile(environment[RETENTION_DATABASE_URL_FILE]);
  const caFilePath = environment[RETENTION_TLS_CA_FILE];
  if (environment.NODE_ENV === PRODUCTION_ENVIRONMENT && !caFilePath) {
    throw new Error(RETENTION_CONFIGURATION_INVALID);
  }
  let parsedUrl: URL;
  try {
    parsedUrl = new URL(databaseUrl);
  } catch {
    throw new Error(RETENTION_CONFIGURATION_INVALID);
  }
  if (
    (parsedUrl.protocol !== "postgres:" &&
      parsedUrl.protocol !== "postgresql:") ||
    parsedUrl.hostname !== RETENTION_HOST ||
    parsedUrl.port !== "5432" ||
    parsedUrl.pathname !== `/${RETENTION_DATABASE}` ||
    decodeURIComponent(parsedUrl.username) !== RETENTION_ROLE ||
    !parsedUrl.password ||
    parsedUrl.search ||
    parsedUrl.hash
  ) {
    throw new Error(RETENTION_CONFIGURATION_INVALID);
  }
  const config: PoolConfig = {
    connectionString: databaseUrl,
    max: 1,
    connectionTimeoutMillis: 5_000,
    idleTimeoutMillis: 10_000,
    application_name: "desarrollo-seguro-retention",
  };
  if (caFilePath) {
    config.ssl = {
      ca: readCertificateAuthority(caFilePath),
      checkServerIdentity,
      minVersion: "TLSv1.2",
      rejectUnauthorized: true,
    };
  }
  return config;
}

export async function runRetentionCycle(
  pool: Pick<Pool, "query">,
  now: () => Date = () => new Date(),
): Promise<number> {
  const cutoff = new Date(now().getTime() - RETENTION_WINDOW_MS);
  const result = await pool.query<{ deleted_rows: unknown }>(
    "SELECT public.ds_purge_expired_reports($1) AS deleted_rows",
    [cutoff],
  );
  const deletedRows = result.rows[0]?.deleted_rows;
  if (
    typeof deletedRows !== "number" ||
    !Number.isSafeInteger(deletedRows) ||
    deletedRows < 0
  ) {
    throw new Error(RETENTION_RESULT_INVALID);
  }
  return deletedRows;
}

export async function runInactivePublicReportCleanup(
  pool: Pick<Pool, "query">,
  now: () => Date = () => new Date(),
): Promise<number> {
  const cutoff = new Date(now().getTime() - PUBLIC_INACTIVITY_WINDOW_MS);
  const result = await pool.query<{ deleted_rows: unknown }>(
    "SELECT public.ds_purge_inactive_public_reports($1) AS deleted_rows",
    [cutoff],
  );
  const deletedRows = result.rows[0]?.deleted_rows;
  if (
    typeof deletedRows !== "number" ||
    !Number.isSafeInteger(deletedRows) ||
    deletedRows < 0
  ) {
    throw new Error(RETENTION_RESULT_INVALID);
  }
  return deletedRows;
}

export async function runRetentionScheduler(
  pool: Pick<Pool, "query">,
  options: {
    signal: AbortSignal;
    now?: () => Date;
    intervalMs?: number;
    onError?: (category: string) => void;
  },
): Promise<void> {
  const intervalMs = options.intervalMs ?? RETENTION_INTERVAL_MS;
  if (!Number.isSafeInteger(intervalMs) || intervalMs < 1_000) {
    throw new Error("retention_scheduler_interval_invalid");
  }

  while (!options.signal.aborted) {
    let failed = false;
    try {
      await runRetentionCycle(pool, options.now);
    } catch {
      failed = true;
    }
    try {
      await runInactivePublicReportCleanup(pool, options.now);
    } catch {
      failed = true;
    }
    if (failed) {
      options.onError?.(RETENTION_FAILURE);
    }
    if (options.signal.aborted) return;
    await waitForNextCycle(intervalMs, options.signal);
  }
}

function waitForNextCycle(
  intervalMs: number,
  signal: AbortSignal,
): Promise<void> {
  return new Promise((resolve) => {
    const finish = () => {
      clearTimeout(timer);
      signal.removeEventListener("abort", finish);
      resolve();
    };
    const timer = setTimeout(finish, intervalMs);
    signal.addEventListener("abort", finish, { once: true });
  });
}

function readSecretFile(path: string | undefined): string {
  if (!path) throw new Error(RETENTION_CONFIGURATION_INVALID);
  try {
    const value = readFileSync(path, "utf8").replace(/\r?\n$/u, "");
    if (!value || value.includes("\n") || value.includes("\r")) {
      throw new Error(RETENTION_CONFIGURATION_INVALID);
    }
    return value;
  } catch {
    throw new Error(RETENTION_CONFIGURATION_INVALID);
  }
}

function readCertificateAuthority(path: string): string {
  try {
    const ca = readFileSync(path, "utf8");
    const certificates = [...ca.matchAll(PEM_CERTIFICATE_PATTERN)].map(
      ([certificate]) => certificate,
    );
    if (
      certificates.length === 0 ||
      ca.replace(PEM_CERTIFICATE_PATTERN, "").trim().length > 0 ||
      certificates.some((certificate) => !new X509Certificate(certificate).ca)
    ) {
      throw new Error(RETENTION_CONFIGURATION_INVALID);
    }
    return ca;
  } catch {
    throw new Error(RETENTION_CONFIGURATION_INVALID);
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const pool = new Pool(resolveRetentionPoolConfig(process.env));
  const controller = new AbortController();
  process.once("SIGINT", () => controller.abort());
  process.once("SIGTERM", () => controller.abort());
  try {
    await runRetentionScheduler(pool, {
      signal: controller.signal,
      onError: (category) => process.stderr.write(`${category}\n`),
    });
  } catch {
    process.stderr.write("retention_scheduler_failed\n");
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}
