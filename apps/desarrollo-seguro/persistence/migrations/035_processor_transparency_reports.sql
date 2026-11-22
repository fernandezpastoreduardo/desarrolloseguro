CREATE TABLE public.ds_scan_processor_transparency (
  run_id uuid PRIMARY KEY REFERENCES public.ds_scan_runs(id) ON DELETE CASCADE,
  assessment_json jsonb NOT NULL CHECK (
    jsonb_typeof(assessment_json) = 'object' AND
    assessment_json->>'policyVersion' = 'processor-inventory-v1' AND
    COALESCE(assessment_json->>'status' IN ('pass', 'fail', 'unknown'), false) AND
    COALESCE(jsonb_typeof(assessment_json->'inventory') IN ('object', 'null'), false) AND
    pg_column_size(assessment_json) <= 65536
  ),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TRIGGER ds_scan_processor_transparency_immutable
  BEFORE UPDATE OR DELETE ON public.ds_scan_processor_transparency
  FOR EACH ROW EXECUTE FUNCTION public.ds_reject_report_mutation();

CREATE FUNCTION public.ds_complete_scan_with_processor_transparency(
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

  IF (report_hostname = 'grumphya.com') IS DISTINCT FROM (p_processor_transparency_json IS NOT NULL) THEN
    RAISE EXCEPTION 'invalid_processor_transparency_assessment';
  END IF;
  IF p_processor_transparency_json IS NOT NULL THEN
    INSERT INTO public.ds_scan_processor_transparency(run_id, assessment_json)
    VALUES (report_id, p_processor_transparency_json);
  END IF;
  RETURN report_id;
END;
$$;

REVOKE ALL ON public.ds_scan_processor_transparency FROM PUBLIC;
REVOKE ALL ON FUNCTION public.ds_complete_scan_with_processor_transparency(
  uuid, uuid, timestamptz, text, timestamptz, text, jsonb, jsonb, jsonb, jsonb, jsonb
) FROM PUBLIC;
