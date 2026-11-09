CREATE OR REPLACE FUNCTION ds_reject_report_mutation() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' AND current_user = pg_get_userbyid(
    (SELECT relowner FROM pg_class WHERE oid = TG_RELID)
  ) THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'Development Security reports are immutable';
END;
$$;

REVOKE ALL ON FUNCTION ds_purge_expired_reports(timestamptz) FROM PUBLIC;
