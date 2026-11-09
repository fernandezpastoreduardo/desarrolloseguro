import { beforeEach, describe, expect, it, vi } from "vitest";

const poolConstructor = vi.hoisted(() => vi.fn());
const poolQuery = vi.hoisted(() => vi.fn());
const poolEnd = vi.hoisted(() => vi.fn());

vi.mock("pg", () => ({
  Pool: class {
    constructor(options: unknown) {
      poolConstructor(options);
    }

    query = poolQuery;
    end = poolEnd;
  },
}));

import {
  assertSafeProvisioningTarget,
  provisionDevelopmentSecurityDatabase,
  type ProvisioningSettings,
} from "./provision-database.js";

const SAFE_SETTINGS: ProvisioningSettings = {
  adminUrl:
    "postgres://postgres:local-only@127.0.0.1/development_security_test_admin",
  databaseName: "development_security_test_provisioned",
  migratorPassword: "migrator-local-only",
  apiPassword: "api-local-only",
  workerPassword: "worker-local-only",
  isolatedTestOptIn: "1",
};
const MANAGED_ROLE_COMMENT = "development_security: managed role v1";

const INVALID_PROVISIONING_SETTINGS: Array<{
  label: string;
  value: unknown;
  error: string;
}> = [
  {
    label: "missing opt-in",
    value: { ...SAFE_SETTINGS, isolatedTestOptIn: undefined },
    error: "DS_TEST_POSTGRES_ISOLATED_opt_in_required",
  },
  {
    label: "remote host hidden behind URL user information",
    value: {
      ...SAFE_SETTINGS,
      adminUrl:
        "postgres://postgres@127.0.0.1@db.example.com/development_security_test_admin",
    },
    error: "DS_TEST_DATABASE_URL_must_use_loopback",
  },
  {
    label: "host override query parameter",
    value: {
      ...SAFE_SETTINGS,
      adminUrl: `${SAFE_SETTINGS.adminUrl}?host=db.example.com`,
    },
    error: "DS_TEST_DATABASE_URL_overrides_forbidden",
  },
  {
    label: "encoded path separator in the admin database name",
    value: {
      ...SAFE_SETTINGS,
      adminUrl:
        "postgres://postgres:local-only@127.0.0.1/development_security_test_admin%2fother",
    },
    error: "development_security_admin_database_name_invalid",
  },
  {
    label: "unsafe database name",
    value: { ...SAFE_SETTINGS, databaseName: "development_security_test;DROP" },
    error: "development_security_database_name_invalid",
  },
  {
    label: "unexpected object shape",
    value: [],
    error: "DS_PROVISION_SETTINGS_INVALID",
  },
];

describe("provisionDevelopmentSecurityDatabase preflight", () => {
  beforeEach(() => {
    poolConstructor.mockClear();
    poolQuery.mockReset();
    poolEnd.mockReset();
  });

  it.each(INVALID_PROVISIONING_SETTINGS)(
    "rejects $label before constructing a PostgreSQL Pool",
    async ({ value, error }) => {
      expect(() => assertSafeProvisioningTarget(value)).toThrow(error);
      await expect(provisionDevelopmentSecurityDatabase(value)).rejects.toThrow(
        error,
      );
      expect(poolConstructor).not.toHaveBeenCalled();
    },
  );

  it.each([
    { member_role: "ds_worker", admin_option: false },
    { member_role: "ds_api", admin_option: true },
  ])(
    "rejects unsafe incoming membership on ds_read: %o",
    async (membership) => {
      poolQuery.mockResolvedValueOnce({ rows: [membership] });

      await expect(
        provisionDevelopmentSecurityDatabase(SAFE_SETTINGS),
      ).rejects.toThrow("development_security_role_membership_mismatch");
      expect(poolQuery).toHaveBeenCalledTimes(1);
      expect(poolEnd).toHaveBeenCalledOnce();
    },
  );

  it("rejects ds_api membership in ds_read with admin_option", async () => {
    poolQuery.mockImplementation(async (sql: unknown, values?: unknown[]) => {
      const statement = String(sql);
      if (statement.includes("WHERE granted.rolname = 'ds_read'")) {
        return { rows: [] };
      }
      if (statement.includes("SELECT EXISTS(SELECT 1 FROM pg_roles")) {
        const roleName = values?.[0];
        return {
          rows: [
            {
              role_exists: roleName !== "ds_migrator",
              role_comment: MANAGED_ROLE_COMMENT,
            },
          ],
        };
      }
      if (statement.includes("WHERE member.rolname = $1")) {
        return {
          rows:
            values?.[0] === "ds_api"
              ? [{ granted_role: "ds_read", admin_option: true }]
              : [],
        };
      }
      return { rows: [] };
    });

    await expect(
      provisionDevelopmentSecurityDatabase(SAFE_SETTINGS),
    ).rejects.toThrow("development_security_role_membership_mismatch");
    expect(poolConstructor).toHaveBeenCalledOnce();
    expect(poolEnd).toHaveBeenCalledOnce();
    expect(poolQuery).toHaveBeenCalledWith(
      expect.stringContaining("WHERE member.rolname = $1"),
      ["ds_api"],
    );
  });
});
