-- Ignore a report that was completed before the certification snapshot already
-- stored. A late worker result must not roll back a newer certification state.
CREATE OR REPLACE FUNCTION public.ds_sync_beta_certification_after_check()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  report_completed_at timestamptz;
  certification_last_checked_at timestamptz;
BEGIN
  SELECT reports.completed_at
  INTO report_completed_at
  FROM public.ds_scan_runs AS reports
  WHERE reports.id = NEW.run_id;

  SELECT certifications.last_checked_at
  INTO certification_last_checked_at
  FROM public.ds_beta_certifications AS certifications
  INNER JOIN public.ds_scan_runs AS reports
    ON reports.hostname = certifications.hostname
  WHERE reports.id = NEW.run_id
    AND certifications.policy_version = 'beta-0.1'
  FOR UPDATE OF certifications;

  IF certification_last_checked_at IS NOT NULL
    AND report_completed_at <= certification_last_checked_at THEN
    RETURN NULL;
  END IF;

  PERFORM public.ds_sync_beta_certification(NEW.run_id);
  RETURN NULL;
END;
$$;

REVOKE ALL ON FUNCTION public.ds_sync_beta_certification_after_check() FROM PUBLIC;
