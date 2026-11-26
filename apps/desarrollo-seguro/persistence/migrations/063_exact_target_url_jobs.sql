-- Keep exact on-demand URL targets only while their job is queued or running.
-- Completed reports retain the exact target in the immutable scope_json.
ALTER TABLE public.ds_scan_jobs
  ADD COLUMN target_url text;

CREATE OR REPLACE FUNCTION public.ds_valid_scan_target_url(p_hostname text, p_target_url text)
RETURNS boolean
LANGUAGE plpgsql
IMMUTABLE
SET search_path = pg_catalog, public
AS $$
DECLARE
  authority text;
BEGIN
  IF p_hostname IS NULL OR p_target_url IS NULL
    OR octet_length(p_target_url) > 2048
    OR p_target_url !~ '^https://[a-z0-9.-]+(:443)?([/?][^#[:space:]]*)?(\?[^#[:space:]]*)?$'
    OR p_target_url ~ '[#[:cntrl:][:space:]]' THEN
    RETURN false;
  END IF;
  authority := (regexp_match(p_target_url, '^https://([^/?#]+)'))[1];
  authority := regexp_replace(authority, ':443$', '');
  RETURN authority = p_hostname;
END;
$$;

ALTER TABLE public.ds_scan_jobs
  ADD CONSTRAINT ds_scan_jobs_target_url_guard
  CHECK (
    target_url IS NULL OR (
      trigger = 'requested' AND profile_version = 'domain-v5'
      AND public.ds_valid_scan_target_url(hostname, target_url)
    )
  );

-- Keep a separate active slot per exact URL while retaining one legacy NULL
-- target slot for scheduled and pre-URL jobs.
DROP INDEX public.ds_scan_jobs_one_active_per_domain_profile;
CREATE UNIQUE INDEX ds_scan_jobs_one_active_per_domain_profile
  ON public.ds_scan_jobs(hostname, profile_version)
  WHERE state IN ('queued', 'running') AND target_url IS NULL;
CREATE UNIQUE INDEX ds_scan_jobs_one_active_per_target_url
  ON public.ds_scan_jobs(hostname, profile_version, target_url)
  WHERE state IN ('queued', 'running') AND target_url IS NOT NULL;

CREATE INDEX ds_scan_jobs_active_url_lookup
  ON public.ds_scan_jobs(hostname, profile_version, target_url, queued_at DESC)
  WHERE state IN ('queued', 'running') AND target_url IS NOT NULL;

-- domain-v5 has the same controls and methods as domain-v4; its scoped report
-- contains exactly the requested page rather than the legacy three routes.
INSERT INTO public.ds_profile_controls(profile_version, control_id, required)
SELECT 'domain-v5', control_id, required
FROM public.ds_profile_controls
WHERE profile_version = 'domain-v4'
ON CONFLICT(profile_version, control_id) DO NOTHING;

INSERT INTO public.ds_profile_check_rules(profile_version, control_id, target_kind, method)
SELECT 'domain-v5', control_id, target_kind, method
FROM public.ds_profile_check_rules
WHERE profile_version = 'domain-v4'
ON CONFLICT(profile_version, control_id, target_kind, method) DO NOTHING;

-- Replace the scope guard with a dual contract: legacy profiles keep the
-- fixed route list, while domain-v5 accepts one bounded path plus query.
CREATE OR REPLACE FUNCTION public.ds_validate_scan_scope_before_insert()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
DECLARE
  path_count integer;
  unique_path_count integer;
BEGIN
  IF NEW.profile_version = 'domain-v5' THEN
    IF jsonb_typeof(NEW.scope_json) <> 'array'
      OR jsonb_array_length(NEW.scope_json) <> 1
      OR jsonb_typeof(NEW.scope_json->0) <> 'string'
      OR length(NEW.scope_json->>0) > 2048
      OR NEW.scope_json->>0 !~ '^/[^#[:cntrl:][:space:]]*$' THEN
      RAISE EXCEPTION 'scan_scope_not_allowlisted';
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.profile_version NOT IN (
      'controls-v1', 'controls-v2', 'controls-v3', 'transport-v1',
      'domain-v1', 'domain-v2', 'domain-v3', 'domain-v4'
    )
    OR jsonb_typeof(NEW.scope_json) <> 'array'
    OR jsonb_array_length(NEW.scope_json) < 1
    OR jsonb_array_length(NEW.scope_json) > 3
    OR NOT NEW.scope_json @> '["/"]'::jsonb
    OR EXISTS (
      SELECT 1 FROM jsonb_array_elements(NEW.scope_json) AS paths(path)
      WHERE jsonb_typeof(path) <> 'string'
        OR path #>> '{}' NOT IN ('/', '/precios', '/informe')
    ) THEN
    RAISE EXCEPTION 'scan_scope_not_allowlisted';
  END IF;
  SELECT count(*)::integer, count(DISTINCT path)::integer
  INTO path_count, unique_path_count
  FROM jsonb_array_elements_text(NEW.scope_json) AS paths(path);
  IF path_count <> unique_path_count
    OR (NEW.profile_version = 'transport-v1' AND NEW.scope_json <> '["/"]'::jsonb) THEN
    RAISE EXCEPTION 'scan_scope_not_allowlisted';
  END IF;
  RETURN NEW;
