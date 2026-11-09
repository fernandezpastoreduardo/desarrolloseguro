import { readFileSync } from "node:fs";

const DATABASE_URL_VARIABLE = "DS_DATABASE_URL";
const DATABASE_URL_FILE_VARIABLE = "DS_DATABASE_URL_FILE";
const DATABASE_URL_FILE_REQUIRED_VARIABLE = "DS_DATABASE_URL_FILE_REQUIRED";
const PRODUCTION_ENVIRONMENT = "production";
const PRODUCTION_DATABASE_NAME = "desarrollo_seguro";
const PRODUCTION_DATABASE_ROLE = "ds_api";
const POSTGRES_PROTOCOLS = new Set(["postgres:", "postgresql:"]);
const DATABASE_URL_CONFIGURATION_ERROR =
  "invalid_development_security_database_configuration";

function readDatabaseUrlSecret(filePath: string): string {
  try {
    const secret = readFileSync(filePath, "utf8");
    return secret.replace(/\r?\n$/, "");
  } catch {
    throw new Error(DATABASE_URL_CONFIGURATION_ERROR);
  }
}

function isValidDatabaseUrl(
  value: string,
  requireDevelopmentSecurityIdentity: boolean,
): boolean {
  if (value.length === 0 || value.trim() !== value || /[\r\n]/.test(value)) {
    return false;
  }

  try {
    const parsed = new URL(value);
    return (
      POSTGRES_PROTOCOLS.has(parsed.protocol) &&
      parsed.hostname.length > 0 &&
      parsed.pathname.length > 1 &&
      parsed.search.length === 0 &&
      parsed.hash.length === 0 &&
      parsed.username.length > 0 &&
      parsed.password.length > 0 &&
      (!requireDevelopmentSecurityIdentity ||
        (parsed.username === PRODUCTION_DATABASE_ROLE &&
          parsed.pathname === `/${PRODUCTION_DATABASE_NAME}`))
    );
  } catch {
    return false;
  }
}

export function resolveDevelopmentSecurityDatabaseUrl(
  environment: NodeJS.ProcessEnv,
): string {
  const directValue = environment[DATABASE_URL_VARIABLE];
  const secretFilePath = environment[DATABASE_URL_FILE_VARIABLE];
  const secretFileRequired = isSecretFileRequired(environment);
  if (secretFileRequired && !secretFilePath) {
    throw new Error(DATABASE_URL_CONFIGURATION_ERROR);
  }
  if (directValue && secretFileRequired) {
    throw new Error(DATABASE_URL_CONFIGURATION_ERROR);
  }
  if (Boolean(directValue) === Boolean(secretFilePath)) {
    throw new Error(DATABASE_URL_CONFIGURATION_ERROR);
  }

  const connectionString = secretFilePath
    ? readDatabaseUrlSecret(secretFilePath)
    : directValue;
  if (
    !connectionString ||
    !isValidDatabaseUrl(connectionString, secretFileRequired)
  ) {
    throw new Error(DATABASE_URL_CONFIGURATION_ERROR);
  }
  return connectionString;
}

function isSecretFileRequired(environment: NodeJS.ProcessEnv): boolean {
  const configuredValue = environment[DATABASE_URL_FILE_REQUIRED_VARIABLE];
  if (
    configuredValue !== undefined &&
    configuredValue !== "true" &&
    configuredValue !== "false"
  ) {
    throw new Error(DATABASE_URL_CONFIGURATION_ERROR);
  }
  return (
    environment.NODE_ENV === PRODUCTION_ENVIRONMENT ||
    configuredValue === "true"
  );
}
