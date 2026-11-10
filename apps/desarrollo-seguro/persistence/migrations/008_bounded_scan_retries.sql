CREATE OR REPLACE FUNCTION ds_fail_scan(
  p_job_id uuid,
  p_lease_token uuid,
  p_failure_code text,
  p_max_attempts integer
) RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  current_job public.ds_scan_jobs%ROWTYPE;
  next_state text;
BEGIN
  IF p_max_attempts IS NULL OR p_max_attempts < 1 OR p_max_attempts > 10 THEN
    RAISE EXCEPTION 'invalid_scan_max_attempts';
  END IF;
  IF p_failure_code IS NULL OR p_failure_code <> 'executor_failed' THEN
    RAISE EXCEPTION 'invalid_scan_failure_code';
  END IF;

  SELECT * INTO current_job FROM public.ds_scan_jobs
  WHERE id = p_job_id AND state = 'running' AND lease_token = p_lease_token
    AND lease_until > clock_timestamp()
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'scan_lease_lost';
  END IF;

  next_state := CASE WHEN current_job.attempts >= p_max_attempts
    THEN 'failed' ELSE 'retrying' END;
  UPDATE public.ds_scan_jobs
  SET state = CASE WHEN next_state = 'failed' THEN 'failed' ELSE 'queued' END,
      available_at = CASE WHEN next_state = 'failed' THEN available_at
        ELSE clock_timestamp() + LEAST(60, power(2, current_job.attempts - 1)) * interval '1 second' END,
      lease_until = NULL,
      lease_token = NULL,
      finished_at = CASE WHEN next_state = 'failed' THEN clock_timestamp() ELSE NULL END,
      public_error_code = CASE WHEN next_state = 'failed' THEN p_failure_code ELSE NULL END
  WHERE id = current_job.id;
  RETURN next_state;
END;
$$;

REVOKE ALL ON FUNCTION ds_fail_scan(uuid, uuid, text, integer) FROM PUBLIC;
