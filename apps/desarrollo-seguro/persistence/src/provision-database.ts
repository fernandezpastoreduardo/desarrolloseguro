import { Pool } from "pg";
import { pathToFileURL } from "node:url";
import { runDevelopmentSecurityMigrations } from "./run-migrations.js";
import {
  assertSafePostgresTestTarget,
  SAFE_POSTGRES_TEST_DATABASE_PREFIX,
} from "./postgres-test-safety.js";

const DEFAULT_DATABASE_NAME = `${SAFE_POSTGRES_TEST_DATABASE_PREFIX}local`;
const DATABASE_NAME_PATTERN = /^[a-z][a-z0-9_]{0,62}$/u;
const MANAGED_ROLE_COMMENT = "development_security: managed role v1";
const REQUIRED_SETTINGS = [
  "DS_PROVISION_ADMIN_URL",
  "DS_MIGRATOR_PASSWORD",
  "DS_API_PASSWORD",
  "DS_WORKER_PASSWORD",
] as const;
const INVALID_SETTINGS = "DS_PROVISION_SETTINGS_INVALID";
const UNSAFE_DATABASE_NAME =
  "DS_PROVISION_DATABASE_NAME_must_target_isolated_test_database";

export type ProvisioningSettings = {
  adminUrl: string;
  databaseName: string;
  migratorPassword: string;
  apiPassword: string;
  workerPassword: string;
  isolatedTestOptIn: string | undefined;
};

async function main(): Promise<void> {
  const settings = readSettings(process.env);
  await provisionDevelopmentSecurityDatabase(settings);
  process.stdout.write("development_security_database_ready\n");
}

export async function provisionDevelopmentSecurityDatabase(
  rawSettings: unknown,
): Promise<void> {
  const settings = assertSafeProvisioningTarget(rawSettings);
  const adminPool = new Pool({ connectionString: settings.adminUrl, max: 1 });
  try {
    await assertExpectedReadRoleMembers(adminPool);
    await ensureRole(adminPool, "ds_read", null);
    await ensureRole(adminPool, "ds_migrator", settings.migratorPassword);
    await ensureRole(adminPool, "ds_api", settings.apiPassword);
    await ensureRole(adminPool, "ds_worker", settings.workerPassword);
    await ensureDatabase(adminPool, settings.databaseName);
    await adminPool.query(
      `GRANT CONNECT ON DATABASE ${quoteIdentifier(settings.databaseName)}
       TO ds_read, ds_api, ds_worker, ds_migrator`,
    );
    await adminPool.query(
      `REVOKE ALL ON DATABASE ${quoteIdentifier(settings.databaseName)} FROM PUBLIC`,
    );
    await adminPool.query("REVOKE ds_read FROM ds_worker");
    await adminPool.query("GRANT ds_read TO ds_api");
  } finally {
    await adminPool.end();
  }

  const migratorPool = new Pool({
    connectionString: buildConnectionUrl(
      settings.adminUrl,
      settings.databaseName,
      "ds_migrator",
      settings.migratorPassword,
    ),
    max: 1,
  });
  try {
    await migratorPool.query(
      "REVOKE ALL ON SCHEMA public FROM PUBLIC; GRANT USAGE, CREATE ON SCHEMA public TO ds_migrator",
    );
    await runDevelopmentSecurityMigrations(migratorPool);
    await applyRuntimeGrants(migratorPool);
  } finally {
    await migratorPool.end();
  }
}

export function assertSafeProvisioningTarget(
  value: unknown,
): ProvisioningSettings {
  if (!isRecord(value)) throw new Error(INVALID_SETTINGS);
  const {
    adminUrl,
    databaseName,
    migratorPassword,
    apiPassword,
    workerPassword,
  } = value;
  if (
    !isNonEmptyString(adminUrl) ||
    !isNonEmptyString(databaseName) ||
    !isNonEmptyString(migratorPassword) ||
    !isNonEmptyString(apiPassword) ||
    !isNonEmptyString(workerPassword) ||
    (value.isolatedTestOptIn !== undefined &&
      typeof value.isolatedTestOptIn !== "string")
  ) {
    throw new Error(INVALID_SETTINGS);
  }
  if (!DATABASE_NAME_PATTERN.test(databaseName)) {
    throw new Error("development_security_database_name_invalid");
  }
  if (!databaseName.startsWith(SAFE_POSTGRES_TEST_DATABASE_PREFIX)) {
    throw new Error(UNSAFE_DATABASE_NAME);
  }
  const parsedAdminUrl = assertSafePostgresTestTarget(
    adminUrl,
    value.isolatedTestOptIn,
  );
  const adminDatabaseName = decodeURIComponent(
    parsedAdminUrl.pathname.slice(1),
  );
  if (
    !DATABASE_NAME_PATTERN.test(adminDatabaseName) ||
    !adminDatabaseName.startsWith(SAFE_POSTGRES_TEST_DATABASE_PREFIX) ||
    parsedAdminUrl.pathname !== `/${adminDatabaseName}`
  ) {
    throw new Error("development_security_admin_database_name_invalid");
  }
  return {
    adminUrl,
    databaseName,
    migratorPassword,
    apiPassword,
    workerPassword,
    isolatedTestOptIn: value.isolatedTestOptIn,
  };
}

