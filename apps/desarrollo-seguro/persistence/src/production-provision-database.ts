import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { X509Certificate } from "node:crypto";
import { checkServerIdentity } from "node:tls";
import { Pool, type PoolConfig } from "pg";
import { runDevelopmentSecurityMigrations } from "./run-migrations.js";
import { assertSafePostgresTestTarget } from "./postgres-test-safety.js";

const BOOTSTRAP_ENABLED_VALUE = "1";
const PRODUCTION_DATABASE_NAME = "desarrollo_seguro";
const PRODUCTION_DATABASE_HOST = "development-security-database";
const PRODUCTION_ADMIN_ROLE = "ds_bootstrap";
const TEST_ADMIN_ROLE = "postgres";
const TEST_DATABASE_PREFIX = "development_security_test_";
const ROLE_COMMENT = "development_security: managed role v1";
const MIGRATOR_ROLE = "ds_migrator";
const API_ROLE = "ds_api";
const READ_ROLE = "ds_read";
const PRODUCTION_OPT_IN_ERROR = "DS_PRODUCTION_BOOTSTRAP_ENABLED_required";
const SETTINGS_ERROR = "DS_PRODUCTION_PROVISION_SETTINGS_invalid";
const TARGET_ERROR =
  "DS_PRODUCTION_DATABASE_NAME_must_match_dedicated_database";
const ADMIN_URL_ERROR = "DS_PRODUCTION_ADMIN_URL_invalid";
const CA_ERROR = "DS_PRODUCTION_TLS_CA_invalid";
const PEM_CERTIFICATE_PATTERN =
  /-----BEGIN CERTIFICATE-----[\s\S]+?-----END CERTIFICATE-----/g;

export interface ProductionProvisioningSettings {
  adminUrl: string;
  apiDatabaseUrl: string;
  databaseName: string;
  migratorPassword: string;
  tlsCa: string;
  bootstrapEnabled: string | undefined;
  testPostgresIsolated: string | undefined;
}

export function assertSafeProductionProvisioningTarget(
  value: unknown,
): ProductionProvisioningSettings {
  if (!isRecord(value)) throw new Error(SETTINGS_ERROR);
  const settings = value as Partial<ProductionProvisioningSettings>;
  if (
    settings.bootstrapEnabled !== BOOTSTRAP_ENABLED_VALUE ||
    !isNonEmptyString(settings.adminUrl) ||
    !isNonEmptyString(settings.apiDatabaseUrl) ||
    !isNonEmptyString(settings.databaseName) ||
    !isNonEmptyString(settings.migratorPassword) ||
    !isNonEmptyString(settings.tlsCa) ||
    (settings.testPostgresIsolated !== undefined &&
      typeof settings.testPostgresIsolated !== "string")
  ) {
    if (settings.bootstrapEnabled !== BOOTSTRAP_ENABLED_VALUE) {
      throw new Error(PRODUCTION_OPT_IN_ERROR);
    }
    throw new Error(SETTINGS_ERROR);
  }

  const parsedCa = parseCertificateAuthority(settings.tlsCa);
  if (!parsedCa) throw new Error(CA_ERROR);

  const testMode = settings.testPostgresIsolated === "1";
  const target = parseAdminUrl(settings.adminUrl, testMode);
  if (!testMode && settings.databaseName !== PRODUCTION_DATABASE_NAME) {
    throw new Error(TARGET_ERROR);
  }
  if (testMode) {
    assertSafePostgresTestTarget(
      settings.adminUrl,
      settings.testPostgresIsolated,
    );
    const adminDatabaseName = decodeURIComponent(target.pathname.slice(1));
    if (
      !isSafeDatabaseName(settings.databaseName) ||
      !settings.databaseName.startsWith(TEST_DATABASE_PREFIX) ||
      !isSafeDatabaseName(adminDatabaseName) ||
      !adminDatabaseName.startsWith(TEST_DATABASE_PREFIX)
    ) {
      throw new Error("DS_TEST_DATABASE_URL_must_target_isolated_database");
    }
    if (decodeURIComponent(target.username) !== TEST_ADMIN_ROLE) {
      throw new Error(ADMIN_URL_ERROR);
    }
  }
  parseApiDatabaseUrl(
    settings.apiDatabaseUrl,
    settings.databaseName,
    testMode,
    target,
  );

  return {
    adminUrl: settings.adminUrl,
    apiDatabaseUrl: settings.apiDatabaseUrl,
    databaseName: settings.databaseName,
    migratorPassword: settings.migratorPassword,
    tlsCa: settings.tlsCa,
    bootstrapEnabled: settings.bootstrapEnabled,
    testPostgresIsolated: settings.testPostgresIsolated,
  };
}

