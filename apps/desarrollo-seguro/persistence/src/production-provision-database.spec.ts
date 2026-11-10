import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  assertSafeProductionProvisioningTarget,
  readProductionProvisioningSettingsFromEnvironment,
  type ProductionProvisioningSettings,
} from "./production-provision-database.js";

const SAFE_ADMIN_URL =
  "postgresql://ds_bootstrap:local-only@development-security-database:5432/postgres";
const SAFE_API_URL =
  "postgresql://ds_api:local-api-only@development-security-database:5432/desarrollo_seguro";
const SAFE_WORKER_URL =
  "postgresql://ds_worker:local-worker-only@development-security-database:5432/desarrollo_seguro";
const SAFE_CA = `-----BEGIN CERTIFICATE-----
MIICujCCAaKgAwIBAgIJAOGFXHsIB3TxMA0GCSqGSIb3DQEBCwUAMBIxEDAOBgNV
BAMMB3Rlc3QtY2EwHhcNMjYxMTAzMTUwOTEyWhcNMjYxMTA0MTUwOTEyWjASMRAw
DgYDVQQDDAd0ZXN0LWNhMIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEA
ojMIj8DAFjkrrJe624wS2RSImcB9gVkzcYlZwqD0iTclLmfPyxMjxdhrGjcefRvv
45Qydbzolmbq19N5CDu5HhKv7dqrJ+yEqKgDHIHznlaSTvALGtHm03OlHH2WnDoK
8DDqiFqxiM5STFvrArxpJ4iRAr4ZF6wOQ5g2KSZ3un/LqfbdCcCzpJU0oK3I5WIB
JWI0wmvMwdHo136+uiPiAgOVoNvTk/mdJLPw0RQ08QpHNQFLhOIVUpnawefR8Ev6
M4TH900LGvPwjh7YWNDv+ZmN8r/p9vWYj1F4qtAoBTtVrf44boqfaW1Z4IjQTA7I
2O8oe8UZu5NapP2XyUyEaQIDAQABoxMwETAPBgNVHRMBAf8EBTADAQH/MA0GCSqG
SIb3DQEBCwUAA4IBAQB4ocB5Hx0xrVuqFu264mvMsIecNgWv3n6MPhqnLNdrzr6v
K3XdrPOZdK/Ai0mKhlmBsnsGbTimDBxlCB2KDkZz6X1Yoa0+BL63SL6uvhWFgzMe
ucYaYJLjWIfAoR4Gp4qnffVLzn1Gfc1oChOlcfrRmHabjSynZrL7sidNde0UJHoH
PpiuO05GSgU4ndXB6DjDh38PYBNEZnvozBkDlNYPhmL/GpFoUMxE7Cx5zbO+t6wi
/6T0YbN8gHlY4HfJcQfDdyB+2yCIWmJ5+EdAjFvhnUUcBt/P7to/bfmZnNjibdwT
3eN1E5F/aRzIfFnwl37sKEea5fdnfJ55/7cCbpAp
-----END CERTIFICATE-----
`;
const SAFE_SETTINGS: ProductionProvisioningSettings = {
  adminUrl: SAFE_ADMIN_URL,
  apiDatabaseUrl: SAFE_API_URL,
  workerDatabaseUrl: SAFE_WORKER_URL,
  databaseName: "desarrollo_seguro",
  migratorPassword: "local-migrator-only",
  tlsCa: SAFE_CA,
  bootstrapEnabled: "1",
  testPostgresIsolated: undefined,
};

