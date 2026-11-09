import { readFileSync } from "node:fs";
import { X509Certificate } from "node:crypto";
import { checkServerIdentity } from "node:tls";
import { resolveDevelopmentSecurityDatabaseUrl } from "./database-url.js";

const DATABASE_TLS_CA_FILE_VARIABLE = "DS_DATABASE_TLS_CA_FILE";
const DATABASE_TLS_REQUIRED_VARIABLE = "DS_DATABASE_TLS_REQUIRED";
const PRODUCTION_ENVIRONMENT = "production";
const DATABASE_CONFIGURATION_ERROR =
  "invalid_development_security_database_configuration";
const PEM_CERTIFICATE_PATTERN =
  /-----BEGIN CERTIFICATE-----[\s\S]+?-----END CERTIFICATE-----/g;

interface DevelopmentSecurityDatabasePoolConfig {
  connectionString: string;
  max: number;
  ssl?: {
    ca: string;
    checkServerIdentity: typeof checkServerIdentity;
    minVersion: "TLSv1.2";
    rejectUnauthorized: true;
  };
}

export function resolveDevelopmentSecurityDatabasePoolConfig(
  environment: NodeJS.ProcessEnv,
): DevelopmentSecurityDatabasePoolConfig {
  const tlsRequired = isDatabaseTlsRequired(environment);
  const caFilePath = environment[DATABASE_TLS_CA_FILE_VARIABLE];
  if (tlsRequired && !caFilePath) {
    throw new Error(DATABASE_CONFIGURATION_ERROR);
  }

  const databasePoolConfig: DevelopmentSecurityDatabasePoolConfig = {
    connectionString: resolveDevelopmentSecurityDatabaseUrl(environment),
    max: 3,
  };

  if (caFilePath) {
    databasePoolConfig.ssl = {
      ca: readDatabaseTlsCa(caFilePath),
      checkServerIdentity,
      minVersion: "TLSv1.2",
      rejectUnauthorized: true,
    };
  }

  return databasePoolConfig;
}

function isDatabaseTlsRequired(environment: NodeJS.ProcessEnv): boolean {
  const configuredValue = environment[DATABASE_TLS_REQUIRED_VARIABLE];
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
