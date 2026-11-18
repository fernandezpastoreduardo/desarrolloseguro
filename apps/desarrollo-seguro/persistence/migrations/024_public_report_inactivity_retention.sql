CREATE OR REPLACE FUNCTION public.ds_purge_inactive_public_reports(p_cutoff timestamptz)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  deleted_rows integer;
  total_deleted integer := 0;
BEGIN
  IF p_cutoff > now() - interval '30 days' THEN
    RAISE EXCEPTION 'public_report_inactivity_window_not_reached';
  END IF;

  DROP TABLE IF EXISTS pg_temp.ds_inactive_public_report_candidates;
  CREATE TEMP TABLE ds_inactive_public_report_candidates(
    run_id uuid,
    job_id uuid
  )
  ON COMMIT DROP;

  INSERT INTO pg_temp.ds_inactive_public_report_candidates(run_id, job_id)
  SELECT reports.id, reports.job_id
  FROM public.ds_scan_runs AS reports
  INNER JOIN public.ds_domains AS domains ON domains.hostname = reports.hostname
  WHERE domains.enrollment = 'on_demand'
    AND reports.profile_version IN ('domain-v1', 'domain-v2', 'domain-v3')
    AND reports.completed_at < p_cutoff
    AND NOT EXISTS (
      SELECT 1
      FROM public.ds_beta_certifications AS certifications
      WHERE certifications.hostname = reports.hostname
        AND certifications.state = 'active'
    )
    AND NOT EXISTS (
      SELECT 1
      FROM public.ds_beta_certifications AS certifications
      WHERE certifications.certified_report_id = reports.id
    );

  DELETE FROM public.ds_scan_metrics AS metrics
  USING pg_temp.ds_inactive_public_report_candidates AS candidates
  WHERE metrics.run_id = candidates.run_id;
  GET DIAGNOSTICS deleted_rows = ROW_COUNT;
  total_deleted := total_deleted + deleted_rows;

  DELETE FROM public.ds_check_results AS checks
  USING pg_temp.ds_inactive_public_report_candidates AS candidates
  WHERE checks.run_id = candidates.run_id;
  GET DIAGNOSTICS deleted_rows = ROW_COUNT;
  total_deleted := total_deleted + deleted_rows;

  DELETE FROM public.ds_scan_runs AS reports
  USING pg_temp.ds_inactive_public_report_candidates AS candidates
  WHERE reports.id = candidates.run_id;
  GET DIAGNOSTICS deleted_rows = ROW_COUNT;
  total_deleted := total_deleted + deleted_rows;

  DELETE FROM public.ds_scan_jobs AS jobs
  USING pg_temp.ds_inactive_public_report_candidates AS candidates
  WHERE jobs.id = candidates.job_id;
  GET DIAGNOSTICS deleted_rows = ROW_COUNT;
  total_deleted := total_deleted + deleted_rows;

  RETURN total_deleted;
END;
$$;

REVOKE ALL ON FUNCTION public.ds_purge_inactive_public_reports(timestamptz) FROM PUBLIC;
