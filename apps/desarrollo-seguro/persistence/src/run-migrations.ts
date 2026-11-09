import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import type { Pool } from "pg";

const MIGRATIONS = [
  { version: "001_scan_storage", file: "001_scan_storage.sql" },
  { version: "002_owner_only_retention", file: "002_owner_only_retention.sql" },
  {
    version: "003_guarded_worker_operations",
    file: "003_guarded_worker_operations.sql",
  },
  { version: "004_scan_payload_guards", file: "004_scan_payload_guards.sql" },
  {
    version: "005_controls_v2_route_coverage",
    file: "005_controls_v2_route_coverage.sql",
  },
  {
    version: "006_controls_v3_https_headers",
    file: "006_controls_v3_https_headers.sql",
  },
] as const;

const MIGRATION_LOCK_ID = 728194032;

export async function runDevelopmentSecurityMigrations(
  pool: Pool,
): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock($1)", [MIGRATION_LOCK_ID]);
    await client.query(
      `CREATE TABLE IF NOT EXISTS ds_schema_migrations (
         version text PRIMARY KEY,
         applied_at timestamptz NOT NULL DEFAULT now()
       )`,
    );

    for (const migration of MIGRATIONS) {
      const applied = await client.query(
        "SELECT version FROM ds_schema_migrations WHERE version = $1",
        [migration.version],
      );
      if (applied.rowCount) continue;

      const migrationPath = new URL(
        `../migrations/${migration.file}`,
        import.meta.url,
      );
      const sql = await readFile(fileURLToPath(migrationPath), "utf8");
      await client.query(sql);
      await client.query(
        "INSERT INTO ds_schema_migrations(version) VALUES($1)",
        [migration.version],
      );
    }
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
