import { readFileSync } from "node:fs";
import { X509Certificate } from "node:crypto";
import { checkServerIdentity } from "node:tls";
import type { PoolConfig } from "pg";
import {
  readScanWorkerDatabaseUrl,
  resolveScanWorkerConfiguration,
} from "./worker-configuration.js";

const DATABASE_TLS_CA_FILE = "DS_WORKER_DATABASE_TLS_CA_FILE";
const DATABASE_TLS_REQUIRED = "DS_WORKER_DATABASE_TLS_REQUIRED";
const DATABASE_CONFIGURATION_ERROR =
  "scan_worker_database_configuration_invalid";
const PRODUCTION_ENVIRONMENT = "production";
const PEM_CERTIFICATE_PATTERN =
  /-----BEGIN CERTIFICATE-----[\s\S]+?-----END CERTIFICATE-----/gu;

export function resolveScanWorkerPoolConfig(
  environment: NodeJS.ProcessEnv,
): PoolConfig {
  const configuration = resolveScanWorkerConfiguration(environment);
  const tlsRequired = isDatabaseTlsRequired(environment);
  const caFilePath = environment[DATABASE_TLS_CA_FILE];
  if (tlsRequired && !caFilePath) {
    throw new Error(DATABASE_CONFIGURATION_ERROR);
  }

  const poolConfig: PoolConfig = {
    connectionString: readScanWorkerDatabaseUrl(configuration.databaseUrlFile),
    max: 1,
    connectionTimeoutMillis: 5_000,
    idleTimeoutMillis: 10_000,
    application_name: "desarrollo-seguro-worker",
  };
  if (caFilePath) {
    poolConfig.ssl = {
      ca: readDatabaseTlsCa(caFilePath),
      checkServerIdentity,
      minVersion: "TLSv1.2",
      rejectUnauthorized: true,
    };
  }
  return poolConfig;
}

function isDatabaseTlsRequired(environment: NodeJS.ProcessEnv): boolean {
  const configuredValue = environment[DATABASE_TLS_REQUIRED];
  if (
    configuredValue !== undefined &&
    configuredValue !== "true" &&
    configuredValue !== "false"
  ) {
    throw new Error(DATABASE_CONFIGURATION_ERROR);
  }
  return (
    environment.NODE_ENV === PRODUCTION_ENVIRONMENT ||
    configuredValue === "true"
  );
}

function readDatabaseTlsCa(filePath: string): string {
  try {
    const ca = readFileSync(filePath, "utf8");
    const certificates = [...ca.matchAll(PEM_CERTIFICATE_PATTERN)].map(
      ([certificate]) => certificate,
    );
    const remainingContent = ca.replace(PEM_CERTIFICATE_PATTERN, "").trim();
    if (certificates.length === 0 || remainingContent.length > 0) {
      throw new Error(DATABASE_CONFIGURATION_ERROR);
    }
    for (const certificatePem of certificates) {
      if (!new X509Certificate(certificatePem).ca) {
        throw new Error(DATABASE_CONFIGURATION_ERROR);
      }
    }
    return ca;
  } catch {
    throw new Error(DATABASE_CONFIGURATION_ERROR);
  }
}
