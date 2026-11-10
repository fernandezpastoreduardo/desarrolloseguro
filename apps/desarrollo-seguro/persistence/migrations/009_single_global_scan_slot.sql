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
    ORDER BY candidate.queued_at, candidate.id
    LIMIT 1 FOR UPDATE SKIP LOCKED
  )
  RETURNING jobs.id, jobs.hostname, jobs.profile_version, jobs.trigger,
    jobs.attempts, jobs.lease_token, jobs.lease_until;
END;
$$;

REVOKE ALL ON FUNCTION ds_claim_next_scan(integer) FROM PUBLIC;
