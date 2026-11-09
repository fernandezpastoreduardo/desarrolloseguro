import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { resolveDevelopmentSecurityDatabaseUrl } from "./database-url.js";

const DATABASE_URL = "postgresql://ds_api:secret@db:5432/desarrollo_seguro";
const DATABASE_URL_FILE_VARIABLE = "DS_DATABASE_URL_FILE";
const DATABASE_URL_FILE_REQUIRED_VARIABLE = "DS_DATABASE_URL_FILE_REQUIRED";
const DATABASE_URL_VARIABLE = "DS_DATABASE_URL";
const DATABASE_URL_CONFIGURATION_ERROR =
  "invalid_development_security_database_configuration";

let temporaryDirectory: string | undefined;

afterEach(() => {
  if (temporaryDirectory) {
    rmSync(temporaryDirectory, { recursive: true, force: true });
    temporaryDirectory = undefined;
  }
});

describe("resolveDevelopmentSecurityDatabaseUrl", () => {
  it("reads the connection string from the mounted secret file", () => {
    temporaryDirectory = mkdtempSync(join(tmpdir(), "ds-database-url-"));
    const secretPath = join(temporaryDirectory, "database-url");
    writeFileSync(secretPath, `${DATABASE_URL}\n`, { mode: 0o600 });

    expect(
      resolveDevelopmentSecurityDatabaseUrl({
        [DATABASE_URL_FILE_VARIABLE]: secretPath,
      }),
    ).toBe(DATABASE_URL);
  });

  it("accepts a single CRLF line ending in the mounted secret file", () => {
    temporaryDirectory = mkdtempSync(join(tmpdir(), "ds-database-url-"));
    const secretPath = join(temporaryDirectory, "database-url");
    writeFileSync(secretPath, `${DATABASE_URL}\r\n`, { mode: 0o600 });

    expect(
      resolveDevelopmentSecurityDatabaseUrl({
        [DATABASE_URL_FILE_VARIABLE]: secretPath,
      }),
    ).toBe(DATABASE_URL);
  });

  it("rejects malformed or multi-line secret contents with a generic error", () => {
    temporaryDirectory = mkdtempSync(join(tmpdir(), "ds-database-url-"));
    const secretPath = join(temporaryDirectory, "database-url");

    for (const secret of [
      "postgresql://db",
      ` ${DATABASE_URL}\n`,
      `${DATABASE_URL}\n\n`,
      `${DATABASE_URL}\nsecond-line`,
    ]) {
      writeFileSync(secretPath, secret, { mode: 0o600 });

      expect(() =>
        resolveDevelopmentSecurityDatabaseUrl({
          [DATABASE_URL_FILE_VARIABLE]: secretPath,
        }),
      ).toThrow(DATABASE_URL_CONFIGURATION_ERROR);
    }
  });

  it("accepts a PostgreSQL URL supplied by the local development environment", () => {
    expect(
      resolveDevelopmentSecurityDatabaseUrl({
        [DATABASE_URL_VARIABLE]: DATABASE_URL,
      }),
    ).toBe(DATABASE_URL);
  });

  it("requires the secret-file source in production", () => {
    expect(() =>
      resolveDevelopmentSecurityDatabaseUrl({
        NODE_ENV: "production",
        [DATABASE_URL_VARIABLE]: DATABASE_URL,
      }),
    ).toThrow(DATABASE_URL_CONFIGURATION_ERROR);
  });

  it("keeps the secret-file source mandatory if NODE_ENV is overridden", () => {
    expect(() =>
      resolveDevelopmentSecurityDatabaseUrl({
        NODE_ENV: "development",
        [DATABASE_URL_FILE_REQUIRED_VARIABLE]: "true",
        [DATABASE_URL_VARIABLE]: DATABASE_URL,
      }),
    ).toThrow(DATABASE_URL_CONFIGURATION_ERROR);
  });

  it("accepts only the Desarrollo Seguro role and database in production", () => {
    temporaryDirectory = mkdtempSync(join(tmpdir(), "ds-database-url-prod-"));
    const secretPath = join(temporaryDirectory, "database-url");
    const productionEnvironment = {
      NODE_ENV: "production",
      [DATABASE_URL_FILE_VARIABLE]: secretPath,
    };
    writeFileSync(secretPath, DATABASE_URL, { mode: 0o600 });

    expect(resolveDevelopmentSecurityDatabaseUrl(productionEnvironment)).toBe(
      DATABASE_URL,
    );

    for (const value of [
      "postgresql://legacy_api:secret@db:5432/desarrollo_seguro",
      "postgresql://ds_api:secret@db:5432/legacy",
    ]) {
      writeFileSync(secretPath, value, { mode: 0o600 });
      expect(() =>
        resolveDevelopmentSecurityDatabaseUrl(productionEnvironment),
      ).toThrow(DATABASE_URL_CONFIGURATION_ERROR);
    }
  });

  it.each(["yes", "true ", " false"])(
    "rejects an invalid secret-file-required setting %s",
    (setting) => {
      expect(() =>
        resolveDevelopmentSecurityDatabaseUrl({
          NODE_ENV: "development",
          [DATABASE_URL_FILE_REQUIRED_VARIABLE]: setting,
          [DATABASE_URL_VARIABLE]: DATABASE_URL,
        }),
      ).toThrow(DATABASE_URL_CONFIGURATION_ERROR);
    },
  );

  it("rejects missing, unreadable, ambiguous, or non-PostgreSQL configuration", () => {
    expect(() => resolveDevelopmentSecurityDatabaseUrl({})).toThrow(
      DATABASE_URL_CONFIGURATION_ERROR,
    );
    expect(() =>
      resolveDevelopmentSecurityDatabaseUrl({
        [DATABASE_URL_FILE_VARIABLE]: "/missing/ds-database-url",
      }),
    ).toThrow(DATABASE_URL_CONFIGURATION_ERROR);
    expect(() =>
      resolveDevelopmentSecurityDatabaseUrl({
        [DATABASE_URL_VARIABLE]: DATABASE_URL,
        [DATABASE_URL_FILE_VARIABLE]: "/unused/ds-database-url",
      }),
    ).toThrow(DATABASE_URL_CONFIGURATION_ERROR);
    expect(() =>
      resolveDevelopmentSecurityDatabaseUrl({
        [DATABASE_URL_VARIABLE]: "https://example.invalid/secret",
      }),
    ).toThrow(DATABASE_URL_CONFIGURATION_ERROR);
  });

  it("rejects blank, padded, or incomplete PostgreSQL URLs", () => {
    for (const value of [
      "",
      ` ${DATABASE_URL}`,
      "postgresql://db",
      `${DATABASE_URL}?host=/var/run/postgresql`,
      `${DATABASE_URL}#ignored-extra`,
    ]) {
      expect(() =>
        resolveDevelopmentSecurityDatabaseUrl({
          [DATABASE_URL_VARIABLE]: value,
        }),
      ).toThrow(DATABASE_URL_CONFIGURATION_ERROR);
    }
  });

  it("does not include a rejected connection string in its error", () => {
    let errorMessage: string | undefined;
    try {
      resolveDevelopmentSecurityDatabaseUrl({
        [DATABASE_URL_VARIABLE]: `${DATABASE_URL}?host=/var/run/postgresql`,
      });
    } catch (error) {
      if (error instanceof Error) {
        errorMessage = error.message;
      }
    }

    expect(errorMessage).toBe(DATABASE_URL_CONFIGURATION_ERROR);
  });
});
