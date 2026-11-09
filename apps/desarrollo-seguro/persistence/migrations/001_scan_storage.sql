-- deployment-rollback-compatible: true
CREATE TABLE IF NOT EXISTS ds_domains (
  hostname text PRIMARY KEY,
  enrollment text NOT NULL CHECK (enrollment IN ('monitored', 'on_demand')),
  profile_version text NOT NULL,
  opted_out_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS ds_scan_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hostname text NOT NULL REFERENCES ds_domains(hostname),
  profile_version text NOT NULL,
  trigger text NOT NULL CHECK (trigger IN ('scheduled', 'requested')),
  state text NOT NULL CHECK (state IN ('queued', 'running', 'completed', 'failed')),
  queued_at timestamptz NOT NULL DEFAULT now(),
  available_at timestamptz NOT NULL DEFAULT now(),
  lease_until timestamptz,
  lease_token uuid,
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  finished_at timestamptz,
  public_error_code text,
  CHECK ((state = 'running') = (lease_until IS NOT NULL)),
  CHECK ((state = 'running') = (lease_token IS NOT NULL))
);

CREATE UNIQUE INDEX IF NOT EXISTS ds_scan_jobs_one_active_per_domain_profile
  ON ds_scan_jobs(hostname, profile_version)
  WHERE state IN ('queued', 'running');

CREATE INDEX IF NOT EXISTS ds_scan_jobs_claimable
  ON ds_scan_jobs(available_at, queued_at)
  WHERE state = 'queued';

CREATE TABLE IF NOT EXISTS ds_scan_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id uuid NOT NULL UNIQUE REFERENCES ds_scan_jobs(id),
  hostname text NOT NULL REFERENCES ds_domains(hostname),
  profile_version text NOT NULL,
  scanner_version text NOT NULL,
  vantage text NOT NULL CHECK (vantage = 'same_vps'),
  trigger text NOT NULL CHECK (trigger IN ('scheduled', 'requested')),
  started_at timestamptz NOT NULL,
  completed_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  verdict text NOT NULL CHECK (verdict IN ('pass', 'fail', 'inconclusive')),
  scope_json jsonb NOT NULL,
  CHECK (expires_at = completed_at + interval '60 minutes'),
  CHECK (completed_at >= started_at)
);

CREATE INDEX IF NOT EXISTS ds_scan_runs_fresh_report
  ON ds_scan_runs(hostname, profile_version, completed_at DESC);

CREATE TABLE IF NOT EXISTS ds_check_results (
  run_id uuid NOT NULL REFERENCES ds_scan_runs(id),
  control_id text NOT NULL,
  status text NOT NULL CHECK (status IN ('pass', 'fail', 'unknown', 'not_applicable')),
  required boolean NOT NULL,
  severity text NOT NULL,
  observed_at timestamptz NOT NULL,
  target_path text NOT NULL,
  method text NOT NULL,
  summary text NOT NULL,
  limitation text NOT NULL,
  evidence_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  PRIMARY KEY (run_id, control_id, target_path, method)
);

CREATE TABLE IF NOT EXISTS ds_scan_metrics (
  run_id uuid PRIMARY KEY REFERENCES ds_scan_runs(id),
  requests_count integer NOT NULL CHECK (requests_count >= 0),
  bytes_count bigint NOT NULL CHECK (bytes_count >= 0),
  duration_ms integer NOT NULL CHECK (duration_ms >= 0),
  pages_count integer NOT NULL CHECK (pages_count >= 0)
);

CREATE OR REPLACE FUNCTION ds_reject_report_mutation() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' AND current_user = pg_get_userbyid(
    (SELECT relowner FROM pg_class WHERE oid = TG_RELID)
  ) THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'Development Security reports are immutable';
END;
$$;

DROP TRIGGER IF EXISTS ds_scan_runs_immutable ON ds_scan_runs;
CREATE TRIGGER ds_scan_runs_immutable
  BEFORE UPDATE OR DELETE ON ds_scan_runs
  FOR EACH ROW EXECUTE FUNCTION ds_reject_report_mutation();

DROP TRIGGER IF EXISTS ds_check_results_immutable ON ds_check_results;
CREATE TRIGGER ds_check_results_immutable
  BEFORE UPDATE OR DELETE ON ds_check_results
  FOR EACH ROW EXECUTE FUNCTION ds_reject_report_mutation();

DROP TRIGGER IF EXISTS ds_scan_metrics_immutable ON ds_scan_metrics;
CREATE TRIGGER ds_scan_metrics_immutable
  BEFORE UPDATE OR DELETE ON ds_scan_metrics
  FOR EACH ROW EXECUTE FUNCTION ds_reject_report_mutation();

CREATE OR REPLACE FUNCTION ds_purge_expired_reports(p_cutoff timestamptz)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  deleted_rows integer;
  total_deleted integer := 0;
BEGIN
  IF p_cutoff > now() - interval '90 days' THEN
    RAISE EXCEPTION 'report_retention_window_not_reached';
  END IF;

  DELETE FROM public.ds_scan_metrics AS metrics
  USING public.ds_scan_runs AS runs
  WHERE metrics.run_id = runs.id AND runs.completed_at < p_cutoff;
  GET DIAGNOSTICS deleted_rows = ROW_COUNT;
  total_deleted := total_deleted + deleted_rows;

  DELETE FROM public.ds_check_results AS checks
  USING public.ds_scan_runs AS runs
  WHERE checks.run_id = runs.id AND runs.completed_at < p_cutoff;
  GET DIAGNOSTICS deleted_rows = ROW_COUNT;
  total_deleted := total_deleted + deleted_rows;

  DELETE FROM public.ds_scan_runs WHERE completed_at < p_cutoff;
  GET DIAGNOSTICS deleted_rows = ROW_COUNT;
  total_deleted := total_deleted + deleted_rows;
  RETURN total_deleted;
END;
$$;

REVOKE ALL ON FUNCTION ds_purge_expired_reports(timestamptz) FROM PUBLIC;
