CREATE TABLE IF NOT EXISTS public.ds_profile_controls (
  profile_version text NOT NULL,
  control_id text NOT NULL,
  required boolean NOT NULL,
  PRIMARY KEY (profile_version, control_id)
);

CREATE OR REPLACE FUNCTION ds_reject_profile_control_mutation() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Development Security profile controls are immutable';
END;
$$;

DROP TRIGGER IF EXISTS ds_profile_controls_immutable ON public.ds_profile_controls;
CREATE TRIGGER ds_profile_controls_immutable
  BEFORE UPDATE OR DELETE ON public.ds_profile_controls
  FOR EACH ROW EXECUTE FUNCTION public.ds_reject_profile_control_mutation();

INSERT INTO public.ds_profile_controls(profile_version, control_id, required)
VALUES
  ('controls-v1', 'DS-DNS-01', true),
  ('controls-v1', 'DS-TLS-01', true),
  ('controls-v1', 'DS-TLS-02', true),
  ('controls-v1', 'DS-HTTP-01', true),
  ('controls-v1', 'DS-HDR-01', true),
  ('controls-v1', 'DS-PRIV-01', true),
  ('controls-v1', 'DS-PRIV-02', true),
  ('controls-v1', 'DS-PRIV-03', true),
  ('controls-v1', 'DS-QUAL-01', true)
ON CONFLICT(profile_version, control_id) DO NOTHING;

CREATE OR REPLACE FUNCTION ds_claim_next_scan(p_lease_duration_ms integer)
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

  RETURN QUERY
  UPDATE public.ds_scan_jobs AS jobs
  SET state = 'running', lease_until = clock_timestamp()
        + p_lease_duration_ms * interval '1 millisecond',
      lease_token = gen_random_uuid(), attempts = jobs.attempts + 1
  WHERE jobs.id = (
    SELECT candidate.id FROM public.ds_scan_jobs AS candidate
    WHERE candidate.state = 'queued' AND candidate.available_at <= clock_timestamp()
    ORDER BY candidate.queued_at, candidate.id
    LIMIT 1 FOR UPDATE SKIP LOCKED
  )
  RETURNING jobs.id, jobs.hostname, jobs.profile_version, jobs.trigger,
    jobs.attempts, jobs.lease_token, jobs.lease_until;
END;
$$;

CREATE OR REPLACE FUNCTION ds_renew_scan_lease(
  p_job_id uuid,
  p_lease_token uuid,
  p_lease_duration_ms integer
) RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  renewed_rows integer;
BEGIN
  IF p_lease_duration_ms IS NULL OR p_lease_duration_ms < 1
    OR p_lease_duration_ms > 300000 THEN
    RAISE EXCEPTION 'invalid_scan_lease_duration';
  END IF;

  UPDATE public.ds_scan_jobs
  SET lease_until = clock_timestamp() + p_lease_duration_ms * interval '1 millisecond'
  WHERE id = p_job_id AND state = 'running' AND lease_token = p_lease_token
    AND lease_until > clock_timestamp();
  GET DIAGNOSTICS renewed_rows = ROW_COUNT;
  RETURN renewed_rows = 1;
END;
$$;

CREATE OR REPLACE FUNCTION ds_recover_expired_scan_leases(p_max_attempts integer)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  recovered_rows integer;
BEGIN
  IF p_max_attempts IS NULL OR p_max_attempts < 1 THEN
    RAISE EXCEPTION 'invalid_scan_max_attempts';
  END IF;

  UPDATE public.ds_scan_jobs
  SET state = CASE WHEN attempts >= p_max_attempts THEN 'failed' ELSE 'queued' END,
      available_at = clock_timestamp(), lease_until = NULL, lease_token = NULL,
      finished_at = CASE WHEN attempts >= p_max_attempts THEN clock_timestamp() ELSE NULL END,
      public_error_code = CASE WHEN attempts >= p_max_attempts
        THEN 'worker_lease_expired' ELSE NULL END
  WHERE state = 'running' AND lease_until <= clock_timestamp();
  GET DIAGNOSTICS recovered_rows = ROW_COUNT;
  RETURN recovered_rows;
END;
$$;