describe("Development Security production bootstrap target guard", () => {
  it("accepts only the dedicated production database service and exact database", () => {
    expect(() =>
      assertSafeProductionProvisioningTarget(SAFE_SETTINGS),
    ).not.toThrow();
  });

  it("requires an explicit bootstrap opt-in", () => {
    expect(() =>
      assertSafeProductionProvisioningTarget({
        ...SAFE_SETTINGS,
        bootstrapEnabled: undefined,
      }),
    ).toThrow("DS_PRODUCTION_BOOTSTRAP_ENABLED_required");
  });

  it.each([
    "postgresql://ds_bootstrap:pw@localhost:5432/postgres",
    "postgresql://ds_bootstrap:pw@db:5432/postgres",
    "postgresql://ds_bootstrap:pw@development-security-database.example:5432/postgres",
  ])("rejects a non-dedicated production hostname: %s", (adminUrl) => {
    expect(() =>
      assertSafeProductionProvisioningTarget({ ...SAFE_SETTINGS, adminUrl }),
    ).toThrow("DS_PRODUCTION_ADMIN_URL_invalid");
  });

  it.each([
    "postgresql://postgres:pw@development-security-database:5432/postgres",
    "postgresql://ds_bootstrap:pw@development-security-database:5433/postgres",
    "postgresql://ds_bootstrap:pw@development-security-database:5432/development_seguro",
    "postgresql://ds_bootstrap:pw@development-security-database:5432/postgres?host=localhost",
    "postgresql://ds_bootstrap:pw@development-security-database:5432/postgres#ignored",
  ])("rejects unsafe admin URL details: %s", (adminUrl) => {
    expect(() =>
      assertSafeProductionProvisioningTarget({ ...SAFE_SETTINGS, adminUrl }),
    ).toThrow("DS_PRODUCTION_ADMIN_URL_invalid");
  });

  it.each([
    "development_security_test_provisioned",
    "legacy",
    "desarrollo_seguro_extra",
  ])(
    "rejects any production target name other than the exact DS database: %s",
    (databaseName) => {
      expect(() =>
        assertSafeProductionProvisioningTarget({
          ...SAFE_SETTINGS,
          databaseName,
        }),
      ).toThrow("DS_PRODUCTION_DATABASE_NAME_must_match_dedicated_database");
    },
  );

  it("rejects a production database URL containing credentials for a runtime role", () => {
    expect(() =>
      assertSafeProductionProvisioningTarget({
        ...SAFE_SETTINGS,
        adminUrl:
          "postgresql://ds_api:pw@development-security-database:5432/postgres",
      }),
    ).toThrow("DS_PRODUCTION_ADMIN_URL_invalid");
  });

  it("allows the integration override only for an opted-in loopback test cluster", () => {
    expect(() =>
      assertSafeProductionProvisioningTarget({
        ...SAFE_SETTINGS,
        adminUrl:
          "postgresql://postgres:local-only@127.0.0.1:5432/development_security_test_admin",
        apiDatabaseUrl:
          "postgresql://ds_api:local-only@127.0.0.1:5432/development_security_test_production_bootstrap",
        workerDatabaseUrl:
          "postgresql://ds_worker:local-only@127.0.0.1:5432/development_security_test_production_bootstrap",
        databaseName: "development_security_test_production_bootstrap",
        testPostgresIsolated: "1",
      }),
    ).not.toThrow();
  });

  it("rejects the test override unless both test URLs use loopback test databases", () => {
    expect(() =>
      assertSafeProductionProvisioningTarget({
        ...SAFE_SETTINGS,
        adminUrl: "postgresql://postgres:local-only@localhost/postgres",
        databaseName: "development_security_test_target",
        testPostgresIsolated: "1",
      }),
    ).toThrow("DS_TEST_DATABASE_URL_must_target_isolated_database");
  });

  it("rejects malformed CA content and missing role passwords", () => {
    expect(() =>
      assertSafeProductionProvisioningTarget({
        ...SAFE_SETTINGS,
        tlsCa: "bad",
      }),
    ).toThrow("DS_PRODUCTION_TLS_CA_invalid");
    expect(() =>
      assertSafeProductionProvisioningTarget({
        ...SAFE_SETTINGS,
        apiDatabaseUrl: "invalid-api-url",
      }),
    ).toThrow("DS_PRODUCTION_API_DATABASE_URL_invalid");
  });

  it("validates unknown settings at runtime", () => {
    expect(() => assertSafeProductionProvisioningTarget(null)).toThrow(
      "DS_PRODUCTION_PROVISION_SETTINGS_invalid",
    );
  });

  it.each([
    "postgresql://ds_api:local-worker-only@development-security-database:5432/desarrollo_seguro",
    "postgresql://ds_worker:local-worker-only@other-database:5432/desarrollo_seguro",
    "postgresql://ds_worker:local-worker-only@development-security-database:5432/other_database",
  ])("rejects an unsafe production worker URL: %s", (workerDatabaseUrl) => {
    expect(() =>
      assertSafeProductionProvisioningTarget({
        ...SAFE_SETTINGS,
        workerDatabaseUrl,
      }),
    ).toThrow("DS_PRODUCTION_WORKER_DATABASE_URL_invalid");
  });

  it("reads multiline CA certificates while keeping other secrets single-line", () => {
    const directory = mkdtempSync(join(tmpdir(), "development-security-provision-"));
    const paths = {
      adminUrl: join(directory, "admin-url"),
      apiDatabaseUrl: join(directory, "api-database-url"),
      workerDatabaseUrl: join(directory, "worker-database-url"),
      migratorPassword: join(directory, "migrator-password"),
      tlsCa: join(directory, "ca.crt"),
    };
    writeFileSync(paths.adminUrl, `${SAFE_ADMIN_URL}\n`);
    writeFileSync(paths.apiDatabaseUrl, `${SAFE_API_URL}\n`);
    writeFileSync(paths.workerDatabaseUrl, `${SAFE_WORKER_URL}\n`);
    writeFileSync(paths.migratorPassword, "local-migrator-only\n");
    writeFileSync(paths.tlsCa, SAFE_CA);

    try {
      const settings = readProductionProvisioningSettingsFromEnvironment({
        DS_PRODUCTION_ADMIN_URL_FILE: paths.adminUrl,
        DS_PRODUCTION_API_DATABASE_URL_FILE: paths.apiDatabaseUrl,
        DS_PRODUCTION_WORKER_DATABASE_URL_FILE: paths.workerDatabaseUrl,
        DS_PRODUCTION_DATABASE_NAME: "desarrollo_seguro",
        DS_PRODUCTION_MIGRATOR_PASSWORD_FILE: paths.migratorPassword,
        DS_PRODUCTION_TLS_CA_FILE: paths.tlsCa,
        DS_PRODUCTION_BOOTSTRAP_ENABLED: "1",
      });

      expect(settings.tlsCa).toBe(SAFE_CA);
      expect(settings.adminUrl).toBe(SAFE_ADMIN_URL);
      expect(settings.workerDatabaseUrl).toBe(SAFE_WORKER_URL);
      expect(settings.migratorPassword).toBe("local-migrator-only");
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("rejects multiline credentials even when the CA file is valid PEM", () => {
    const directory = mkdtempSync(join(tmpdir(), "development-security-provision-"));
    const paths = {
      adminUrl: join(directory, "admin-url"),
      apiDatabaseUrl: join(directory, "api-database-url"),
      workerDatabaseUrl: join(directory, "worker-database-url"),
      migratorPassword: join(directory, "migrator-password"),
      tlsCa: join(directory, "ca.crt"),
    };
    writeFileSync(paths.adminUrl, `${SAFE_ADMIN_URL}\n`);
    writeFileSync(paths.apiDatabaseUrl, `${SAFE_API_URL}\n`);
    writeFileSync(paths.workerDatabaseUrl, `${SAFE_WORKER_URL}\n`);
    writeFileSync(paths.migratorPassword, "invalid\ncredential\n");
    writeFileSync(paths.tlsCa, SAFE_CA);

    try {
      expect(() =>
        readProductionProvisioningSettingsFromEnvironment({
          DS_PRODUCTION_ADMIN_URL_FILE: paths.adminUrl,
          DS_PRODUCTION_API_DATABASE_URL_FILE: paths.apiDatabaseUrl,
          DS_PRODUCTION_WORKER_DATABASE_URL_FILE: paths.workerDatabaseUrl,
          DS_PRODUCTION_DATABASE_NAME: "desarrollo_seguro",
          DS_PRODUCTION_MIGRATOR_PASSWORD_FILE: paths.migratorPassword,
          DS_PRODUCTION_TLS_CA_FILE: paths.tlsCa,
          DS_PRODUCTION_BOOTSTRAP_ENABLED: "1",
        }),
      ).toThrow("DS_PRODUCTION_PROVISION_SETTINGS_invalid");
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
