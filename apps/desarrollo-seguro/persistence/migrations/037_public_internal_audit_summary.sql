CREATE TABLE public.ds_scan_internal_audit_public_summaries (
  run_id uuid PRIMARY KEY REFERENCES public.ds_scan_runs(id) ON DELETE CASCADE,
  summary_json jsonb NOT NULL CHECK (
    jsonb_typeof(summary_json) = 'object' AND
    summary_json->>'policyVersion' = 'internal-audit-public-v1' AND
    COALESCE(summary_json->>'status' IN ('complete', 'review'), false) AND
    jsonb_typeof(summary_json->'criteria') = 'array' AND
    jsonb_array_length(summary_json->'criteria') = 14 AND
    pg_column_size(summary_json) <= 8192
  ),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TRIGGER ds_scan_internal_audit_public_summaries_immutable
  BEFORE UPDATE OR DELETE ON public.ds_scan_internal_audit_public_summaries
  FOR EACH ROW EXECUTE FUNCTION public.ds_reject_report_mutation();

CREATE FUNCTION public.ds_complete_scan_with_internal_audit_public(
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
  p_processor_transparency_json jsonb,
  p_internal_audit_summary_json jsonb
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  report_id uuid;
  report_hostname text;
BEGIN
  IF p_internal_audit_summary_json IS NOT NULL AND (
    jsonb_typeof(p_internal_audit_summary_json) IS DISTINCT FROM 'object' OR
    p_internal_audit_summary_json->>'policyVersion' IS DISTINCT FROM 'internal-audit-public-v1' OR
    NOT COALESCE(p_internal_audit_summary_json->>'status' IN ('complete', 'review'), false) OR
    jsonb_typeof(p_internal_audit_summary_json->'criteria') IS DISTINCT FROM 'array' OR
    jsonb_array_length(p_internal_audit_summary_json->'criteria') <> 14 OR
    pg_column_size(p_internal_audit_summary_json) > 8192 OR
    p_internal_audit_summary_json - 'policyVersion' - 'status' - 'observedAt' - 'criteria' <> '{}'::jsonb OR
    EXISTS (
      SELECT 1 FROM jsonb_array_elements(p_internal_audit_summary_json->'criteria') AS item
      WHERE jsonb_typeof(item) <> 'object'
        OR item - 'id' - 'status' <> '{}'::jsonb
        OR item->>'id' NOT IN (
          'infrastructure.tls', 'infrastructure.headers', 'infrastructure.network',
          'application.dependencies', 'application.secrets', 'authentication.authorization',
          'quality.e2e', 'quality.accessibility', 'performance.page_load',
          'privacy.cookies', 'privacy.third_parties', 'privacy.consent',
          'ethics.transparency', 'ai.disclosure'
        )
        OR item->>'status' NOT IN ('pass', 'fail', 'unknown', 'not_applicable')
    ) OR (
      SELECT count(DISTINCT item->>'id') FROM jsonb_array_elements(p_internal_audit_summary_json->'criteria') AS item
    ) <> 14 OR
    p_internal_audit_summary_json->>'status' = 'review' AND EXISTS (
      SELECT 1 FROM jsonb_array_elements(p_internal_audit_summary_json->'criteria') AS item
      WHERE item->>'status' <> 'unknown'
    ) OR
    p_internal_audit_summary_json->>'status' = 'complete' AND EXISTS (
      SELECT 1 FROM jsonb_array_elements(p_internal_audit_summary_json->'criteria') AS item
      WHERE item->>'status' = 'unknown'
    )
  ) THEN
    RAISE EXCEPTION 'invalid_internal_audit_public_summary';
  END IF;

  report_id := public.ds_complete_scan_with_processor_transparency(
    p_job_id, p_lease_token, p_completed_at, p_scanner_version,
    p_started_at, p_verdict, p_scope_json, p_checks_json, p_metrics_json,
    p_privacy_assessment_json, p_processor_transparency_json
  );
  SELECT hostname INTO report_hostname
  FROM public.ds_scan_runs
  WHERE id = report_id;

  IF (report_hostname = 'grumphya.com') IS DISTINCT FROM (p_internal_audit_summary_json IS NOT NULL) THEN
    RAISE EXCEPTION 'invalid_internal_audit_public_summary';
  END IF;
  IF p_internal_audit_summary_json IS NOT NULL THEN
    INSERT INTO public.ds_scan_internal_audit_public_summaries(run_id, summary_json)
    VALUES (report_id, p_internal_audit_summary_json);
  END IF;
  RETURN report_id;
END;
$$;

REVOKE ALL ON public.ds_scan_internal_audit_public_summaries FROM PUBLIC;
REVOKE ALL ON FUNCTION public.ds_complete_scan_with_internal_audit_public(
  uuid, uuid, timestamptz, text, timestamptz, text, jsonb, jsonb, jsonb, jsonb, jsonb, jsonb
) FROM PUBLIC;
