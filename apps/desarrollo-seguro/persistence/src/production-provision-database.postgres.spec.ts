import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  provisionProductionDevelopmentSecurityDatabase,
  type ProductionProvisioningSettings,
} from "./production-provision-database.js";
import {
  isSafePostgresTestTarget,
  POSTGRES_TEST_OPT_IN,
} from "./postgres-test-safety.js";

const ADMIN_DATABASE_URL = process.env.DS_TEST_DATABASE_URL;
const TEST_OPT_IN = process.env[POSTGRES_TEST_OPT_IN];
const TARGET_DATABASE_NAME = "development_security_test_production_bootstrap";
const MIGRATOR_PASSWORD = "development-security-production-migrator-test-only";
const API_PASSWORD = "development-security-production-api-test-only";
const ROLE_NAMES = ["ds_read", "ds_migrator", "ds_api"];
const TEST_CA = `-----BEGIN CERTIFICATE-----
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
const describePostgres = isSafePostgresTestTarget(
  ADMIN_DATABASE_URL,
  TEST_OPT_IN,
)
  ? describe
  : describe.skip;

describePostgres.sequential(
  "DS production bootstrap PostgreSQL integration",
  () => {
    let adminPool: Pool | undefined;
    let targetPool: Pool | undefined;
    let targetAdminPool: Pool | undefined;
    let targetDatabaseWasAbsent = false;
    let rolesWereAbsent = false;

    beforeAll(async () => {
      if (!ADMIN_DATABASE_URL) return;
      adminPool = new Pool({ connectionString: ADMIN_DATABASE_URL, max: 1 });
      const existing = await adminPool.query<{
        database_exists: boolean;
        role_count: number;
      }>(
        `SELECT
         EXISTS(SELECT 1 FROM pg_database WHERE datname = $1) AS database_exists,
         (SELECT count(*)::integer FROM pg_roles WHERE rolname = ANY($2)) AS role_count`,
        [TARGET_DATABASE_NAME, ROLE_NAMES],
      );
      if (
        existing.rows[0]?.database_exists ||
        existing.rows[0]?.role_count !== 0
      ) {
        throw new Error("development_security_test_cluster_must_be_clean");
      }
      targetDatabaseWasAbsent = true;
      rolesWereAbsent = true;

      const targetUrl = new URL(ADMIN_DATABASE_URL);
      targetUrl.pathname = `/${TARGET_DATABASE_NAME}`;
      targetUrl.username = "ds_api";
      targetUrl.password = API_PASSWORD;
      targetPool = new Pool({ connectionString: targetUrl.toString(), max: 1 });
      const targetAdminUrl = new URL(ADMIN_DATABASE_URL);
      targetAdminUrl.pathname = `/${TARGET_DATABASE_NAME}`;
      targetAdminPool = new Pool({
        connectionString: targetAdminUrl.toString(),
        max: 1,
      });

      const settings: ProductionProvisioningSettings = {
        adminUrl: ADMIN_DATABASE_URL,
        apiDatabaseUrl: targetUrl.toString(),
        databaseName: TARGET_DATABASE_NAME,
        migratorPassword: MIGRATOR_PASSWORD,
        tlsCa: TEST_CA,
        bootstrapEnabled: "1",
        testPostgresIsolated: TEST_OPT_IN,
      };
      await provisionProductionDevelopmentSecurityDatabase(settings);
    });

    afterAll(async () => {
      if (!adminPool) return;
      try {
        await targetPool?.end();
        await targetAdminPool?.end();
        if (targetDatabaseWasAbsent) {
          await adminPool.query(
            `DROP DATABASE IF EXISTS "${TARGET_DATABASE_NAME}" WITH (FORCE)`,
          );
        }
        if (rolesWereAbsent) {
          await adminPool.query("REVOKE ds_read FROM ds_api");
          await adminPool.query(
            "DROP ROLE IF EXISTS ds_api, ds_read, ds_migrator",
          );
        }
      } finally {
        await adminPool.end();
      }
    });

    it("creates the exact DS schema with non-privileged roles and only API reader membership", async () => {
      const adminState = await adminPool?.query<{
        database_owner: string;
        api_superuser: boolean;
        api_createdb: boolean;
        api_createrole: boolean;
        migrator_superuser: boolean;
        migrator_createdb: boolean;
        reader_login: boolean;
        api_member_of_reader: boolean;
        worker_role_exists: boolean;
      }>(
        `SELECT
         (SELECT pg_get_userbyid(datdba) FROM pg_database WHERE datname = $1) AS database_owner,
         (SELECT rolsuper FROM pg_roles WHERE rolname = 'ds_api') AS api_superuser,
         (SELECT rolcreatedb FROM pg_roles WHERE rolname = 'ds_api') AS api_createdb,
         (SELECT rolcreaterole FROM pg_roles WHERE rolname = 'ds_api') AS api_createrole,
         (SELECT rolsuper FROM pg_roles WHERE rolname = 'ds_migrator') AS migrator_superuser,
         (SELECT rolcreatedb FROM pg_roles WHERE rolname = 'ds_migrator') AS migrator_createdb,
         (SELECT rolcanlogin FROM pg_roles WHERE rolname = 'ds_read') AS reader_login,
         pg_has_role('ds_api', 'ds_read', 'MEMBER') AS api_member_of_reader,
         EXISTS(SELECT 1 FROM pg_roles WHERE rolname = 'ds_worker') AS worker_role_exists`,
        [TARGET_DATABASE_NAME],
      );

      expect(adminState?.rows[0]).toEqual({
        database_owner: "ds_migrator",
        api_superuser: false,
        api_createdb: false,
        api_createrole: false,
        migrator_superuser: false,
        migrator_createdb: false,
        reader_login: false,
        api_member_of_reader: true,
        worker_role_exists: false,
      });
      const migrationCount = await targetAdminPool?.query(
        "SELECT count(*)::integer AS count FROM public.ds_schema_migrations",
      );
      expect(migrationCount?.rows[0]?.count).toBe(6);
    });

    it("applies column-scoped runtime grants and does not grant schema ownership to the API", async () => {
      const access = await targetPool?.query<{
        api_can_select_public_columns: boolean;
        api_cannot_read_evidence: boolean;
        api_cannot_read_lease_token: boolean;
        api_cannot_select_all_metrics: boolean;
        api_cannot_insert_jobs: boolean;
        api_cannot_create_objects: boolean;
        api_is_not_table_owner: boolean;
      }>(
        `SELECT
         has_column_privilege('ds_api', 'public.ds_check_results', 'summary', 'SELECT') AS api_can_select_public_columns,
         NOT has_column_privilege('ds_api', 'public.ds_check_results', 'evidence_json', 'SELECT') AS api_cannot_read_evidence,
         NOT has_column_privilege('ds_api', 'public.ds_scan_jobs', 'lease_token', 'SELECT') AS api_cannot_read_lease_token,
         NOT has_table_privilege('ds_api', 'public.ds_scan_metrics', 'SELECT') AS api_cannot_select_all_metrics,
         NOT has_column_privilege('ds_api', 'public.ds_scan_jobs', 'hostname', 'INSERT') AS api_cannot_insert_jobs,
         NOT has_schema_privilege('ds_api', 'public', 'CREATE') AS api_cannot_create_objects,
         NOT EXISTS (
           SELECT 1 FROM pg_class AS relation
           JOIN pg_namespace AS namespace ON namespace.oid = relation.relnamespace
           JOIN pg_roles AS owner ON owner.oid = relation.relowner
           WHERE namespace.nspname = 'public' AND relation.relkind IN ('r', 'p')
             AND owner.rolname = 'ds_api'
         ) AS api_is_not_table_owner`,
      );
      expect(access?.rows[0]).toEqual({
        api_can_select_public_columns: true,
        api_cannot_read_evidence: true,
        api_cannot_read_lease_token: true,
        api_cannot_select_all_metrics: true,
        api_cannot_insert_jobs: true,
        api_cannot_create_objects: true,
        api_is_not_table_owner: true,
      });
    });

    it("is idempotent and leaves the expected migration state", async () => {
      if (!ADMIN_DATABASE_URL) return;
      const targetUrl = new URL(ADMIN_DATABASE_URL);
      targetUrl.username = "ds_api";
      targetUrl.password = API_PASSWORD;
      targetUrl.pathname = `/${TARGET_DATABASE_NAME}`;
      await provisionProductionDevelopmentSecurityDatabase({
        adminUrl: ADMIN_DATABASE_URL,
        apiDatabaseUrl: targetUrl.toString(),
        databaseName: TARGET_DATABASE_NAME,
        migratorPassword: MIGRATOR_PASSWORD,
        tlsCa: TEST_CA,
        bootstrapEnabled: "1",
        testPostgresIsolated: TEST_OPT_IN,
      });
      const migrationCount = await targetAdminPool?.query(
        "SELECT count(*)::integer AS count FROM public.ds_schema_migrations",
      );
      expect(migrationCount?.rows[0]?.count).toBe(6);
    });
  },
);
