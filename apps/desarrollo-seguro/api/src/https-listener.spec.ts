import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { resolveHttpsListenerOptions } from "./https-listener.js";

const PRODUCTION_ENVIRONMENT = "production";
const TLS_CONFIGURATION_ERROR = "invalid_ds_api_tls_configuration";
const INVALID_CERTIFICATE = "not a valid certificate";
const INVALID_PRIVATE_KEY = "not a valid private key";
const TLS_MINIMUM_VERSION = "TLSv1.2";

const temporaryDirectories: string[] = [];

async function createTemporaryTlsFiles(): Promise<{
  certificatePath: string;
  privateKeyPath: string;
  caPath: string;
}> {
  const directory = await mkdtemp(join(tmpdir(), "ds-api-tls-test-"));
  temporaryDirectories.push(directory);
  const certificatePath = join(directory, "server.crt");
  const privateKeyPath = join(directory, "server.key");
  const caPath = join(directory, "client-ca.crt");
  await Promise.all([
    writeFile(certificatePath, INVALID_CERTIFICATE),
    writeFile(privateKeyPath, INVALID_PRIVATE_KEY),
    writeFile(caPath, INVALID_CERTIFICATE),
  ]);
  return { certificatePath, privateKeyPath, caPath };
}

async function createValidTemporaryTlsFiles(): Promise<{
  certificatePath: string;
  privateKeyPath: string;
  caPath: string;
}> {
  const directory = await mkdtemp(join(tmpdir(), "ds-api-valid-tls-test-"));
  temporaryDirectories.push(directory);
  const certificatePath = join(directory, "server.crt");
  const privateKeyPath = join(directory, "server.key");
  const caPath = join(directory, "client-ca.crt");
  const caKeyPath = join(directory, "client-ca.key");
  generateCertificate(certificatePath, privateKeyPath);
  generateCertificate(caPath, caKeyPath, true);
  return { certificatePath, privateKeyPath, caPath };
}

