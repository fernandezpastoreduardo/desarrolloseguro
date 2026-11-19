-- Beta testing policy: keep the 60-minute report cache, but allow a new
-- requested scan after that cache expires. The production 24-hour admission
-- window will be restored in a later, explicitly approved migration.
CREATE OR REPLACE FUNCTION public.ds_ensure_fresh_scan(
  p_hostname text,
  p_profile_version text,
  p_trigger text
)
RETURNS TABLE (outcome text, entity_id uuid)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  existing_report uuid;
  existing_job public.ds_scan_jobs%ROWTYPE;
  domain_enrollment text;
  domain_opted_out_at timestamptz;
  now_at timestamptz := clock_timestamp();
  queued_jobs integer;
  inserted_job uuid;
BEGIN
  IF p_hostname IS NULL OR length(p_hostname) = 0
    OR p_profile_version IS NULL OR length(p_profile_version) = 0
    OR p_trigger IS NULL OR p_trigger NOT IN ('scheduled', 'requested') THEN
    RAISE EXCEPTION 'invalid_scan_admission_input';
  END IF;

  PERFORM pg_advisory_xact_lock(728194034);

  SELECT domains.enrollment, domains.opted_out_at
  INTO domain_enrollment, domain_opted_out_at
  FROM public.ds_domains AS domains
  WHERE domains.hostname = p_hostname
  FOR SHARE;
  IF NOT FOUND OR domain_opted_out_at IS NOT NULL
    OR (
      p_trigger = 'scheduled'
      AND domain_enrollment <> 'monitored'
      AND NOT EXISTS (
        SELECT 1
        FROM public.ds_beta_certifications AS certifications
        WHERE certifications.hostname = p_hostname
          AND certifications.policy_version = 'beta-0.1'
          AND certifications.state = 'active'
      )
    ) THEN
    RETURN QUERY SELECT 'unavailable'::text, NULL::uuid;
    RETURN;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.ds_profile_controls AS profiles
    WHERE profiles.profile_version = p_profile_version
  ) THEN
    RAISE EXCEPTION 'invalid_scan_admission_profile';
  END IF;

  SELECT reports.id INTO existing_report
  FROM public.ds_scan_runs AS reports
  WHERE reports.hostname = p_hostname
    AND reports.profile_version = p_profile_version
    AND reports.completed_at <= now_at
    AND reports.completed_at > now_at - interval '60 minutes'
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
    p_hostname, p_profile_version, p_trigger, 'queued', now_at, now_at
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

REVOKE ALL ON FUNCTION public.ds_ensure_fresh_scan(text, text, text)
  FROM PUBLIC;