END;
$$;

-- The URL-target profile reuses the control contract, but binds route checks
-- to its sole exact scope path (including query); legacy guards stay intact.
DO $$
DECLARE
  function_definition text;
  updated_definition text;
BEGIN
  SELECT pg_get_functiondef('public.ds_validate_check_result_before_insert()'::regprocedure)
  INTO function_definition;
  updated_definition := function_definition;
  updated_definition := replace(
    updated_definition,
    $old$'domain-v1', 'domain-v2', 'domain-v3', 'domain-v4', 'transport-v1'$old$,
    $new$'domain-v1', 'domain-v2', 'domain-v3', 'domain-v4', 'domain-v5', 'transport-v1'$new$
  );
  updated_definition := replace(
    updated_definition,
    $old$OR NEW.target_path NOT IN ('/', '/precios', '/informe') THEN$old$,
    $new$OR (run_profile_version <> 'domain-v5' AND NEW.target_path NOT IN ('/', '/precios', '/informe'))
    OR (run_profile_version = 'domain-v5' AND length(NEW.target_path) > 2048) THEN$new$
  );
  updated_definition := replace(
    updated_definition,
    $old$WHEN run_profile_version IN ('controls-v3', 'domain-v1', 'domain-v2', 'domain-v3', 'domain-v4', 'transport-v1')$old$,
    $new$WHEN run_profile_version IN ('controls-v3', 'domain-v1', 'domain-v2', 'domain-v3', 'domain-v4', 'domain-v5', 'transport-v1')$new$
  );
  IF updated_definition = function_definition
    OR position('domain-v5' IN updated_definition) = 0
    OR position('length(NEW.target_path) > 2048' IN updated_definition) = 0 THEN
    RAISE EXCEPTION 'domain_v5_check_validator_extension_failed';
  END IF;
  EXECUTE updated_definition;

  SELECT pg_get_functiondef('public.ds_validate_profile_check_coverage()'::regprocedure)
  INTO function_definition;
  updated_definition := replace(
    function_definition,
    $old$'domain-v1', 'domain-v2', 'domain-v3', 'domain-v4', 'transport-v1'$old$,
    $new$'domain-v1', 'domain-v2', 'domain-v3', 'domain-v4', 'domain-v5', 'transport-v1'$new$
  );
  IF updated_definition = function_definition OR position('domain-v5' IN updated_definition) = 0 THEN
    RAISE EXCEPTION 'domain_v5_coverage_validator_extension_failed';
  END IF;
  EXECUTE updated_definition;
END;
$$;