function readSettings(environment: NodeJS.ProcessEnv): ProvisioningSettings {
  for (const name of REQUIRED_SETTINGS) {
    if (!environment[name])
      throw new Error("development_security_settings_missing");
  }

  const databaseName = environment.DS_DATABASE_NAME ?? DEFAULT_DATABASE_NAME;
  return assertSafeProvisioningTarget({
    adminUrl: environment.DS_PROVISION_ADMIN_URL,
    databaseName,
    migratorPassword: environment.DS_MIGRATOR_PASSWORD,
    apiPassword: environment.DS_API_PASSWORD,
    workerPassword: environment.DS_WORKER_PASSWORD,
    isolatedTestOptIn: environment.DS_TEST_POSTGRES_ISOLATED,
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

async function ensureRole(
  pool: Pool,
  roleName: "ds_read" | "ds_migrator" | "ds_api" | "ds_worker",
  password: string | null,
): Promise<void> {
  const existing = await pool.query<{
    role_exists: boolean;
    role_comment: string | null;
  }>(
    `SELECT EXISTS(SELECT 1 FROM pg_roles WHERE rolname = $1) AS role_exists,
       (SELECT shobj_description(oid, 'pg_authid') FROM pg_roles WHERE rolname = $1)
         AS role_comment`,
    [roleName],
  );
  if (
    existing.rows[0]?.role_exists &&
    existing.rows[0].role_comment !== MANAGED_ROLE_COMMENT
  ) {
    throw new Error("development_security_role_name_collision");
  }
  if (existing.rows[0]?.role_exists) {
    await assertExpectedRoleMemberships(pool, roleName);
  }
  if (roleName === "ds_read") {
    if (!existing.rows[0]?.role_exists) {
      await pool.query(
        `CREATE ROLE ${quoteIdentifier(roleName)} NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS`,
      );
    } else {
      await pool.query(
        `ALTER ROLE ${quoteIdentifier(roleName)} NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS`,
      );
    }
    await pool.query(
      `COMMENT ON ROLE ${quoteIdentifier(roleName)} IS ${quoteLiteral(MANAGED_ROLE_COMMENT)}`,
    );
    return;
  }

  if (!password) throw new Error("development_security_role_password_missing");
  const passwordSql = quoteLiteral(password);
  const roleSql = quoteIdentifier(roleName);
  if (existing.rows[0]?.role_exists) {
    await pool.query(
      `ALTER ROLE ${roleSql} WITH LOGIN INHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS PASSWORD ${passwordSql}`,
    );
    return;
  }
  await pool.query(
    `CREATE ROLE ${roleSql} WITH LOGIN INHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS PASSWORD ${passwordSql}`,
  );
  await pool.query(
    `COMMENT ON ROLE ${roleSql} IS ${quoteLiteral(MANAGED_ROLE_COMMENT)}`,
  );
}

async function assertExpectedRoleMemberships(
  pool: Pool,
  roleName: "ds_read" | "ds_migrator" | "ds_api" | "ds_worker",
): Promise<void> {
  const expected = roleName === "ds_api" ? ["ds_read"] : [];
  const memberships = await pool.query<{
    granted_role: string;
    admin_option: boolean;
  }>(
    `SELECT granted.rolname AS granted_role, membership.admin_option
     FROM pg_auth_members AS membership
     JOIN pg_roles AS granted ON granted.oid = membership.roleid
     JOIN pg_roles AS member ON member.oid = membership.member
     WHERE member.rolname = $1
     ORDER BY granted.rolname`,
    [roleName],
  );
  if (
    memberships.rows.length > 0 &&
    (memberships.rows.length !== expected.length ||
      memberships.rows.some(
        (row, index) =>
          row.granted_role !== expected[index] || row.admin_option,
      ))
  ) {
    if (
      roleName === "ds_worker" &&
      memberships.rows.length === 1 &&
      memberships.rows[0]?.granted_role === "ds_read"
    ) {
      await pool.query("REVOKE ds_read FROM ds_worker");
      return;
    }
    throw new Error("development_security_role_membership_mismatch");
  }
}

async function assertExpectedReadRoleMembers(pool: Pool): Promise<void> {
  const memberships = await pool.query<{
    member_role: string;
    admin_option: boolean;
  }>(
    `SELECT member.rolname AS member_role, membership.admin_option
     FROM pg_auth_members AS membership
     JOIN pg_roles AS granted ON granted.oid = membership.roleid
     JOIN pg_roles AS member ON member.oid = membership.member
     WHERE granted.rolname = 'ds_read'
     ORDER BY member.rolname`,
  );
  if (
    memberships.rows.some(
      ({ member_role, admin_option }) =>
        member_role !== "ds_api" || admin_option,
    )
  ) {
    throw new Error("development_security_role_membership_mismatch");
  }
}

async function ensureDatabase(pool: Pool, databaseName: string): Promise<void> {
  const database = await pool.query<{ owner: string }>(
    `SELECT pg_get_userbyid(datdba) AS owner
     FROM pg_database WHERE datname = $1`,
    [databaseName],
  );
  if (!database.rows[0]) {
    await pool.query(
      `CREATE DATABASE ${quoteIdentifier(databaseName)}
       OWNER ds_migrator TEMPLATE template0 ENCODING 'UTF8'`,
    );
    return;
  }
  if (database.rows[0].owner !== "ds_migrator") {
    throw new Error("development_security_database_owner_mismatch");
  }
}

async function applyRuntimeGrants(pool: Pool): Promise<void> {
  await pool.query(`
    GRANT USAGE ON SCHEMA public TO ds_read, ds_api, ds_worker;
    REVOKE ALL PRIVILEGES ON ALL TABLES IN SCHEMA public
      FROM ds_read, ds_api, ds_worker;
    GRANT SELECT (hostname, enrollment, profile_version, opted_out_at)
      ON public.ds_domains TO ds_read;
    GRANT SELECT (id, hostname, profile_version, state, queued_at)
      ON public.ds_scan_jobs TO ds_read;
    GRANT SELECT (id, hostname, profile_version, scanner_version, vantage,
      trigger, started_at, completed_at, expires_at, verdict, scope_json)
      ON public.ds_scan_runs TO ds_read;
    GRANT SELECT (
      run_id, control_id, status, required, severity, observed_at,
      target_path, method, summary, limitation
    ) ON public.ds_check_results TO ds_read;
    GRANT INSERT (hostname, enrollment, profile_version)
      ON public.ds_domains TO ds_api;
    GRANT INSERT (hostname, profile_version, trigger, state, queued_at, available_at)
      ON public.ds_scan_jobs TO ds_api;
    REVOKE UPDATE, DELETE, TRUNCATE ON ALL TABLES IN SCHEMA public
      FROM ds_read, ds_api, ds_worker;
    REVOKE INSERT ON ds_scan_runs, ds_check_results, ds_scan_metrics FROM ds_worker;
    REVOKE UPDATE (state, lease_until, lease_token, attempts, available_at,
      finished_at, public_error_code) ON ds_scan_jobs FROM ds_worker;
    GRANT EXECUTE ON FUNCTION ds_claim_next_scan(integer),
      ds_renew_scan_lease(uuid, uuid, integer),
      ds_recover_expired_scan_leases(integer),
      ds_complete_scan(uuid, uuid, timestamptz, text, timestamptz, text, jsonb, jsonb, jsonb)
      TO ds_worker;
    ALTER DEFAULT PRIVILEGES FOR ROLE ds_migrator IN SCHEMA public
      REVOKE SELECT ON TABLES FROM ds_read;
    ALTER DEFAULT PRIVILEGES FOR ROLE ds_migrator IN SCHEMA public
      REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
  `);
}

function buildConnectionUrl(
  baseUrl: string,
  databaseName: string,
  username: string,
  password: string,
): string {
  const databaseUrl = new URL(baseUrl);
  databaseUrl.pathname = `/${databaseName}`;
  databaseUrl.username = username;
  databaseUrl.password = password;
  return databaseUrl.toString();
}

function quoteIdentifier(value: string): string {
  return `"${value.replaceAll('"', '""')}"`;
}

function quoteLiteral(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  main().catch(() => {
    process.stderr.write("development_security_database_provisioning_failed\n");
    process.exitCode = 1;
  });
}
