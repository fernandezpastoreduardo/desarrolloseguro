-- Re-enable the production public-scan cache and 24-hour admission window after beta validation.
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

  SELECT jobs.queued_at INTO prior_admission
  FROM public.ds_scan_jobs AS jobs
  WHERE jobs.hostname = p_hostname
    AND jobs.queued_at > now_at - interval '24 hours'
    AND p_trigger = 'requested'
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

CREATE OR REPLACE FUNCTION public.ds_claim_next_scan(p_lease_duration_ms integer)
RETURNS TABLE (
  id uuid,
  hostname text,
  profile_version text,
  trigger text,
  attempts integer,
  lease_token uuid,
  lease_until timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF p_lease_duration_ms IS NULL OR p_lease_duration_ms < 1
    OR p_lease_duration_ms > 300000 THEN
    RAISE EXCEPTION 'invalid_scan_lease_duration';
  END IF;

  PERFORM pg_advisory_xact_lock(728194033);
  IF EXISTS (
    SELECT 1 FROM public.ds_scan_jobs WHERE state = 'running'
  ) THEN
    RETURN;
  END IF;

  RETURN QUERY
  UPDATE public.ds_scan_jobs AS jobs
  SET state = 'running', lease_until = clock_timestamp()
        + p_lease_duration_ms * interval '1 millisecond',
      lease_token = gen_random_uuid(), attempts = jobs.attempts + 1
  WHERE jobs.id = (
    SELECT candidate.id FROM public.ds_scan_jobs AS candidate
    WHERE candidate.state = 'queued' AND candidate.available_at <= clock_timestamp()
    ORDER BY (candidate.trigger = 'requested') DESC, candidate.queued_at, candidate.id
    LIMIT 1 FOR UPDATE SKIP LOCKED
  )
  RETURNING jobs.id, jobs.hostname, jobs.profile_version, jobs.trigger,
    jobs.attempts, jobs.lease_token, jobs.lease_until;
END;
$$;

REVOKE ALL ON FUNCTION public.ds_claim_next_scan(integer) FROM PUBLIC;

CREATE OR REPLACE FUNCTION public.ds_enqueue_due_certification_scans(p_now timestamptz)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  target record;
  admission record;
  enqueued_rows integer := 0;
BEGIN
  IF p_now IS NULL OR p_now > clock_timestamp() + interval '5 minutes' THEN
    RAISE EXCEPTION 'invalid_certification_audit_clock';
  END IF;

  PERFORM pg_advisory_xact_lock(728194034);
  FOR target IN
    SELECT certifications.hostname, domains.profile_version
    FROM public.ds_beta_certifications AS certifications
    INNER JOIN public.ds_domains AS domains
      ON domains.hostname = certifications.hostname
    WHERE certifications.policy_version = 'beta-0.1'
      AND certifications.state = 'active'
      AND certifications.last_checked_at <= p_now - interval '1 hour'
      AND domains.opted_out_at IS NULL
      AND domains.profile_version IN ('domain-v1', 'domain-v2', 'domain-v3')
    ORDER BY certifications.last_checked_at, certifications.hostname
  LOOP
    SELECT outcome, entity_id
    INTO admission
    FROM public.ds_ensure_fresh_scan(
      target.hostname, target.profile_version, 'scheduled'
    );
    IF admission.outcome = 'queued' THEN
      enqueued_rows := enqueued_rows + 1;
    END IF;
  END LOOP;

  RETURN enqueued_rows;
END;
$$;

REVOKE ALL ON FUNCTION public.ds_enqueue_due_certification_scans(timestamptz) FROM PUBLIC;
