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
  {
    version: "034_coordinator_failure_diagnostics",
    file: "034_coordinator_failure_diagnostics.sql",
  },
  {
    version: "035_processor_transparency_reports",
    file: "035_processor_transparency_reports.sql",
  },
  {
    version: "036_self_domain_processor_transparency",
    file: "036_self_domain_processor_transparency.sql",
  },
  {
    version: "037_public_internal_audit_summary",
    file: "037_public_internal_audit_summary.sql",
  },
  {
    version: "038_public_policy_transparency_domain_v4",
    file: "038_public_policy_transparency_domain_v4.sql",
  },
  {
    version: "039_public_policy_transparency",
    file: "039_public_policy_transparency.sql",
  },
  {
    version: "040_public_probe_error_diagnostics",
    file: "040_public_probe_error_diagnostics.sql",
  },
  {
    version: "041_privacy_probe_error_summary",
    file: "041_privacy_probe_error_summary.sql",
  },
  {
    version: "042_public_service_comparisons",
    file: "042_public_service_comparisons.sql",
  },
  { version: "043_legal_cookie_findings", file: "043_legal_cookie_findings.sql" },
  { version: "044_provider_catalog_versions", file: "044_provider_catalog_versions.sql" },
  { version: "045_first_entry_policy_access", file: "045_first_entry_policy_access.sql" },
  { version: "046_provider_catalog_discoveries", file: "046_provider_catalog_discoveries.sql" },
  { version: "047_provider_discovery_optional_path", file: "047_provider_discovery_optional_path.sql" },
  { version: "048_provider_catalog_discovery_evidence_merge", file: "048_provider_catalog_discovery_evidence_merge.sql" },
  { version: "049_provider_discovery_document_facts", file: "049_provider_discovery_document_facts.sql" },
  { version: "050_information_notice_policy_access", file: "050_information_notice_policy_access.sql" },
  { version: "051_first_entry_policy_visit", file: "051_first_entry_policy_visit.sql" },
  { version: "052_scan_payload_diagnostics", file: "052_scan_payload_diagnostics.sql" },
  { version: "053_transport_failed_summary_parity", file: "053_transport_failed_summary_parity.sql" },
  { version: "054_runtime_failure_phases", file: "054_runtime_failure_phases.sql" },
  { version: "055_runtime_boundary_diagnostics", file: "055_runtime_boundary_diagnostics.sql" },
  { version: "056_isolated_executor_diagnostics", file: "056_isolated_executor_diagnostics.sql" },
  { version: "057_worker_composition_diagnostics", file: "057_worker_composition_diagnostics.sql" },
  { version: "058_document_discovery_diagnostics", file: "058_document_discovery_diagnostics.sql" },
  { version: "059_catalog_rejection_diagnostics", file: "059_catalog_rejection_diagnostics.sql" },
  { version: "060_service_comparison_provider_documentation", file: "060_service_comparison_provider_documentation.sql" },
  { version: "061_legal_cookie_blocked_request_evidence", file: "061_legal_cookie_blocked_request_evidence.sql" },
  { version: "062_public_browser_evidence_contract", file: "062_public_browser_evidence_contract.sql" },
  { version: "063_exact_target_url_jobs", file: "063_exact_target_url_jobs.sql" },
  { version: "064_target_url_admission_cooldown", file: "064_target_url_admission_cooldown.sql" },
  { version: "065_deploy_refresh_scan_admission", file: "065_deploy_refresh_scan_admission.sql" },
  { version: "066_domain_v5_persistence_contract", file: "066_domain_v5_persistence_contract.sql" },
  { version: "067_domain_v5_browser_summary_contract", file: "067_domain_v5_browser_summary_contract.sql" },
  { version: "068_public_audit_progress", file: "068_public_audit_progress.sql" },
  { version: "069_domain_v5_host_check_scope", file: "069_domain_v5_host_check_scope.sql" },
  { version: "070_domain_v5_mobile_lighthouse_metrics", file: "070_domain_v5_mobile_lighthouse_metrics.sql" },
  { version: "071_domain_v5_mobile_score_version", file: "071_domain_v5_mobile_score_version.sql" },
  { version: "072_privacy_v2_cookie_audit", file: "072_privacy_v2_cookie_audit.sql" },
  { version: "073_domain_v5_performance_diagnostics", file: "073_domain_v5_performance_diagnostics.sql" },
  { version: "074_runtime_broker_startup_diagnostics", file: "074_runtime_broker_startup_diagnostics.sql" },
  { version: "070_temporary_fresh_report_refresh", file: "070_temporary_fresh_report_refresh.sql" },
] as const;

export const DEVELOPMENT_SECURITY_MIGRATION_COUNT = MIGRATIONS.length;

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