export async function provisionProductionDevelopmentSecurityDatabase(
  rawSettings: unknown,
): Promise<void> {
  const settings = assertSafeProductionProvisioningTarget(rawSettings);
  const testMode = settings.testPostgresIsolated === "1";
  const target = parseAdminUrl(settings.adminUrl, testMode);
  const tls = testMode ? {} : resolveTlsConfiguration(settings.tlsCa);
  const adminPool = new Pool({
    connectionString: settings.adminUrl,
    max: 1,
    ...tls,
  });
  const apiPassword = decodeURIComponent(
    parseApiDatabaseUrl(
      settings.apiDatabaseUrl,
      settings.databaseName,
      testMode,
      target,
    ).password,
  );

  try {
    await assertManagedRoleMemberships(adminPool);
    await ensureRole(adminPool, READ_ROLE, null, false);
    await ensureRole(adminPool, MIGRATOR_ROLE, settings.migratorPassword, true);
    await ensureRole(adminPool, API_ROLE, apiPassword, true);
    await ensureDatabase(adminPool, settings.databaseName);
    await adminPool.query(
      `GRANT CONNECT ON DATABASE ${quoteIdentifier(settings.databaseName)}
       TO ${READ_ROLE}, ${API_ROLE}, ${MIGRATOR_ROLE}`,
    );
    await adminPool.query(
      `REVOKE ALL ON DATABASE ${quoteIdentifier(settings.databaseName)} FROM PUBLIC`,
    );
    await adminPool.query(`GRANT ${READ_ROLE} TO ${API_ROLE}`);
  } finally {
    await adminPool.end();
  }

  const migratorUrl = buildConnectionUrl(
    target,
    settings.databaseName,
    MIGRATOR_ROLE,
    settings.migratorPassword,
  );
  const migratorPool = new Pool({
    connectionString: migratorUrl,
    max: 1,
    ...tls,
  });
  try {
    await migratorPool.query("REVOKE ALL ON SCHEMA public FROM PUBLIC");
    await migratorPool.query(`ALTER SCHEMA public OWNER TO ${MIGRATOR_ROLE}`);
    await migratorPool.query(
      `GRANT USAGE, CREATE ON SCHEMA public TO ${MIGRATOR_ROLE}`,
    );
    await runDevelopmentSecurityMigrations(migratorPool);
    await applyApiRuntimeGrants(migratorPool);
  } finally {
    await migratorPool.end();
  }
}

function readSettings(
  environment: NodeJS.ProcessEnv,
): ProductionProvisioningSettings {
  return assertSafeProductionProvisioningTarget({
    adminUrl: readSecretFile(environment.DS_PRODUCTION_ADMIN_URL_FILE),
    apiDatabaseUrl: readSecretFile(
      environment.DS_PRODUCTION_API_DATABASE_URL_FILE,
    ),
    databaseName: environment.DS_PRODUCTION_DATABASE_NAME,
    migratorPassword: readSecretFile(
      environment.DS_PRODUCTION_MIGRATOR_PASSWORD_FILE,
    ),
    tlsCa: readSecretFile(environment.DS_PRODUCTION_TLS_CA_FILE),
    bootstrapEnabled: environment.DS_PRODUCTION_BOOTSTRAP_ENABLED,
    testPostgresIsolated: environment.DS_TEST_POSTGRES_ISOLATED,
  });
}

