CREATE TABLE public.ds_scan_privacy_assessments (
  run_id uuid PRIMARY KEY REFERENCES public.ds_scan_runs(id) ON DELETE CASCADE,
  assessment_json jsonb NOT NULL CHECK (
    jsonb_typeof(assessment_json) = 'object' AND
    assessment_json->>'policyVersion' = 'privacy-v1' AND
    jsonb_typeof(assessment_json->'criteria') = 'array' AND
    jsonb_array_length(assessment_json->'criteria') = 5 AND
    pg_column_size(assessment_json) <= 32768
  ),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TRIGGER ds_scan_privacy_assessments_immutable
  BEFORE UPDATE OR DELETE ON public.ds_scan_privacy_assessments
  FOR EACH ROW EXECUTE FUNCTION public.ds_reject_report_mutation();

CREATE FUNCTION public.ds_complete_scan_with_privacy(
  p_job_id uuid,
  p_lease_token uuid,
  p_completed_at timestamptz,
  p_scanner_version text,
  p_started_at timestamptz,
  p_verdict text,
  p_scope_json jsonb,
  p_checks_json jsonb,
  p_metrics_json jsonb,
  p_privacy_assessment_json jsonb
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  report_id uuid;
BEGIN
  IF jsonb_typeof(p_privacy_assessment_json) IS DISTINCT FROM 'object' OR
     p_privacy_assessment_json->>'policyVersion' IS DISTINCT FROM 'privacy-v1' OR
     jsonb_typeof(p_privacy_assessment_json->'criteria') IS DISTINCT FROM 'array' OR
     jsonb_array_length(p_privacy_assessment_json->'criteria') <> 5 OR
     pg_column_size(p_privacy_assessment_json) > 32768 THEN
    RAISE EXCEPTION 'invalid_privacy_assessment';
  END IF;

  report_id := public.ds_complete_scan(
    p_job_id, p_lease_token, p_completed_at, p_scanner_version,
    p_started_at, p_verdict, p_scope_json, p_checks_json, p_metrics_json
  );

  INSERT INTO public.ds_scan_privacy_assessments(run_id, assessment_json)
  VALUES (report_id, p_privacy_assessment_json);

  RETURN report_id;
END;
$$;

REVOKE ALL ON public.ds_scan_privacy_assessments FROM PUBLIC;
REVOKE ALL ON FUNCTION public.ds_complete_scan_with_privacy(
  uuid, uuid, timestamptz, text, timestamptz, text, jsonb, jsonb, jsonb, jsonb
) FROM PUBLIC;
