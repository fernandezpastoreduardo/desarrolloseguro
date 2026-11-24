CREATE FUNCTION public.ds_valid_public_service_comparison(p_value jsonb)
RETURNS boolean
LANGUAGE plpgsql
IMMUTABLE
STRICT
PARALLEL SAFE
SET search_path = pg_catalog, public
AS $$
DECLARE
  item jsonb;
  domain_value text;
  purpose_value text;
  observed_count integer;
  purpose_count integer;
  expected_observation text;
  has_undisclosed boolean := false;
  item_count integer := 0;
BEGIN
  IF jsonb_typeof(p_value) <> 'object' OR
     public.ds_public_policy_object_key_count(p_value) <> 4 OR
     NOT (p_value ?& ARRAY['policyVersion', 'status', 'reasonCode', 'items']) OR
     jsonb_typeof(p_value->'policyVersion') <> 'string' OR
     NOT COALESCE(p_value->>'policyVersion' = 'public-service-comparison-v1', false) OR
     jsonb_typeof(p_value->'items') <> 'array' OR
     jsonb_array_length(p_value->'items') > 30 THEN
    RETURN false;
  END IF;
  IF (SELECT count(DISTINCT value->>'providerId') FROM jsonb_array_elements(p_value->'items')) <>
      jsonb_array_length(p_value->'items') THEN RETURN false; END IF;
  IF NOT COALESCE(p_value->>'status' IN ('pass', 'fail', 'unknown'), false) OR
     NOT COALESCE(p_value->>'reasonCode' IN ('services_disclosed', 'observed_service_undisclosed', 'public_policy_missing', 'auditor_error'), false) THEN
    RETURN false;
  END IF;
  FOR item IN SELECT value FROM jsonb_array_elements(p_value->'items') LOOP
    item_count := item_count + 1;
    IF jsonb_typeof(item) <> 'object' OR public.ds_public_policy_object_key_count(item) <> 4 OR
       NOT (item ?& ARRAY['providerId', 'observation', 'observedDomains', 'declaredPurposes']) OR
       jsonb_typeof(item->'providerId') <> 'string' OR NOT COALESCE(item->>'providerId' ~ '^[a-z0-9][a-z0-9_-]{0,31}$', false) OR
       jsonb_typeof(item->'observation') <> 'string' OR NOT COALESCE(item->>'observation' IN ('observed', 'declared', 'observed_and_declared'), false) OR
       jsonb_typeof(item->'observedDomains') <> 'array' OR jsonb_array_length(item->'observedDomains') > 8 OR
       jsonb_typeof(item->'declaredPurposes') <> 'array' OR jsonb_array_length(item->'declaredPurposes') > 8 THEN
      RETURN false;
    END IF;
    IF (SELECT count(DISTINCT value) FROM jsonb_array_elements_text(item->'observedDomains')) <> jsonb_array_length(item->'observedDomains') OR
       (SELECT count(DISTINCT value) FROM jsonb_array_elements_text(item->'declaredPurposes')) <> jsonb_array_length(item->'declaredPurposes') THEN
      RETURN false;
    END IF;
    observed_count := jsonb_array_length(item->'observedDomains');
    purpose_count := jsonb_array_length(item->'declaredPurposes');
    FOR domain_value IN SELECT value FROM jsonb_array_elements_text(item->'observedDomains') LOOP
      IF domain_value IS NULL OR length(domain_value) > 253 OR NOT COALESCE(domain_value ~ '^([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)(\.([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?))*$', false) THEN RETURN false; END IF;
    END LOOP;
    FOR purpose_value IN SELECT value FROM jsonb_array_elements_text(item->'declaredPurposes') LOOP
      IF purpose_value IS NULL OR NOT COALESCE(purpose_value ~ '^[a-z0-9][a-z0-9_-]{0,31}$', false) THEN RETURN false; END IF;
    END LOOP;
    expected_observation := CASE WHEN observed_count > 0 AND purpose_count > 0 THEN 'observed_and_declared'
      WHEN observed_count > 0 THEN 'observed' ELSE 'declared' END;
    IF item->>'observation' <> expected_observation THEN RETURN false; END IF;
    IF expected_observation = 'observed' THEN has_undisclosed := true; END IF;
  END LOOP;
  IF p_value->>'reasonCode' = 'auditor_error' THEN
    RETURN p_value->>'status' = 'unknown' AND item_count = 0;
  ELSIF p_value->>'reasonCode' = 'observed_service_undisclosed' THEN
    RETURN p_value->>'status' = 'fail' AND has_undisclosed;
  ELSIF p_value->>'reasonCode' = 'public_policy_missing' THEN
    RETURN p_value->>'status' = 'fail' AND NOT has_undisclosed;
  ELSE
    RETURN p_value->>'status' = 'pass' AND NOT has_undisclosed;
  END IF;
END;
$$;

CREATE TABLE public.ds_scan_public_service_comparisons (
  run_id uuid PRIMARY KEY REFERENCES public.ds_scan_runs(id) ON DELETE CASCADE,
  comparison_json jsonb NOT NULL CHECK (
    public.ds_valid_public_service_comparison(comparison_json) AND pg_column_size(comparison_json) <= 16384
  ),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TRIGGER ds_scan_public_service_comparisons_immutable
  BEFORE UPDATE OR DELETE ON public.ds_scan_public_service_comparisons
  FOR EACH ROW EXECUTE FUNCTION public.ds_reject_report_mutation();

CREATE FUNCTION public.ds_complete_scan_with_service_comparison(
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
  p_public_policy_json jsonb,
  p_public_service_comparison_json jsonb
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  report_id uuid;
BEGIN
  IF p_public_service_comparison_json IS NOT NULL AND NOT COALESCE(
    public.ds_valid_public_service_comparison(p_public_service_comparison_json) AND
    pg_column_size(p_public_service_comparison_json) <= 16384,
    false
  ) THEN
    RAISE EXCEPTION 'invalid_public_service_comparison';
  END IF;
  report_id := public.ds_complete_scan_with_transparency(
    p_job_id, p_lease_token, p_completed_at, p_scanner_version,
    p_started_at, p_verdict, p_scope_json, p_checks_json, p_metrics_json,
    p_privacy_assessment_json, p_processor_transparency_json,
    p_internal_audit_summary_json, p_public_policy_json
  );
  IF p_public_service_comparison_json IS NOT NULL THEN
    INSERT INTO public.ds_scan_public_service_comparisons(run_id, comparison_json)
    VALUES (report_id, p_public_service_comparison_json);
  END IF;
  RETURN report_id;
END;
$$;

REVOKE ALL ON public.ds_scan_public_service_comparisons FROM PUBLIC;
REVOKE ALL ON FUNCTION public.ds_valid_public_service_comparison(jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.ds_complete_scan_with_service_comparison(
  uuid, uuid, timestamptz, text, timestamptz, text, jsonb, jsonb, jsonb,
  jsonb, jsonb, jsonb, jsonb, jsonb
) FROM PUBLIC;
