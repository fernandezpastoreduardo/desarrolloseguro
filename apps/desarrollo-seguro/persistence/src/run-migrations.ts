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
  { version: "007_transport_v1", file: "007_transport_v1.sql" },
  { version: "008_bounded_scan_retries", file: "008_bounded_scan_retries.sql" },
  { version: "009_single_global_scan_slot", file: "009_single_global_scan_slot.sql" },
  {
    version: "010_shared_scan_admission_quotas",
    file: "010_shared_scan_admission_quotas.sql",
  },
  {
    version: "011_harden_scan_admission",
    file: "011_harden_scan_admission.sql",
  },
  {
    version: "012_temporarily_disable_scan_cooldown",
    file: "012_temporarily_disable_scan_cooldown.sql",
  },
  {
    version: "013_temporarily_disable_report_cache",
    file: "013_temporarily_disable_report_cache.sql",
  },
  {
    version: "014_domain_v1_initial_cookie_evidence",
    file: "014_domain_v1_initial_cookie_evidence.sql",
  },
  {
    version: "015_domain_v1_for_existing_domains",
    file: "015_domain_v1_for_existing_domains.sql",
  },
  { version: "016_report_badges", file: "016_report_badges.sql" },
  {
    version: "017_safe_scan_failure_categories",
    file: "017_safe_scan_failure_categories.sql",
  },
  {
    version: "018_domain_v2_tracking_performance",
    file: "018_domain_v2_tracking_performance.sql",
  },
  {
    version: "019_domain_v3_tls_version_matrix",
    file: "019_domain_v3_tls_version_matrix.sql",
  },
  {
    version: "020_tls_probe_diagnostic_evidence",
    file: "020_tls_probe_diagnostic_evidence.sql",
  },
  { version: "021_safe_scan_failure_diagnostics", file: "021_safe_scan_failure_diagnostics.sql" },
  {
    version: "022_tls_probe_summary_contract",
    file: "022_tls_probe_summary_contract.sql",
  },
  {
    version: "023_beta_certification_lifecycle",
    file: "023_beta_certification_lifecycle.sql",
  },
  {
    version: "024_public_report_inactivity_retention",
    file: "024_public_report_inactivity_retention.sql",
  },
  {
    version: "025_enable_public_scan_admission_policies",
    file: "025_enable_public_scan_admission_policies.sql",
  },
  {
    version: "026_certification_audit_scheduler",
    file: "026_certification_audit_scheduler.sql",
  },
  {
    version: "027_retry_after_failed_scan",
    file: "027_retry_after_failed_scan.sql",
  },
  {
    version: "028_guard_certification_report_order",
    file: "028_guard_certification_report_order.sql",
  },
  {
    version: "029_temporarily_disable_scan_admission_window",
    file: "029_temporarily_disable_scan_admission_window.sql",
  },
  {
    version: "030_temporarily_disable_report_cache",
    file: "030_temporarily_disable_report_cache.sql",
  },
  {
    version: "031_grumphya_hostname_redirect_evidence",
    file: "031_grumphya_hostname_redirect_evidence.sql",
  },
  {
    version: "032_solistos_privacy_assessments",
    file: "032_solistos_privacy_assessments.sql",
  },
  {
    version: "033_certification_refresh_headroom",
    file: "033_certification_refresh_headroom.sql",
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
