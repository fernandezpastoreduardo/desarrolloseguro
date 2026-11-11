DROP FUNCTION IF EXISTS public.ds_ensure_fresh_scan(text, text, text, timestamptz);

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
  prior_admission timestamptz;
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
    OR (p_trigger = 'scheduled' AND domain_enrollment <> 'monitored') THEN
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

  SELECT jobs.queued_at INTO prior_admission
  FROM public.ds_scan_jobs AS jobs
  WHERE jobs.hostname = p_hostname
    AND jobs.queued_at > now_at - interval '24 hours'
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

CREATE INDEX IF NOT EXISTS ds_scan_jobs_hostname_queued_at
  ON public.ds_scan_jobs(hostname, queued_at DESC);
DROP INDEX IF EXISTS public.ds_scan_jobs_hostname_profile_queued_at;

CREATE OR REPLACE FUNCTION public.ds_request_on_demand_scan(p_hostname text)
RETURNS TABLE (outcome text, entity_id uuid)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  target_profile text;
  target_opted_out_at timestamptz;
  on_demand_domains integer;
  admission record;
BEGIN
  IF p_hostname IS NULL OR octet_length(p_hostname) > 253
    OR p_hostname <> lower(p_hostname)
    OR p_hostname ~ '[^a-z0-9.-]'
    OR p_hostname !~ '\.'
    OR p_hostname ~ '(^\.|\.$|\.\.|^[0-9]+(\.[0-9]+){3}$)'
    OR EXISTS (
      SELECT 1 FROM unnest(string_to_array(p_hostname, '.')) AS labels(label)
      WHERE length(label) > 63
        OR label !~ '^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$'
    ) THEN
    RAISE EXCEPTION 'invalid_scan_admission_hostname';
  END IF;

  PERFORM pg_advisory_xact_lock(728194034);

  IF NOT EXISTS (
    SELECT 1 FROM public.ds_domains AS domains
    WHERE domains.hostname = p_hostname
  ) THEN
    SELECT count(*)::integer INTO on_demand_domains
    FROM public.ds_domains AS domains
    WHERE domains.enrollment = 'on_demand';
    IF on_demand_domains >= 1000 THEN
      RETURN QUERY SELECT 'capacity_reached'::text, NULL::uuid;
      RETURN;
    END IF;

    INSERT INTO public.ds_domains(hostname, enrollment, profile_version)
    VALUES (p_hostname, 'on_demand', 'transport-v1')
    ON CONFLICT(hostname) DO NOTHING;
  END IF;

  SELECT domains.profile_version, domains.opted_out_at
  INTO target_profile, target_opted_out_at
  FROM public.ds_domains AS domains
  WHERE domains.hostname = p_hostname
  FOR SHARE;
  IF NOT FOUND OR target_opted_out_at IS NOT NULL THEN
    RETURN QUERY SELECT 'unavailable'::text, NULL::uuid;
    RETURN;
  END IF;

  SELECT result.outcome, result.entity_id INTO admission
  FROM public.ds_ensure_fresh_scan(p_hostname, target_profile, 'requested') AS result;
  RETURN QUERY SELECT admission.outcome::text, admission.entity_id::uuid;
END;
$$;

REVOKE ALL ON FUNCTION public.ds_request_on_demand_scan(text) FROM PUBLIC;