-- The existing admission function remains the legacy/scheduled path. Its
-- conflict target and active lookup now apply only to URL-less jobs.
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
  FROM public.ds_domains AS domains WHERE domains.hostname = p_hostname FOR SHARE;
  IF NOT FOUND OR domain_opted_out_at IS NOT NULL
    OR (p_trigger = 'scheduled' AND domain_enrollment <> 'monitored'
      AND NOT EXISTS (
        SELECT 1 FROM public.ds_beta_certifications AS certifications
        WHERE certifications.hostname = p_hostname
          AND certifications.policy_version = 'beta-0.1'
          AND certifications.state = 'active'
      )) THEN
    RETURN QUERY SELECT 'unavailable'::text, NULL::uuid;
    RETURN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.ds_profile_controls AS profiles
    WHERE profiles.profile_version = p_profile_version) THEN
    RAISE EXCEPTION 'invalid_scan_admission_profile';
  END IF;
  IF p_trigger = 'scheduled' THEN
    SELECT reports.id INTO existing_report FROM public.ds_scan_runs AS reports
    WHERE reports.hostname = p_hostname AND reports.profile_version = p_profile_version
      AND reports.completed_at <= now_at AND reports.completed_at > now_at - interval '40 minutes'
    ORDER BY reports.completed_at DESC LIMIT 1;
    IF existing_report IS NOT NULL THEN
      RETURN QUERY SELECT 'cached'::text, existing_report; RETURN;
    END IF;
  END IF;
  SELECT jobs.* INTO existing_job FROM public.ds_scan_jobs AS jobs
  WHERE jobs.hostname = p_hostname AND jobs.profile_version = p_profile_version
    AND jobs.target_url IS NULL AND jobs.state IN ('queued', 'running') LIMIT 1;
  IF FOUND THEN RETURN QUERY SELECT existing_job.state, existing_job.id; RETURN; END IF;
  SELECT count(*)::integer INTO queued_jobs FROM public.ds_scan_jobs AS jobs WHERE jobs.state = 'queued';
  IF queued_jobs >= 10 THEN RETURN QUERY SELECT 'capacity_reached'::text, NULL::uuid; RETURN; END IF;
  INSERT INTO public.ds_scan_jobs(hostname, profile_version, trigger, state, queued_at, available_at)
  VALUES (p_hostname, p_profile_version, p_trigger, 'queued', now_at, now_at)
  ON CONFLICT(hostname, profile_version)
    WHERE state IN ('queued', 'running') AND target_url IS NULL DO NOTHING
  RETURNING id INTO inserted_job;
  IF inserted_job IS NULL THEN
    SELECT jobs.* INTO existing_job FROM public.ds_scan_jobs AS jobs
    WHERE jobs.hostname = p_hostname AND jobs.profile_version = p_profile_version
      AND jobs.target_url IS NULL AND jobs.state IN ('queued', 'running') LIMIT 1;
    IF NOT FOUND THEN RAISE EXCEPTION 'active_scan_job_missing_after_conflict'; END IF;
    RETURN QUERY SELECT existing_job.state, existing_job.id; RETURN;
  END IF;
  RETURN QUERY SELECT 'queued'::text, inserted_job;
END;
$$;

REVOKE ALL ON FUNCTION public.ds_ensure_fresh_scan(text, text, text) FROM PUBLIC;

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
  target_path := regexp_replace(p_target_url, '^https://[^/?#]+', '');
  IF target_path = '' THEN target_path := '/';
  ELSIF left(target_path, 1) = '?' THEN target_path := '/' || target_path;
  END IF;

  SELECT reports.id INTO existing_report FROM public.ds_scan_runs AS reports
  WHERE reports.hostname = p_hostname AND reports.profile_version = 'domain-v5'
    AND reports.scope_json @> jsonb_build_array(target_path)
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
  SELECT jobs.queued_at INTO prior_admission FROM public.ds_scan_jobs AS jobs
  WHERE jobs.hostname = p_hostname AND jobs.state = 'completed'
    AND jobs.queued_at > now_at - interval '24 hours'
  ORDER BY jobs.queued_at DESC LIMIT 1;
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

CREATE OR REPLACE FUNCTION public.ds_request_on_demand_target_scan(
  p_hostname text,
  p_target_url text
)
RETURNS TABLE (outcome text, entity_id uuid)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  opted_out_at timestamptz;
  stored_domains integer;
BEGIN
  IF p_hostname IS NULL OR octet_length(p_hostname) > 253 OR p_hostname <> lower(p_hostname)
    OR p_hostname ~ '[^a-z0-9.-]' OR p_hostname !~ '\.'
    OR p_hostname ~ '(^\.|\.$|\.\.|^[0-9]+(\.[0-9]+){3}$)'
    OR EXISTS (
      SELECT 1 FROM unnest(string_to_array(p_hostname, '.')) AS labels(label)
      WHERE length(label) > 63 OR label !~ '^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$'
    ) OR NOT public.ds_valid_scan_target_url(p_hostname, p_target_url) THEN
    RAISE EXCEPTION 'invalid_scan_target_url';
  END IF;
  PERFORM pg_advisory_xact_lock(728194034);
  SELECT domains.opted_out_at INTO opted_out_at FROM public.ds_domains AS domains
  WHERE domains.hostname = p_hostname FOR SHARE;
  IF NOT FOUND THEN
    SELECT count(*)::integer INTO stored_domains FROM public.ds_domains AS domains
    WHERE domains.enrollment = 'on_demand';
    IF stored_domains >= 1000 THEN
      RETURN QUERY SELECT 'capacity_reached'::text, NULL::uuid; RETURN;
    END IF;
    INSERT INTO public.ds_domains(hostname, enrollment, profile_version)
    VALUES (p_hostname, 'on_demand', 'domain-v5') ON CONFLICT(hostname) DO NOTHING;
  ELSIF opted_out_at IS NOT NULL THEN
    RETURN QUERY SELECT 'unavailable'::text, NULL::uuid; RETURN;
  END IF;
  RETURN QUERY SELECT * FROM public.ds_ensure_fresh_url_scan(p_hostname, p_target_url);
