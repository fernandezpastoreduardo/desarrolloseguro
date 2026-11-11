CREATE OR REPLACE FUNCTION public.ds_ensure_fresh_scan(
  p_hostname text,
  p_profile_version text,
  p_trigger text,
  p_now timestamptz
)
RETURNS TABLE (outcome text, entity_id uuid)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  existing_report uuid;
  existing_job public.ds_scan_jobs%ROWTYPE;
  prior_admission timestamptz;
  queued_jobs integer;
  inserted_job uuid;
BEGIN
  IF p_hostname IS NULL OR length(p_hostname) = 0
    OR p_profile_version IS NULL OR length(p_profile_version) = 0
    OR p_trigger IS NULL OR p_trigger NOT IN ('scheduled', 'requested')
    OR p_now IS NULL THEN
    RAISE EXCEPTION 'invalid_scan_admission_input';
  END IF;

  PERFORM pg_advisory_xact_lock(728194034);

  SELECT reports.id INTO existing_report
  FROM public.ds_scan_runs AS reports
  WHERE reports.hostname = p_hostname
    AND reports.profile_version = p_profile_version
    AND reports.completed_at <= p_now
    AND reports.completed_at > p_now - interval '60 minutes'
  ORDER BY reports.completed_at DESC
  LIMIT 1;
  IF existing_report IS NOT NULL THEN
    RETURN QUERY SELECT 'cached'::text, existing_report;
    RETURN;
  END IF;

  SELECT jobs.* INTO existing_job
  FROM public.ds_scan_jobs AS jobs
  WHERE jobs.hostname = p_hostname
    AND jobs.profile_version = p_profile_version
    AND jobs.state IN ('queued', 'running')
  LIMIT 1;
  IF FOUND THEN
    RETURN QUERY SELECT existing_job.state, existing_job.id;
    RETURN;
  END IF;

  SELECT jobs.queued_at INTO prior_admission
  FROM public.ds_scan_jobs AS jobs
  WHERE jobs.hostname = p_hostname
    AND jobs.profile_version = p_profile_version
    AND jobs.queued_at > clock_timestamp() - interval '24 hours'
  ORDER BY jobs.queued_at DESC
  LIMIT 1;
  IF prior_admission IS NOT NULL THEN
    RETURN QUERY SELECT 'rate_limited'::text, NULL::uuid;
    RETURN;
  END IF;

  SELECT count(*)::integer INTO queued_jobs
  FROM public.ds_scan_jobs AS jobs
  WHERE jobs.state = 'queued';
  IF queued_jobs >= 10 THEN
    RETURN QUERY SELECT 'capacity_reached'::text, NULL::uuid;
    RETURN;
  END IF;

  INSERT INTO public.ds_scan_jobs(
    hostname, profile_version, trigger, state, queued_at, available_at
  ) VALUES (
    p_hostname, p_profile_version, p_trigger, 'queued',
    clock_timestamp(), clock_timestamp()
  )
  ON CONFLICT(hostname, profile_version)
    WHERE state IN ('queued', 'running') DO NOTHING
  RETURNING id INTO inserted_job;

  IF inserted_job IS NULL THEN
    SELECT jobs.* INTO existing_job
    FROM public.ds_scan_jobs AS jobs
    WHERE jobs.hostname = p_hostname
      AND jobs.profile_version = p_profile_version
      AND jobs.state IN ('queued', 'running')
    LIMIT 1;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'active_scan_job_missing_after_conflict';
    END IF;
    RETURN QUERY SELECT existing_job.state, existing_job.id;
    RETURN;
  END IF;

  RETURN QUERY SELECT 'queued'::text, inserted_job;
END;
$$;

REVOKE ALL ON FUNCTION public.ds_ensure_fresh_scan(text, text, text, timestamptz)
  FROM PUBLIC;

CREATE INDEX IF NOT EXISTS ds_scan_jobs_hostname_profile_queued_at
  ON public.ds_scan_jobs(hostname, profile_version, queued_at DESC);
