ALTER TABLE public.ds_scan_jobs
  ADD COLUMN IF NOT EXISTS progress_json jsonb;

CREATE OR REPLACE FUNCTION public.ds_clear_inactive_scan_progress()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF NEW.state <> 'running' THEN
    NEW.progress_json := NULL;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS ds_scan_jobs_clear_inactive_progress ON public.ds_scan_jobs;
CREATE TRIGGER ds_scan_jobs_clear_inactive_progress
  BEFORE INSERT OR UPDATE OF state ON public.ds_scan_jobs
  FOR EACH ROW EXECUTE FUNCTION public.ds_clear_inactive_scan_progress();

REVOKE ALL ON FUNCTION public.ds_clear_inactive_scan_progress() FROM PUBLIC;

CREATE OR REPLACE FUNCTION public.ds_update_scan_progress(
  p_job_id uuid,
  p_lease_token uuid,
  p_progress jsonb
) RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  updated_rows integer;
  current_progress jsonb;
BEGIN
  IF p_progress IS NULL OR jsonb_typeof(p_progress) IS DISTINCT FROM 'object' THEN
    RAISE EXCEPTION 'invalid_scan_progress';
  END IF;
  IF (SELECT count(*) FROM jsonb_object_keys(p_progress)) <> 2
    OR p_progress->>'policyVersion' IS DISTINCT FROM 'public-audit-progress-v1'
    OR jsonb_typeof(p_progress->'aspects') IS DISTINCT FROM 'object'
  THEN
    RAISE EXCEPTION 'invalid_scan_progress';
  END IF;
  IF (SELECT count(*) FROM jsonb_object_keys(p_progress->'aspects')) <> 4
    OR NOT (p_progress->'aspects' ?& ARRAY['ethics', 'privacy', 'security', 'performance'])
    OR EXISTS (
      SELECT 1 FROM jsonb_each_text(p_progress->'aspects') AS aspect(name, state)
      WHERE aspect.state IS NULL OR aspect.state NOT IN ('pending', 'running', 'complete')
    )
    OR pg_column_size(p_progress) > 512
  THEN
    RAISE EXCEPTION 'invalid_scan_progress';
  END IF;

  SELECT progress_json INTO current_progress
  FROM public.ds_scan_jobs
  WHERE id = p_job_id AND state = 'running' AND lease_token = p_lease_token
    AND lease_until > clock_timestamp()
  FOR UPDATE;
  IF NOT FOUND THEN
    RETURN false;
  END IF;
  IF current_progress IS NOT NULL AND EXISTS (
    SELECT 1 FROM unnest(ARRAY['ethics', 'privacy', 'security', 'performance']) AS aspect(name)
    WHERE (current_progress->'aspects'->>aspect.name = 'complete'
        AND p_progress->'aspects'->>aspect.name <> 'complete')
       OR (current_progress->'aspects'->>aspect.name = 'running'
        AND p_progress->'aspects'->>aspect.name = 'pending')
  ) THEN
    RAISE EXCEPTION 'invalid_scan_progress_transition';
  END IF;

  UPDATE public.ds_scan_jobs
  SET progress_json = p_progress
  WHERE id = p_job_id AND state = 'running' AND lease_token = p_lease_token
    AND lease_until > clock_timestamp();
  GET DIAGNOSTICS updated_rows = ROW_COUNT;
  RETURN updated_rows = 1;
END;
$$;

REVOKE ALL ON FUNCTION public.ds_update_scan_progress(uuid, uuid, jsonb) FROM PUBLIC;