function readSecretFile(path: string | undefined): string {
  if (!path) throw new Error(SETTINGS_ERROR);
  try {
    const value = readFileSync(path, "utf8").replace(/\r?\n$/u, "");
    if (!value || value.includes("\n") || value.includes("\r")) {
      throw new Error(SETTINGS_ERROR);
    }
    return value;
  } catch {
    throw new Error(SETTINGS_ERROR);
  }
}

function parseAdminUrl(adminUrl: string, testMode: boolean): URL {
  let parsed: URL;
  try {
    parsed = new URL(adminUrl);
  } catch {
    throw new Error(ADMIN_URL_ERROR);
  }
  const protocolIsPostgres =
    parsed.protocol === "postgres:" || parsed.protocol === "postgresql:";
  const isLoopback = new Set(["localhost", "127.0.0.1", "::1"]).has(
    parsed.hostname.replace(/^\[|\]$/gu, "").toLowerCase(),
  );
  if (
    !protocolIsPostgres ||
    parsed.search ||
    parsed.hash ||
    !parsed.password ||
    parsed.pathname === "/" ||
    (testMode && !isLoopback) ||
    (!testMode &&
      (parsed.hostname !== PRODUCTION_DATABASE_HOST ||
        parsed.port !== "5432" ||
        parsed.pathname !== "/postgres" ||
        decodeURIComponent(parsed.username) !== PRODUCTION_ADMIN_ROLE))
  ) {
    throw new Error(ADMIN_URL_ERROR);
  }
  return parsed;
}

function parseApiDatabaseUrl(
  apiDatabaseUrl: string,
  databaseName: string,
  testMode: boolean,
  adminUrl: URL,
): URL {
  let parsed: URL;
  try {
    parsed = new URL(apiDatabaseUrl);
  } catch {
    throw new Error("DS_PRODUCTION_API_DATABASE_URL_invalid");
  }
  const loopbackHosts = new Set(["localhost", "127.0.0.1", "::1"]);
  const hostname = parsed.hostname.replace(/^\[|\]$/gu, "").toLowerCase();
  const exactHostIsValid = testMode
    ? loopbackHosts.has(hostname) &&
      hostname === adminUrl.hostname.replace(/^\[|\]$/gu, "").toLowerCase() &&
      parsed.port === adminUrl.port
    : hostname === PRODUCTION_DATABASE_HOST;
  if (
    (parsed.protocol !== "postgres:" && parsed.protocol !== "postgresql:") ||
    !exactHostIsValid ||
    (!testMode && parsed.port !== "5432") ||
    parsed.pathname !== `/${databaseName}` ||
    decodeURIComponent(parsed.username) !== API_ROLE ||
    !parsed.password ||
    parsed.search ||
    parsed.hash
  ) {
    throw new Error("DS_PRODUCTION_API_DATABASE_URL_invalid");
  }
  return parsed;
}

function parseCertificateAuthority(ca: string): boolean {
  const certificates = [...ca.matchAll(PEM_CERTIFICATE_PATTERN)].map(
    ([certificate]) => certificate,
  );
  if (
    certificates.length === 0 ||
    ca.replace(PEM_CERTIFICATE_PATTERN, "").trim().length > 0
  ) {
    return false;
  }
  try {
    return certificates.every((pem) => new X509Certificate(pem).ca);
  } catch {
    return false;
  }
}

function resolveTlsConfiguration(ca: string): Pick<PoolConfig, "ssl"> {
  if (!parseCertificateAuthority(ca)) throw new Error(CA_ERROR);
  return {
    ssl: {
      ca,
      checkServerIdentity,
      minVersion: "TLSv1.2",
      rejectUnauthorized: true,
    },
  };
}