CREATE OR REPLACE FUNCTION ds_complete_scan(
  p_job_id uuid,
  p_lease_token uuid,
  p_completed_at timestamptz,
  p_scanner_version text,
  p_started_at timestamptz,
  p_verdict text,
  p_scope_json jsonb,
  p_checks_json jsonb,
  p_metrics_json jsonb
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  current_job public.ds_scan_jobs%ROWTYPE;
  report_id uuid;
  expected_verdict text;
  required_count integer;
  check_count integer;
BEGIN
  SELECT * INTO current_job FROM public.ds_scan_jobs
  WHERE id = p_job_id AND state = 'running' AND lease_token = p_lease_token
    AND lease_until > clock_timestamp()
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'scan_lease_lost';
  END IF;

  IF p_started_at IS NULL OR p_completed_at IS NULL OR p_completed_at < p_started_at
    OR p_completed_at > clock_timestamp() + interval '1 minute'
    OR p_scanner_version IS NULL OR length(p_scanner_version) NOT BETWEEN 1 AND 100
    OR jsonb_typeof(p_scope_json) <> 'array' OR jsonb_array_length(p_scope_json) > 50
    OR jsonb_typeof(p_checks_json) <> 'array'
    OR jsonb_array_length(p_checks_json) NOT BETWEEN 1 AND 100
    OR jsonb_typeof(p_metrics_json) <> 'object'
    OR pg_column_size(p_scope_json) > 16384
    OR pg_column_size(p_checks_json) > 262144
    OR pg_column_size(p_metrics_json) > 4096
  THEN
    RAISE EXCEPTION 'invalid_scan_report';
  END IF;

  SELECT count(*)::integer,
         count(*) FILTER (WHERE (item->>'required')::boolean)::integer
  INTO check_count, required_count
  FROM jsonb_array_elements(p_checks_json) AS checks(item);
  IF check_count <> jsonb_array_length(p_checks_json) OR required_count = 0 THEN
    RAISE EXCEPTION 'invalid_scan_checks';
  END IF;

  IF EXISTS (
    SELECT 1 FROM jsonb_array_elements(p_checks_json) AS checks(item)
    WHERE jsonb_typeof(item) <> 'object'
       OR item->>'status' NOT IN ('pass', 'fail', 'unknown', 'not_applicable')
       OR jsonb_typeof(item->'required') <> 'boolean'
       OR COALESCE(item->>'controlId', '') = ''
       OR COALESCE(item->>'severity', '') = ''
       OR COALESCE(item->>'targetPath', '') = ''
       OR COALESCE(item->>'method', '') = ''
       OR COALESCE(item->>'summary', '') = ''
       OR COALESCE(item->>'limitation', '') = ''
       OR length(item->>'controlId') > 100
       OR length(item->>'severity') > 32
       OR length(item->>'targetPath') > 512
       OR length(item->>'method') > 32
       OR length(item->>'summary') > 500
       OR length(item->>'limitation') > 500
       OR jsonb_typeof(COALESCE(item->'evidence', '{}'::jsonb)) <> 'object'
       OR pg_column_size(item->'evidence') > 8192
       OR item->'observedAt' IS NULL
  ) THEN
    RAISE EXCEPTION 'invalid_scan_checks';
  END IF;

  IF EXISTS (
    SELECT 1 FROM jsonb_array_elements(p_checks_json) AS checks(item)
    WHERE (item->>'required')::boolean AND item->>'status' = 'fail'
  ) THEN
    expected_verdict := 'fail';
  ELSIF EXISTS (
    SELECT 1 FROM jsonb_array_elements(p_checks_json) AS checks(item)
    WHERE (item->>'required')::boolean AND item->>'status' <> 'pass'
  ) THEN
    expected_verdict := 'inconclusive';
  ELSE
    expected_verdict := 'pass';
  END IF;
  IF p_verdict <> expected_verdict THEN
    RAISE EXCEPTION 'scan_verdict_does_not_match_checks';
  END IF;

  IF p_verdict = 'pass' THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.ds_profile_controls AS profile
      WHERE profile.profile_version = current_job.profile_version
    ) THEN
      RAISE EXCEPTION 'scan_profile_not_catalogued';
    END IF;
    IF EXISTS (
      SELECT 1 FROM jsonb_array_elements(p_checks_json) AS checks(item)
      WHERE (item->>'required')::boolean AND NOT EXISTS (
        SELECT 1 FROM public.ds_profile_controls AS profile
        WHERE profile.profile_version = current_job.profile_version
          AND profile.control_id = item->>'controlId'
          AND profile.required = (item->>'required')::boolean
      )
    ) OR EXISTS (
      SELECT 1 FROM public.ds_profile_controls AS profile
      WHERE profile.profile_version = current_job.profile_version
        AND profile.required
        AND NOT EXISTS (
          SELECT 1 FROM jsonb_array_elements(p_checks_json) AS checks(item)
          WHERE item->>'controlId' = profile.control_id
            AND (item->>'required')::boolean = profile.required
            AND item->>'status' = 'pass'
        )
    ) THEN
      RAISE EXCEPTION 'scan_profile_controls_incomplete';
    END IF;
  END IF;

  INSERT INTO public.ds_scan_runs(
    job_id, hostname, profile_version, scanner_version, vantage, trigger,
    started_at, completed_at, expires_at, verdict, scope_json
  ) VALUES (
    current_job.id, current_job.hostname, current_job.profile_version,
    p_scanner_version, 'same_vps', current_job.trigger, p_started_at,
    p_completed_at, p_completed_at + interval '60 minutes', p_verdict, p_scope_json
  ) RETURNING id INTO report_id;

  INSERT INTO public.ds_check_results(
    run_id, control_id, status, required, severity, observed_at, target_path,
    method, summary, limitation, evidence_json
  )
  SELECT report_id, item."controlId", item.status, item.required, item.severity,
    item."observedAt", item."targetPath", item.method, item.summary, item.limitation,
    COALESCE(item.evidence, '{}'::jsonb)
  FROM jsonb_to_recordset(p_checks_json) AS item(
    "controlId" text, status text, required boolean, severity text,
    "observedAt" timestamptz, "targetPath" text, method text, summary text,
    limitation text, evidence jsonb
  );

  INSERT INTO public.ds_scan_metrics(
    run_id, requests_count, bytes_count, duration_ms, pages_count
  ) SELECT report_id, item."requestsCount", item."bytesCount",
      item."durationMs", item."pagesCount"
    FROM jsonb_to_recordset(jsonb_build_array(p_metrics_json)) AS item(
      "requestsCount" integer, "bytesCount" bigint,
      "durationMs" integer, "pagesCount" integer
    );

  UPDATE public.ds_scan_jobs
  SET state = 'completed', finished_at = clock_timestamp(), lease_until = NULL,
      lease_token = NULL, public_error_code = NULL
  WHERE id = current_job.id AND state = 'running' AND lease_token = p_lease_token;
  RETURN report_id;
END;
$$;

REVOKE ALL ON FUNCTION ds_claim_next_scan(integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION ds_renew_scan_lease(uuid, uuid, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION ds_recover_expired_scan_leases(integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION ds_complete_scan(uuid, uuid, timestamptz, text, timestamptz, text, jsonb, jsonb, jsonb) FROM PUBLIC;
