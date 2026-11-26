CREATE TABLE public.ds_scan_admission_epoch (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton IS TRUE),
  advanced_at timestamptz NOT NULL
);

INSERT INTO public.ds_scan_admission_epoch(singleton, advanced_at)
VALUES (true, clock_timestamp());

REVOKE ALL ON public.ds_scan_admission_epoch FROM PUBLIC;

CREATE FUNCTION public.ds_advance_scan_admission_epoch()
RETURNS timestamptz
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  new_epoch timestamptz;
BEGIN
  PERFORM pg_advisory_xact_lock(728194034);
  UPDATE public.ds_scan_admission_epoch
  SET advanced_at = clock_timestamp()
  WHERE singleton IS TRUE
  RETURNING advanced_at INTO new_epoch;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'scan_admission_epoch_missing';
  END IF;
  RETURN new_epoch;
END;
$$;

REVOKE ALL ON FUNCTION public.ds_advance_scan_admission_epoch() FROM PUBLIC;

CREATE OR REPLACE FUNCTION public.ds_ensure_fresh_url_scan(
  p_hostname text,
  p_target_url text
)
RETURNS TABLE (outcome text, entity_id uuid)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  now_at timestamptz := clock_timestamp();
  deployment_epoch timestamptz;
  target_path text;
  existing_report uuid;
  existing_job public.ds_scan_jobs%ROWTYPE;
  prior_admission timestamptz;
  queued_jobs integer;
  inserted_job uuid;
BEGIN
  IF NOT public.ds_valid_scan_target_url(p_hostname, p_target_url) THEN
    RAISE EXCEPTION 'invalid_scan_target_url';
  END IF;
  PERFORM pg_advisory_xact_lock(728194034);
  IF NOT EXISTS (
    SELECT 1 FROM public.ds_domains AS domains
    WHERE domains.hostname = p_hostname AND domains.opted_out_at IS NULL
  ) OR NOT EXISTS (
    SELECT 1 FROM public.ds_profile_controls WHERE profile_version = 'domain-v5'
  ) THEN
    RETURN QUERY SELECT 'unavailable'::text, NULL::uuid; RETURN;
  END IF;
  SELECT state.advanced_at INTO deployment_epoch
  FROM public.ds_scan_admission_epoch AS state
  WHERE state.singleton IS TRUE;
  IF deployment_epoch IS NULL THEN
    RAISE EXCEPTION 'scan_admission_epoch_missing';
  END IF;
  target_path := regexp_replace(p_target_url, '^https://[^/?#]+', '');
  IF target_path = '' THEN target_path := '/';
  ELSIF left(target_path, 1) = '?' THEN target_path := '/' || target_path;
  END IF;

  SELECT reports.id INTO existing_report
  FROM public.ds_scan_runs AS reports
  INNER JOIN public.ds_scan_jobs AS scan_jobs
    ON scan_jobs.id = reports.job_id
  WHERE reports.hostname = p_hostname AND reports.profile_version = 'domain-v5'
    AND reports.scope_json @> jsonb_build_array(target_path)
    AND scan_jobs.queued_at > deployment_epoch
    AND reports.completed_at <= now_at AND reports.completed_at > now_at - interval '60 minutes'
  ORDER BY reports.completed_at DESC LIMIT 1;
  IF existing_report IS NOT NULL THEN
    RETURN QUERY SELECT 'cached'::text, existing_report; RETURN;
  END IF;
  SELECT jobs.* INTO existing_job FROM public.ds_scan_jobs AS jobs
  WHERE jobs.hostname = p_hostname AND jobs.profile_version = 'domain-v5'
    AND jobs.target_url = p_target_url AND jobs.state IN ('queued', 'running') LIMIT 1;
  IF FOUND THEN RETURN QUERY SELECT existing_job.state, existing_job.id; RETURN; END IF;
  IF EXISTS (
    SELECT 1 FROM public.ds_scan_jobs AS jobs
    WHERE jobs.hostname = p_hostname AND jobs.trigger = 'requested'
      AND jobs.state IN ('queued', 'running')
  ) THEN
    RETURN QUERY SELECT 'rate_limited'::text, NULL::uuid; RETURN;
  END IF;
  SELECT reports.completed_at INTO prior_admission
  FROM public.ds_scan_runs AS reports
  INNER JOIN public.ds_scan_jobs AS scan_jobs
    ON scan_jobs.id = reports.job_id
  WHERE reports.hostname = p_hostname
    AND reports.profile_version = 'domain-v5'
    AND reports.trigger = 'requested'
    AND reports.scope_json @> jsonb_build_array(target_path)
    AND scan_jobs.queued_at > deployment_epoch
    AND reports.completed_at <= now_at
    AND reports.completed_at > now_at - interval '24 hours'
  ORDER BY reports.completed_at DESC LIMIT 1;
  IF prior_admission IS NOT NULL THEN
    RETURN QUERY SELECT 'rate_limited'::text, NULL::uuid; RETURN;
  END IF;
  SELECT count(*)::integer INTO queued_jobs FROM public.ds_scan_jobs AS jobs WHERE jobs.state = 'queued';
  IF queued_jobs >= 10 THEN RETURN QUERY SELECT 'capacity_reached'::text, NULL::uuid; RETURN; END IF;
  INSERT INTO public.ds_scan_jobs(hostname, profile_version, trigger, state, queued_at, available_at, target_url)
  VALUES (p_hostname, 'domain-v5', 'requested', 'queued', now_at, now_at, p_target_url)
  ON CONFLICT(hostname, profile_version, target_url)
    WHERE state IN ('queued', 'running') AND target_url IS NOT NULL DO NOTHING
  RETURNING id INTO inserted_job;
  IF inserted_job IS NULL THEN
    SELECT jobs.* INTO existing_job FROM public.ds_scan_jobs AS jobs
    WHERE jobs.hostname = p_hostname AND jobs.profile_version = 'domain-v5'
      AND jobs.target_url = p_target_url AND jobs.state IN ('queued', 'running') LIMIT 1;
    IF NOT FOUND THEN RAISE EXCEPTION 'active_target_url_job_missing_after_conflict'; END IF;
    RETURN QUERY SELECT existing_job.state, existing_job.id; RETURN;
  END IF;
  RETURN QUERY SELECT 'queued'::text, inserted_job;
END;
$$;

REVOKE ALL ON FUNCTION public.ds_ensure_fresh_url_scan(text, text) FROM PUBLIC;
