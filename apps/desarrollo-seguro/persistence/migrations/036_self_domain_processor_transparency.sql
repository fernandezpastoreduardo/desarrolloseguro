CREATE OR REPLACE FUNCTION public.ds_complete_scan_with_processor_transparency(
  p_job_id uuid,
  p_lease_token uuid,
  p_completed_at timestamptz,
  p_scanner_version text,
  p_started_at timestamptz,
  p_verdict text,
  p_scope_json jsonb,
  p_checks_json jsonb,
  p_metrics_json jsonb,
  p_privacy_assessment_json jsonb,
  p_processor_transparency_json jsonb
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  report_id uuid;
  report_hostname text;
BEGIN
  IF p_processor_transparency_json IS NOT NULL AND (
    jsonb_typeof(p_processor_transparency_json) IS DISTINCT FROM 'object' OR
    p_processor_transparency_json->>'policyVersion' IS DISTINCT FROM 'processor-inventory-v1' OR
    NOT COALESCE(p_processor_transparency_json->>'status' IN ('pass', 'fail', 'unknown'), false) OR
    NOT COALESCE(jsonb_typeof(p_processor_transparency_json->'inventory') IN ('object', 'null'), false) OR
    pg_column_size(p_processor_transparency_json) > 65536
  ) THEN
    RAISE EXCEPTION 'invalid_processor_transparency_assessment';
  END IF;

  report_id := public.ds_complete_scan_with_privacy(
    p_job_id, p_lease_token, p_completed_at, p_scanner_version,
    p_started_at, p_verdict, p_scope_json, p_checks_json, p_metrics_json,
    p_privacy_assessment_json
  );
  SELECT hostname INTO report_hostname
  FROM public.ds_scan_runs
  WHERE id = report_id;

  IF (report_hostname IN ('grumphya.com', 'desarrolloseguro.org'))
      IS DISTINCT FROM (p_processor_transparency_json IS NOT NULL) THEN
    RAISE EXCEPTION 'invalid_processor_transparency_assessment';
  END IF;
  IF p_processor_transparency_json IS NOT NULL THEN
    INSERT INTO public.ds_scan_processor_transparency(run_id, assessment_json)
    VALUES (report_id, p_processor_transparency_json);
  END IF;
  RETURN report_id;
END;
$$;
