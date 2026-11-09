import { describe, expect, it } from "vitest";
import {
  assertSafeProvisioningTarget,
  provisionDevelopmentSecurityDatabase,
  type ProvisioningSettings,
} from "./provision-database.js";

const SAFE_ADMIN_URL =
  "postgres://postgres:local-only@127.0.0.1/development_security_test_admin";
const SAFE_DATABASE_NAME = "development_security_test_provisioned";
const SAFE_OPT_IN = "1";
const SAFE_SETTINGS: ProvisioningSettings = {
  adminUrl: SAFE_ADMIN_URL,
  databaseName: SAFE_DATABASE_NAME,
  migratorPassword: "migrator-local-only",
  apiPassword: "api-local-only",
  workerPassword: "worker-local-only",
  isolatedTestOptIn: SAFE_OPT_IN,
};

describe("Development Security provisioning target", () => {
  it("accepts only an explicitly opted-in loopback test cluster", () => {
    expect(() => assertSafeProvisioningTarget(SAFE_SETTINGS)).not.toThrow();
  });

  it("rejects a missing isolated-cluster opt-in", () => {
    expect(() =>
      assertSafeProvisioningTarget({ ...SAFE_SETTINGS, isolatedTestOptIn: "" }),
    ).toThrow("DS_TEST_POSTGRES_ISOLATED_opt_in_required");
  });

  it("rejects a remotely hosted PostgreSQL target", () => {
    expect(() =>
      assertSafeProvisioningTarget({
        ...SAFE_SETTINGS,
        adminUrl:
          "postgres://postgres:secret@db.example.com/development_security_test_admin",
      }),
    ).toThrow("DS_TEST_DATABASE_URL_must_use_loopback");
  });

  it("rejects connection options that can override the loopback host", () => {
    expect(() =>
      assertSafeProvisioningTarget({
        ...SAFE_SETTINGS,
        adminUrl: `${SAFE_ADMIN_URL}?host=db.example.com`,
      }),
    ).toThrow("DS_TEST_DATABASE_URL_overrides_forbidden");
  });

  it("rejects an admin database outside the isolated test prefix", () => {
    expect(() =>
      assertSafeProvisioningTarget({
        ...SAFE_SETTINGS,
        adminUrl: SAFE_ADMIN_URL.replace(
          "development_security_test_admin",
          "postgres",
        ),
      }),
    ).toThrow("DS_TEST_DATABASE_URL_must_target_isolated_database");
  });

  it("requires a separator after the isolated test database prefix", () => {
    expect(() =>
      assertSafeProvisioningTarget({
        ...SAFE_SETTINGS,
        adminUrl: SAFE_ADMIN_URL.replace(
          "development_security_test_admin",
          "development_security_testx_admin",
        ),
      }),
    ).toThrow("DS_TEST_DATABASE_URL_must_target_isolated_database");
  });

  it("rejects a target database outside the isolated test prefix", () => {
    expect(() =>
      assertSafeProvisioningTarget({
        ...SAFE_SETTINGS,
        databaseName: "development_seguro",
      }),
    ).toThrow("DS_PROVISION_DATABASE_NAME_must_target_isolated_test_database");
  });

  it("validates unknown settings at runtime", () => {
    expect(() => assertSafeProvisioningTarget(null)).toThrow(
      "DS_PROVISION_SETTINGS_INVALID",
    );
  });

  it("stops before connecting when provisioning receives an unsafe target", async () => {
    await expect(
      provisionDevelopmentSecurityDatabase({
        ...SAFE_SETTINGS,
        isolatedTestOptIn: undefined,
      }),
    ).rejects.toThrow("DS_TEST_POSTGRES_ISOLATED_opt_in_required");
  });
});
