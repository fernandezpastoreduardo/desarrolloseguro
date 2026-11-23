CREATE FUNCTION public.ds_public_policy_object_key_count(p_value jsonb)
RETURNS integer
LANGUAGE sql
IMMUTABLE
STRICT
PARALLEL SAFE
SET search_path = pg_catalog, public
AS $$
  SELECT count(*)::integer FROM jsonb_object_keys(p_value)
$$;

CREATE TABLE public.ds_scan_public_policy_transparency (
  run_id uuid PRIMARY KEY REFERENCES public.ds_scan_runs(id) ON DELETE CASCADE,
  assessment_json jsonb NOT NULL CHECK (
    CASE WHEN jsonb_typeof(assessment_json) = 'object' THEN
      public.ds_public_policy_object_key_count(assessment_json) = 4 AND
      assessment_json->>'policyVersion' = 'public-policy-v1' AND
      COALESCE(assessment_json->>'status' IN ('pass', 'fail', 'unknown'), false) AND
      COALESCE(assessment_json->>'reasonCode' IN (
        'disclosure_found', 'policy_link_missing', 'policy_content_missing',
        'policy_page_unavailable', 'service_purpose_missing', 'access_denied',
        'auditor_error', 'budget_exhausted'
      ), false) AND
      CASE WHEN jsonb_typeof(assessment_json->'evidence') = 'object' THEN
        public.ds_public_policy_object_key_count(assessment_json->'evidence') = 7
      ELSE false END AND
      pg_column_size(assessment_json) <= 16384
    ELSE false END
  ),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TRIGGER ds_scan_public_policy_transparency_immutable
  BEFORE UPDATE OR DELETE ON public.ds_scan_public_policy_transparency
  FOR EACH ROW EXECUTE FUNCTION public.ds_reject_report_mutation();

CREATE FUNCTION public.ds_complete_scan_with_transparency(
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
  p_internal_audit_summary_json jsonb,
  p_public_policy_json jsonb
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  report_id uuid;
BEGIN
  IF p_public_policy_json IS NOT NULL AND NOT COALESCE(
    CASE WHEN jsonb_typeof(p_public_policy_json) = 'object' THEN
      public.ds_public_policy_object_key_count(p_public_policy_json) = 4 AND
      p_public_policy_json->>'policyVersion' = 'public-policy-v1' AND
      CASE
        WHEN p_public_policy_json->>'status' = 'pass' THEN p_public_policy_json->>'reasonCode' = 'disclosure_found'
        WHEN p_public_policy_json->>'status' = 'fail' THEN p_public_policy_json->>'reasonCode' IN (
          'policy_link_missing', 'policy_content_missing', 'policy_page_unavailable',
          'service_purpose_missing', 'access_denied'
        )
        WHEN p_public_policy_json->>'status' = 'unknown' THEN p_public_policy_json->>'reasonCode' IN ('auditor_error', 'budget_exhausted')
        ELSE false
      END AND
      CASE WHEN jsonb_typeof(p_public_policy_json->'evidence') = 'object' THEN
        public.ds_public_policy_object_key_count(p_public_policy_json->'evidence') = 7 AND
        CASE
          WHEN jsonb_typeof(p_public_policy_json->'evidence'->'categories') = 'array' THEN
            jsonb_array_length(p_public_policy_json->'evidence'->'categories') <= 5 AND
            NOT EXISTS (
              SELECT 1
              FROM jsonb_array_elements_text(p_public_policy_json->'evidence'->'categories') AS category(value)
              WHERE category.value NOT IN ('analytics', 'advertising', 'social', 'consent', 'other')
            )
          ELSE false
        END AND
        CASE
          WHEN (p_public_policy_json->'evidence'->>'linksFound') ~ '^(0|[1-9][0-9]*)$'
            THEN (p_public_policy_json->'evidence'->>'linksFound')::numeric BETWEEN 0 AND 30
          ELSE false
        END AND
        CASE
          WHEN (p_public_policy_json->'evidence'->>'pagesInspected') ~ '^(0|[1-9][0-9]*)$'
            THEN (p_public_policy_json->'evidence'->>'pagesInspected')::numeric BETWEEN 0 AND 30
          ELSE false
        END AND
        CASE
          WHEN (p_public_policy_json->'evidence'->>'unavailablePages') ~ '^(0|[1-9][0-9]*)$'
            THEN (p_public_policy_json->'evidence'->>'unavailablePages')::numeric BETWEEN 0 AND 30
          ELSE false
        END AND
        CASE
          WHEN (p_public_policy_json->'evidence'->>'accessDeniedPages') ~ '^(0|[1-9][0-9]*)$'
            THEN (p_public_policy_json->'evidence'->>'accessDeniedPages')::numeric BETWEEN 0 AND 30
          ELSE false
        END AND
        CASE
          WHEN (p_public_policy_json->'evidence'->>'providerMentions') ~ '^(0|[1-9][0-9]*)$'
            THEN (p_public_policy_json->'evidence'->>'providerMentions')::numeric BETWEEN 0 AND 300
          ELSE false
        END AND
        CASE
          WHEN (p_public_policy_json->'evidence'->>'providersMissingPurpose') ~ '^(0|[1-9][0-9]*)$'
            THEN (p_public_policy_json->'evidence'->>'providersMissingPurpose')::numeric BETWEEN 0 AND 30
              AND (p_public_policy_json->'evidence'->>'providersMissingPurpose')::numeric <= (p_public_policy_json->'evidence'->>'providerMentions')::numeric
          ELSE false
        END AND
        CASE WHEN
          jsonb_typeof(p_public_policy_json->'evidence'->'linksFound') = 'number' AND
          (p_public_policy_json->'evidence'->>'linksFound') ~ '^(0|[1-9][0-9]*)$' AND
          jsonb_typeof(p_public_policy_json->'evidence'->'pagesInspected') = 'number' AND
          (p_public_policy_json->'evidence'->>'pagesInspected') ~ '^(0|[1-9][0-9]*)$' AND
          jsonb_typeof(p_public_policy_json->'evidence'->'unavailablePages') = 'number' AND
          (p_public_policy_json->'evidence'->>'unavailablePages') ~ '^(0|[1-9][0-9]*)$' AND
          jsonb_typeof(p_public_policy_json->'evidence'->'accessDeniedPages') = 'number' AND
          (p_public_policy_json->'evidence'->>'accessDeniedPages') ~ '^(0|[1-9][0-9]*)$' AND
          jsonb_typeof(p_public_policy_json->'evidence'->'providerMentions') = 'number' AND
          (p_public_policy_json->'evidence'->>'providerMentions') ~ '^(0|[1-9][0-9]*)$' AND
          jsonb_typeof(p_public_policy_json->'evidence'->'providersMissingPurpose') = 'number' AND
          (p_public_policy_json->'evidence'->>'providersMissingPurpose') ~ '^(0|[1-9][0-9]*)$'
        THEN CASE p_public_policy_json->>'reasonCode'
          WHEN 'auditor_error' THEN p_public_policy_json->>'status' = 'unknown'
            AND (p_public_policy_json->'evidence'->>'accessDeniedPages')::numeric = 0
            AND (p_public_policy_json->'evidence'->>'unavailablePages')::numeric = 0
          WHEN 'budget_exhausted' THEN p_public_policy_json->>'status' = 'unknown'
            AND (p_public_policy_json->'evidence'->>'accessDeniedPages')::numeric = 0
            AND (p_public_policy_json->'evidence'->>'unavailablePages')::numeric = 0
          WHEN 'access_denied' THEN p_public_policy_json->>'status' = 'fail'
            AND (p_public_policy_json->'evidence'->>'accessDeniedPages')::numeric > 0
          WHEN 'policy_page_unavailable' THEN p_public_policy_json->>'status' = 'fail'
            AND (p_public_policy_json->'evidence'->>'accessDeniedPages')::numeric = 0
            AND (p_public_policy_json->'evidence'->>'unavailablePages')::numeric > 0
          WHEN 'policy_link_missing' THEN p_public_policy_json->>'status' = 'fail'
            AND (p_public_policy_json->'evidence'->>'accessDeniedPages')::numeric = 0
            AND (p_public_policy_json->'evidence'->>'unavailablePages')::numeric = 0
            AND (p_public_policy_json->'evidence'->>'linksFound')::numeric = 0
          WHEN 'policy_content_missing' THEN p_public_policy_json->>'status' = 'fail'
            AND (p_public_policy_json->'evidence'->>'accessDeniedPages')::numeric = 0
            AND (p_public_policy_json->'evidence'->>'unavailablePages')::numeric = 0
            AND (p_public_policy_json->'evidence'->>'linksFound')::numeric > 0
            AND (p_public_policy_json->'evidence'->>'pagesInspected')::numeric = 0
          WHEN 'service_purpose_missing' THEN p_public_policy_json->>'status' = 'fail'
            AND (p_public_policy_json->'evidence'->>'accessDeniedPages')::numeric = 0
            AND (p_public_policy_json->'evidence'->>'unavailablePages')::numeric = 0
            AND (p_public_policy_json->'evidence'->>'linksFound')::numeric > 0
            AND (p_public_policy_json->'evidence'->>'pagesInspected')::numeric > 0
            AND ((p_public_policy_json->'evidence'->>'providerMentions')::numeric = 0
              OR (p_public_policy_json->'evidence'->>'providersMissingPurpose')::numeric > 0
              OR jsonb_array_length(p_public_policy_json->'evidence'->'categories') = 0)
          WHEN 'disclosure_found' THEN p_public_policy_json->>'status' = 'pass'
            AND (p_public_policy_json->'evidence'->>'accessDeniedPages')::numeric = 0
            AND (p_public_policy_json->'evidence'->>'unavailablePages')::numeric = 0
            AND (p_public_policy_json->'evidence'->>'linksFound')::numeric > 0
            AND (p_public_policy_json->'evidence'->>'pagesInspected')::numeric > 0
            AND (p_public_policy_json->'evidence'->>'providerMentions')::numeric > 0
            AND (p_public_policy_json->'evidence'->>'providersMissingPurpose')::numeric = 0
            AND jsonb_array_length(p_public_policy_json->'evidence'->'categories') > 0
          ELSE false
        END
        ELSE false
        END
      ELSE false END AND
      pg_column_size(p_public_policy_json) <= 16384
    ELSE false END,
    false
  ) THEN
    RAISE EXCEPTION 'invalid_public_policy_assessment';
  END IF;

  report_id := public.ds_complete_scan_with_internal_audit_public(
    p_job_id, p_lease_token, p_completed_at, p_scanner_version,
    p_started_at, p_verdict, p_scope_json, p_checks_json, p_metrics_json,
    p_privacy_assessment_json, p_processor_transparency_json,
    p_internal_audit_summary_json
  );
  IF p_public_policy_json IS NOT NULL THEN
    INSERT INTO public.ds_scan_public_policy_transparency(run_id, assessment_json)
    VALUES (report_id, p_public_policy_json);
  END IF;
  RETURN report_id;
END;
$$;

REVOKE ALL ON public.ds_scan_public_policy_transparency FROM PUBLIC;
REVOKE ALL ON FUNCTION public.ds_public_policy_object_key_count(jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.ds_complete_scan_with_transparency(
  uuid, uuid, timestamptz, text, timestamptz, text, jsonb, jsonb, jsonb,
  jsonb, jsonb, jsonb, jsonb
) FROM PUBLIC;