async function ensureRole(
  pool: Pool,
  roleName: typeof READ_ROLE | typeof MIGRATOR_ROLE | typeof API_ROLE,
  password: string | null,
  login: boolean,
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
    existing.rows[0]?.role_comment !== ROLE_COMMENT
  ) {
    throw new Error("DS_PRODUCTION_MANAGED_ROLE_COLLISION");
  }
  const roleSql = quoteIdentifier(roleName);
  if (login) {
    if (!password) throw new Error(SETTINGS_ERROR);
    const roleAttributes = `LOGIN INHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS PASSWORD ${quoteLiteral(password)}`;
    await pool.query(
      existing.rows[0]?.role_exists
        ? `ALTER ROLE ${roleSql} WITH ${roleAttributes}`
        : `CREATE ROLE ${roleSql} WITH ${roleAttributes}`,
    );
  } else {
    await pool.query(
      existing.rows[0]?.role_exists
        ? `ALTER ROLE ${roleSql} NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS`
        : `CREATE ROLE ${roleSql} NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS`,
    );
  }
  if (!existing.rows[0]?.role_exists) {
    await pool.query(
      `COMMENT ON ROLE ${roleSql} IS ${quoteLiteral(ROLE_COMMENT)}`,
    );
  }
}

async function assertManagedRoleMemberships(pool: Pool): Promise<void> {
  const memberships = await pool.query<{
    member_role: string;
    granted_role: string;
    admin_option: boolean;
  }>(
    `SELECT member.rolname AS member_role, granted.rolname AS granted_role,
       membership.admin_option
     FROM pg_auth_members AS membership
     JOIN pg_roles AS granted ON granted.oid = membership.roleid
     JOIN pg_roles AS member ON member.oid = membership.member
     WHERE member.rolname = ANY($1) OR granted.rolname = $2
     ORDER BY member.rolname, granted.rolname`,
    [[READ_ROLE, MIGRATOR_ROLE, API_ROLE], READ_ROLE],
  );
  if (
    memberships.rows.some(
      (membership) =>
        membership.member_role !== API_ROLE ||
        membership.granted_role !== READ_ROLE ||
        membership.admin_option,
    )
  ) {
    throw new Error("DS_PRODUCTION_ROLE_MEMBERSHIP_mismatch");
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
       OWNER ${MIGRATOR_ROLE} TEMPLATE template0 ENCODING 'UTF8'`,
    );
    return;
  }
  if (database.rows[0].owner !== MIGRATOR_ROLE) {
    throw new Error("DS_PRODUCTION_DATABASE_OWNER_mismatch");
  }
}

async function applyApiRuntimeGrants(pool: Pool): Promise<void> {
  await pool.query(`
    GRANT USAGE ON SCHEMA public TO ${READ_ROLE}, ${API_ROLE};
    REVOKE ALL PRIVILEGES ON ALL TABLES IN SCHEMA public
      FROM ${READ_ROLE}, ${API_ROLE};
    GRANT SELECT (hostname, enrollment, profile_version, opted_out_at)
      ON public.ds_domains TO ${READ_ROLE};
    GRANT SELECT (id, hostname, profile_version, state, queued_at)
      ON public.ds_scan_jobs TO ${READ_ROLE};
    GRANT SELECT (id, hostname, profile_version, scanner_version, vantage,
      trigger, started_at, completed_at, expires_at, verdict, scope_json)
      ON public.ds_scan_runs TO ${READ_ROLE};
    GRANT SELECT (
      run_id, control_id, status, required, severity, observed_at,
      target_path, method, summary, limitation
    ) ON public.ds_check_results TO ${READ_ROLE};
    REVOKE UPDATE, DELETE, TRUNCATE ON ALL TABLES IN SCHEMA public
      FROM ${READ_ROLE}, ${API_ROLE};
    ALTER DEFAULT PRIVILEGES FOR ROLE ${MIGRATOR_ROLE} IN SCHEMA public
      REVOKE SELECT ON TABLES FROM ${READ_ROLE};
    ALTER DEFAULT PRIVILEGES FOR ROLE ${MIGRATOR_ROLE} IN SCHEMA public
      REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
  `);
}

function buildConnectionUrl(
  baseUrl: URL,
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

function isSafeDatabaseName(value: string): boolean {
  return /^[a-z][a-z0-9_]{0,62}$/u.test(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  try {
    await provisionProductionDevelopmentSecurityDatabase(
      readSettings(process.env),
    );
    process.stdout.write("development_security_production_database_ready\n");
  } catch {
    process.stderr.write(
      "development_security_production_database_setup_failed\n",
    );
    process.exitCode = 1;
  }
}
