import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { checkServerIdentity } from "node:tls";
import { afterEach, describe, expect, it } from "vitest";
import { resolveDevelopmentSecurityDatabasePoolConfig } from "./database-pool-config.js";

const DATABASE_URL = "postgresql://ds_api:secret@db:5432/desarrollo_seguro";
const DATABASE_URL_FILE = "DS_DATABASE_URL_FILE";
const DATABASE_TLS_CA_FILE = "DS_DATABASE_TLS_CA_FILE";
const DATABASE_TLS_REQUIRED = "DS_DATABASE_TLS_REQUIRED";
const DATABASE_CONFIGURATION_ERROR =
  "invalid_development_security_database_configuration";
const CERTIFICATE_DAYS = "1";
const TLS_MINIMUM_VERSION = "TLSv1.2";

let temporaryDirectory: string | undefined;

afterEach(() => {
  if (temporaryDirectory) {
    rmSync(temporaryDirectory, { recursive: true, force: true });
    temporaryDirectory = undefined;
  }
});

describe("resolveDevelopmentSecurityDatabasePoolConfig", () => {
  it("keeps local development connections without TLS configuration", () => {
    expect(
      resolveDevelopmentSecurityDatabasePoolConfig({
        DS_DATABASE_URL: DATABASE_URL,
      }),
    ).toEqual({ connectionString: DATABASE_URL, max: 3 });
  });

  it("enables TLS 1.2+, CA validation, and hostname checks from a mounted CA", () => {
    temporaryDirectory = mkdtempSync(join(tmpdir(), "ds-database-ca-"));
    const urlPath = join(temporaryDirectory, "database-url");
    const caPath = join(temporaryDirectory, "database-ca.crt");
    writeFileSync(urlPath, DATABASE_URL, { mode: 0o600 });
    generateCertificate(caPath, true);
    const ca = readFileSync(caPath, "utf8");

    expect(
      resolveDevelopmentSecurityDatabasePoolConfig({
        NODE_ENV: "production",
        [DATABASE_URL_FILE]: urlPath,
        [DATABASE_TLS_CA_FILE]: caPath,
      }),
    ).toEqual({
      connectionString: DATABASE_URL,
      max: 3,
      ssl: {
        ca,
        checkServerIdentity,
        minVersion: TLS_MINIMUM_VERSION,
        rejectUnauthorized: true,
      },
    });
  });

  it("enables CA-verified TLS when explicitly required outside production", () => {
    temporaryDirectory = mkdtempSync(join(tmpdir(), "ds-database-ca-"));
    const urlPath = join(temporaryDirectory, "database-url");
    const caPath = join(temporaryDirectory, "database-ca.crt");
    writeFileSync(urlPath, DATABASE_URL, { mode: 0o600 });
    generateCertificate(caPath, true);
    const ca = readFileSync(caPath, "utf8");

    expect(
      resolveDevelopmentSecurityDatabasePoolConfig({
        NODE_ENV: "development",
        [DATABASE_URL_FILE]: urlPath,
        [DATABASE_TLS_CA_FILE]: caPath,
        [DATABASE_TLS_REQUIRED]: "true",
      }),
    ).toEqual({
      connectionString: DATABASE_URL,
      max: 3,
      ssl: {
        ca,
        checkServerIdentity,
        minVersion: TLS_MINIMUM_VERSION,
        rejectUnauthorized: true,
      },
    });
  });

  it("rejects a readable certificate file that is not a CA", () => {
    temporaryDirectory = mkdtempSync(join(tmpdir(), "ds-database-ca-"));
    const caPath = join(temporaryDirectory, "server.crt");
    generateCertificate(caPath, false);

    expect(() =>
      resolveDevelopmentSecurityDatabasePoolConfig({
        DS_DATABASE_URL: DATABASE_URL,
        [DATABASE_TLS_CA_FILE]: caPath,
      }),
    ).toThrow(DATABASE_CONFIGURATION_ERROR);
  });

  it("requires a CA file for production TLS", () => {
    temporaryDirectory = mkdtempSync(join(tmpdir(), "ds-database-ca-"));
    const urlPath = join(temporaryDirectory, "database-url");
    writeFileSync(urlPath, DATABASE_URL, { mode: 0o600 });

    expect(() =>
      resolveDevelopmentSecurityDatabasePoolConfig({
        NODE_ENV: "production",
        [DATABASE_URL_FILE]: urlPath,
      }),
    ).toThrow(DATABASE_CONFIGURATION_ERROR);
  });

  it("requires TLS when the Docker target guard is enabled", () => {
    temporaryDirectory = mkdtempSync(join(tmpdir(), "ds-database-ca-"));
    const urlPath = join(temporaryDirectory, "database-url");
    writeFileSync(urlPath, DATABASE_URL, { mode: 0o600 });

    expect(() =>
      resolveDevelopmentSecurityDatabasePoolConfig({
        NODE_ENV: "development",
        [DATABASE_TLS_REQUIRED]: "true",
        [DATABASE_URL_FILE]: urlPath,
      }),
    ).toThrow(DATABASE_CONFIGURATION_ERROR);
  });

  it("does not allow an explicit false setting to disable production TLS", () => {
    expect(() =>
      resolveDevelopmentSecurityDatabasePoolConfig({
        NODE_ENV: "production",
        DS_DATABASE_URL: DATABASE_URL,
        [DATABASE_TLS_REQUIRED]: "false",
      }),
    ).toThrow(DATABASE_CONFIGURATION_ERROR);
  });

  it.each(["yes", "true ", " false"])(
    "rejects invalid TLS-required setting %s",
    (setting) => {
      expect(() =>
        resolveDevelopmentSecurityDatabasePoolConfig({
          NODE_ENV: "development",
          DS_DATABASE_URL: DATABASE_URL,
          [DATABASE_TLS_REQUIRED]: setting,
        }),
      ).toThrow(DATABASE_CONFIGURATION_ERROR);
    },
  );

  it("rejects malformed CA content", () => {
    temporaryDirectory = mkdtempSync(join(tmpdir(), "ds-database-ca-"));
    const caPath = join(temporaryDirectory, "malformed-ca.crt");
    writeFileSync(caPath, "-----BEGIN CERTIFICATE-----\nnot a certificate");

    expect(() =>
      resolveDevelopmentSecurityDatabasePoolConfig({
        DS_DATABASE_URL: DATABASE_URL,
        [DATABASE_TLS_CA_FILE]: caPath,
      }),
    ).toThrow(DATABASE_CONFIGURATION_ERROR);
  });

  it("rejects an unreadable CA file without exposing its path", () => {
    temporaryDirectory = mkdtempSync(join(tmpdir(), "ds-database-ca-"));
    const missingCaPath = join(temporaryDirectory, "private-ca-path");

    let errorMessage: string | undefined;
    try {
      resolveDevelopmentSecurityDatabasePoolConfig({
        DS_DATABASE_URL: DATABASE_URL,
        [DATABASE_TLS_CA_FILE]: missingCaPath,
      });
    } catch (error) {
      if (error instanceof Error) {
        errorMessage = error.message;
      }
    }

    expect(errorMessage).toBe(DATABASE_CONFIGURATION_ERROR);
  });
});

function generateCertificate(
  certificatePath: string,
  isCertificateAuthority: boolean,
): void {
  const caValue = isCertificateAuthority ? "TRUE" : "FALSE";
  execFileSync(
    "openssl",
    [
      "req",
      "-x509",
      "-newkey",
      "rsa:2048",
      "-nodes",
      "-keyout",
      join(temporaryDirectory ?? tmpdir(), "temporary.key"),
      "-out",
      certificatePath,
      "-subj",
      "/CN=database-ca-test",
      "-days",
      CERTIFICATE_DAYS,
      "-addext",
      `basicConstraints=critical,CA:${caValue}`,
    ],
    { stdio: "ignore" },
  );
}