function generateCertificate(
  certificatePath: string,
  privateKeyPath: string,
  isCertificateAuthority = false,
) {
  const certificateAuthorityValue = isCertificateAuthority ? "TRUE" : "FALSE";
  const certificateAuthorityExtension = [
    "-addext",
    `basicConstraints=critical,CA:${certificateAuthorityValue}`,
  ];
  execFileSync(
    "openssl",
    [
      "req",
      "-x509",
      "-newkey",
      "rsa:2048",
      "-nodes",
      "-keyout",
      privateKeyPath,
      "-out",
      certificatePath,
      "-subj",
      "/CN=localhost",
      "-days",
      "1",
      ...certificateAuthorityExtension,
    ],
    { stdio: "ignore" },
  );
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe("resolveHttpsListenerOptions", () => {
  it("keeps local development on HTTP when TLS is not configured", () => {
    expect(
      resolveHttpsListenerOptions({ NODE_ENV: "development" }),
    ).toBeUndefined();
  });

  it("rejects production startup when TLS certificate and key are missing", () => {
    expect(() =>
      resolveHttpsListenerOptions({ NODE_ENV: PRODUCTION_ENVIRONMENT }),
    ).toThrow(TLS_CONFIGURATION_ERROR);
  });

  it("keeps TLS mandatory in the DS runtime even if NODE_ENV is overridden", () => {
    expect(() =>
      resolveHttpsListenerOptions({
        NODE_ENV: "development",
        DS_API_TLS_REQUIRED: "true",
      }),
    ).toThrow(TLS_CONFIGURATION_ERROR);
  });

  it("rejects an invalid TLS-required setting", () => {
    expect(() =>
      resolveHttpsListenerOptions({
        NODE_ENV: "development",
        DS_API_TLS_REQUIRED: "yes",
      }),
    ).toThrow(TLS_CONFIGURATION_ERROR);
  });

  it.each(["", " ", " true ", " false "])(
    "rejects a blank or padded TLS-required setting",
    (setting) => {
      expect(() =>
        resolveHttpsListenerOptions({
          NODE_ENV: "development",
          DS_API_TLS_REQUIRED: setting,
        }),
      ).toThrow(TLS_CONFIGURATION_ERROR);
    },
  );

  it("rejects a partial TLS configuration in every environment", () => {
    expect(() =>
      resolveHttpsListenerOptions({
        NODE_ENV: "development",
        DS_API_TLS_CERT_FILE: "/run/secrets/api.crt",
      }),
    ).toThrow(TLS_CONFIGURATION_ERROR);
  });

  it("rejects malformed production certificate, private key, and CA files", async () => {
    const files = await createTemporaryTlsFiles();

    expect(() =>
      resolveHttpsListenerOptions({
        NODE_ENV: PRODUCTION_ENVIRONMENT,
        DS_API_TLS_CERT_FILE: files.certificatePath,
        DS_API_TLS_KEY_FILE: files.privateKeyPath,
        DS_API_TLS_CLIENT_CA_FILE: files.caPath,
      }),
    ).toThrow(TLS_CONFIGURATION_ERROR);
  });

  it("rejects TLS files that cannot be read", () => {
    expect(() =>
      resolveHttpsListenerOptions({
        NODE_ENV: PRODUCTION_ENVIRONMENT,
        DS_API_TLS_CERT_FILE: "/missing/api.crt",
        DS_API_TLS_KEY_FILE: "/missing/api.key",
      }),
    ).toThrow(TLS_CONFIGURATION_ERROR);
  });

  it("uses a production certificate and enforces TLS 1.2 or newer", async () => {
    const files = await createValidTemporaryTlsFiles();
    const options = resolveHttpsListenerOptions({
      NODE_ENV: PRODUCTION_ENVIRONMENT,
      DS_API_TLS_CERT_FILE: files.certificatePath,
      DS_API_TLS_KEY_FILE: files.privateKeyPath,
    });

    expect(options?.cert).toBeDefined();
    expect(options?.key).toBeDefined();
    expect(options?.minVersion).toBe(TLS_MINIMUM_VERSION);
    expect(options?.requestCert).not.toBe(true);
  });

  it("requires and verifies client certificates when a client CA is configured", async () => {
    const files = await createValidTemporaryTlsFiles();
    const options = resolveHttpsListenerOptions({
      NODE_ENV: PRODUCTION_ENVIRONMENT,
      DS_API_TLS_CERT_FILE: files.certificatePath,
      DS_API_TLS_KEY_FILE: files.privateKeyPath,
      DS_API_TLS_CLIENT_CA_FILE: files.caPath,
    });

    expect(options?.ca).toBeDefined();
    expect(options?.requestCert).toBe(true);
    expect(options?.rejectUnauthorized).toBe(true);
  });

  it("rejects an invalid client CA when the server certificate and key are valid", async () => {
    const files = await createValidTemporaryTlsFiles();
    await writeFile(files.caPath, INVALID_CERTIFICATE);

    expect(() =>
      resolveHttpsListenerOptions({
        NODE_ENV: PRODUCTION_ENVIRONMENT,
        DS_API_TLS_CERT_FILE: files.certificatePath,
        DS_API_TLS_KEY_FILE: files.privateKeyPath,
        DS_API_TLS_CLIENT_CA_FILE: files.caPath,
      }),
    ).toThrow(TLS_CONFIGURATION_ERROR);
  });

  it("rejects a valid end-entity certificate used as the client CA", async () => {
    const files = await createValidTemporaryTlsFiles();

    expect(() =>
      resolveHttpsListenerOptions({
        NODE_ENV: PRODUCTION_ENVIRONMENT,
        DS_API_TLS_CERT_FILE: files.certificatePath,
        DS_API_TLS_KEY_FILE: files.privateKeyPath,
        DS_API_TLS_CLIENT_CA_FILE: files.certificatePath,
      }),
    ).toThrow(TLS_CONFIGURATION_ERROR);
  });

  it("rejects client CA configuration without a server certificate and key", () => {
    expect(() =>
      resolveHttpsListenerOptions({
        NODE_ENV: PRODUCTION_ENVIRONMENT,
        DS_API_TLS_CLIENT_CA_FILE: "/run/secrets/client-ca.crt",
      }),
    ).toThrow(TLS_CONFIGURATION_ERROR);
  });
});
