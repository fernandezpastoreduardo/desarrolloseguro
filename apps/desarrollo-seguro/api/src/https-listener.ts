import { readFileSync } from "node:fs";
import { X509Certificate } from "node:crypto";
import { createSecureContext, type SecureContextOptions } from "node:tls";
import type { HttpsOptions } from "@nestjs/common/interfaces/external/https-options.interface.js";

const PRODUCTION_ENVIRONMENT = "production";
const TLS_CONFIGURATION_ERROR = "invalid_ds_api_tls_configuration";
const TLS_REQUIRED_ENV = "DS_API_TLS_REQUIRED";
const TLS_MINIMUM_VERSION = "TLSv1.2";
const CERTIFICATE_FILE_ENV = "DS_API_TLS_CERT_FILE";
const PRIVATE_KEY_FILE_ENV = "DS_API_TLS_KEY_FILE";
const CLIENT_CA_FILE_ENV = "DS_API_TLS_CLIENT_CA_FILE";
const PEM_CERTIFICATE_PATTERN =
  /-----BEGIN CERTIFICATE-----[\s\S]+?-----END CERTIFICATE-----/g;

type ApiEnvironment = NodeJS.ProcessEnv;
type DevelopmentSecurityHttpsOptions = HttpsOptions &
  Pick<SecureContextOptions, "minVersion">;

export function resolveHttpsListenerOptions(
  environment: ApiEnvironment,
): DevelopmentSecurityHttpsOptions | undefined {
  const certificatePath = getConfiguredPath(environment, CERTIFICATE_FILE_ENV);
  const privateKeyPath = getConfiguredPath(environment, PRIVATE_KEY_FILE_ENV);
  const clientCaPath = getConfiguredPath(environment, CLIENT_CA_FILE_ENV);
  const tlsRequired = isTlsRequired(environment);
  const tlsIsConfigured =
    certificatePath !== undefined ||
    privateKeyPath !== undefined ||
    clientCaPath !== undefined;

  if (!tlsIsConfigured && !tlsRequired) {
    return undefined;
  }
  if (!certificatePath || !privateKeyPath) {
    throw new Error(TLS_CONFIGURATION_ERROR);
  }

  try {
    const clientCa = clientCaPath ? readFileSync(clientCaPath) : undefined;
    if (clientCa) {
      validateClientCaBundle(clientCa.toString("utf8"));
    }
    const tlsFiles = {
      cert: readFileSync(certificatePath),
      key: readFileSync(privateKeyPath),
      minVersion: TLS_MINIMUM_VERSION,
      ...(clientCa ? { ca: clientCa } : {}),
    } satisfies SecureContextOptions;
    createSecureContext(tlsFiles);

    if (clientCaPath) {
      return {
        ...tlsFiles,
        requestCert: true,
        rejectUnauthorized: true,
      };
    }
    return tlsFiles;
  } catch {
    throw new Error(TLS_CONFIGURATION_ERROR);
  }
}

function validateClientCaBundle(caBundle: string): void {
  const certificates = [...caBundle.matchAll(PEM_CERTIFICATE_PATTERN)].map(
    ([certificate]) => certificate,
  );
  const unparsedContent = caBundle.replace(PEM_CERTIFICATE_PATTERN, "").trim();
  if (certificates.length === 0 || unparsedContent.length > 0) {
    throw new Error(TLS_CONFIGURATION_ERROR);
  }

  for (const certificatePem of certificates) {
    const certificate = new X509Certificate(certificatePem);
    if (!certificate.ca) {
      throw new Error(TLS_CONFIGURATION_ERROR);
    }
  }
}

function isTlsRequired(environment: ApiEnvironment): boolean {
  const configuredValue = environment[TLS_REQUIRED_ENV];
  if (
    configuredValue !== undefined &&
    configuredValue !== "true" &&
    configuredValue !== "false"
  ) {
    throw new Error(TLS_CONFIGURATION_ERROR);
  }
  return (
    environment.NODE_ENV === PRODUCTION_ENVIRONMENT ||
    configuredValue === "true"
  );
}

function getConfiguredPath(
  environment: ApiEnvironment,
  variableName: string,
): string | undefined {
  const value = environment[variableName]?.trim();
  return value || undefined;
}