END;
$$;
REVOKE ALL ON FUNCTION public.ds_request_on_demand_target_scan(text, text) FROM PUBLIC;

-- The worker receives the URL only after claiming the job.
DROP FUNCTION public.ds_claim_next_scan(integer);
CREATE FUNCTION public.ds_claim_next_scan(p_lease_duration_ms integer)
RETURNS TABLE (
  id uuid, hostname text, profile_version text, trigger text, attempts integer,
  lease_token uuid, lease_until timestamptz, target_url text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF p_lease_duration_ms IS NULL OR p_lease_duration_ms < 1 OR p_lease_duration_ms > 300000 THEN
    RAISE EXCEPTION 'invalid_scan_lease_duration';
  END IF;
  PERFORM pg_advisory_xact_lock(728194033);
  IF EXISTS (SELECT 1 FROM public.ds_scan_jobs WHERE state = 'running') THEN RETURN; END IF;
  RETURN QUERY UPDATE public.ds_scan_jobs AS jobs
  SET state = 'running', lease_until = clock_timestamp() + p_lease_duration_ms * interval '1 millisecond',
      lease_token = gen_random_uuid(), attempts = jobs.attempts + 1
  WHERE jobs.id = (
    SELECT candidate.id FROM public.ds_scan_jobs AS candidate
    WHERE candidate.state = 'queued' AND candidate.available_at <= clock_timestamp()
    ORDER BY (candidate.trigger = 'requested') DESC, candidate.queued_at, candidate.id
    LIMIT 1 FOR UPDATE SKIP LOCKED
  )
  RETURNING jobs.id, jobs.hostname, jobs.profile_version, jobs.trigger,
    jobs.attempts, jobs.lease_token, jobs.lease_until, jobs.target_url;
END;
$$;
REVOKE ALL ON FUNCTION public.ds_claim_next_scan(integer) FROM PUBLIC;

-- Preserve the target on retry; remove it transactionally when work terminates.
DO $$
DECLARE
  function_definition text;
  updated_definition text;
BEGIN
  SELECT pg_get_functiondef('public.ds_complete_scan(uuid,uuid,timestamptz,text,timestamptz,text,jsonb,jsonb,jsonb)'::regprocedure)
  INTO function_definition;
  updated_definition := replace(function_definition,
    'public_error_code = NULL', 'public_error_code = NULL, target_url = NULL');
  updated_definition := replace(updated_definition,
    $old$length(item->>'targetPath') > 512$old$,
    $new$length(item->>'targetPath') > 2048$new$);
  IF updated_definition = function_definition
    OR position('target_url = NULL' IN updated_definition) = 0
    OR position($marker$length(item->>'targetPath') > 2048$marker$ IN updated_definition) = 0 THEN
    RAISE EXCEPTION 'target_url_complete_cleanup_extension_failed';
  END IF;
  EXECUTE updated_definition;

  SELECT pg_get_functiondef('public.ds_fail_scan(uuid,uuid,text,integer,jsonb)'::regprocedure)
  INTO function_definition;
  updated_definition := replace(function_definition,
    'failure_diagnostic = CASE WHEN next_state = ''failed'' THEN p_failure_diagnostic ELSE NULL END',
    'failure_diagnostic = CASE WHEN next_state = ''failed'' THEN p_failure_diagnostic ELSE NULL END,' || E'\n      target_url = CASE WHEN next_state = ''failed'' THEN NULL ELSE target_url END');
  IF updated_definition = function_definition THEN RAISE EXCEPTION 'target_url_failure_cleanup_extension_failed'; END IF;
  EXECUTE updated_definition;

  SELECT pg_get_functiondef('public.ds_recover_expired_scan_leases(integer)'::regprocedure)
  INTO function_definition;
  updated_definition := replace(function_definition,
    $old$THEN 'worker_lease_expired' ELSE NULL END$old$,
    $new$THEN 'worker_lease_expired' ELSE NULL END,
      target_url = CASE WHEN attempts >= p_max_attempts THEN NULL ELSE target_url END$new$);
  IF updated_definition = function_definition THEN RAISE EXCEPTION 'target_url_lease_cleanup_extension_failed'; END IF;
  EXECUTE updated_definition;
END;
$$;

