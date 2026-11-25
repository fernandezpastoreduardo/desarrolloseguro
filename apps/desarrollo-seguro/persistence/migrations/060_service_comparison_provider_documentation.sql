CREATE OR REPLACE FUNCTION public.ds_valid_public_service_comparison(p_value jsonb)
RETURNS boolean
LANGUAGE plpgsql
IMMUTABLE
STRICT
PARALLEL SAFE
SET search_path = pg_catalog, public
AS $$
DECLARE
  item jsonb;
  provider_document jsonb;
  comparison jsonb;
  source_item jsonb;
  source_receipt jsonb;
  domain_value text;
  purpose_value text;
  observed_count integer;
  purpose_count integer;
  expected_observation text;
  has_undisclosed boolean := false;
  has_confirmed_contradiction boolean := false;
  item_count integer := 0;
  provider_document_count integer := 0;
BEGIN
  IF jsonb_typeof(p_value) <> 'object' OR
     pg_column_size(p_value) > 65536 OR
     public.ds_public_policy_object_key_count(p_value) NOT IN (4, 5) OR
     NOT (p_value ?& ARRAY['policyVersion', 'status', 'reasonCode', 'items']) OR
     p_value - 'policyVersion' - 'status' - 'reasonCode' - 'items' - 'providerDocumentation' <> '{}'::jsonb OR
     jsonb_typeof(p_value->'policyVersion') <> 'string' OR
     NOT COALESCE(p_value->>'policyVersion' = 'public-service-comparison-v1', false) OR
     jsonb_typeof(p_value->'items') <> 'array' OR
     jsonb_array_length(p_value->'items') > 30 THEN
    RETURN false;
  END IF;
  IF (SELECT count(DISTINCT value->>'providerId') FROM jsonb_array_elements(p_value->'items')) <>
      jsonb_array_length(p_value->'items') THEN RETURN false; END IF;
  IF NOT COALESCE(p_value->>'status' IN ('pass', 'fail', 'unknown'), false) OR
     NOT COALESCE(p_value->>'reasonCode' IN (
       'services_disclosed', 'observed_service_undisclosed',
       'provider_documentation_contradiction', 'public_policy_missing', 'auditor_error'
     ), false) THEN
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

  IF p_value ? 'providerDocumentation' THEN
    IF jsonb_typeof(p_value->'providerDocumentation') <> 'array' OR
       jsonb_array_length(p_value->'providerDocumentation') > 30 THEN RETURN false; END IF;
    FOR provider_document IN SELECT value FROM jsonb_array_elements(p_value->'providerDocumentation') LOOP
      provider_document_count := provider_document_count + 1;
      IF jsonb_typeof(provider_document) <> 'object' OR
         public.ds_public_policy_object_key_count(provider_document) NOT IN (4, 5) OR
         NOT (provider_document ?& ARRAY['providerId', 'status', 'reasonCode', 'comparisons']) OR
         jsonb_typeof(provider_document->'providerId') <> 'string' OR
         NOT COALESCE(provider_document->>'providerId' ~ '^[a-z0-9][a-z0-9_-]{0,31}$', false) OR
         jsonb_typeof(provider_document->'status') <> 'string' OR
         provider_document->>'status' NOT IN ('contradiction_confirmed', 'consistent', 'not_comparable', 'source_not_located', 'source_unavailable') OR
         jsonb_typeof(provider_document->'reasonCode') <> 'string' OR
         provider_document->>'reasonCode' NOT IN ('opposing_explicit_statements', 'matching_explicit_statements', 'site_statement_missing', 'provider_fact_missing', 'official_source_not_located', 'official_source_unavailable') OR
         jsonb_typeof(provider_document->'comparisons') <> 'array' OR
         jsonb_array_length(provider_document->'comparisons') > 100 THEN RETURN false; END IF;

      IF provider_document ? 'sourceEvidence' THEN
        IF jsonb_typeof(provider_document->'sourceEvidence') <> 'array' OR
           jsonb_array_length(provider_document->'sourceEvidence') > 50 THEN RETURN false; END IF;
        FOR source_receipt IN SELECT value FROM jsonb_array_elements(provider_document->'sourceEvidence') LOOP
          IF jsonb_typeof(source_receipt) <> 'object' OR public.ds_public_policy_object_key_count(source_receipt) <> 6 OR
             NOT (source_receipt ?& ARRAY['documentId', 'title', 'url', 'status', 'sha256', 'checkedAt']) OR
             jsonb_typeof(source_receipt->'documentId') <> 'string' OR jsonb_typeof(source_receipt->'title') <> 'string' OR
             jsonb_typeof(source_receipt->'url') <> 'string' OR jsonb_typeof(source_receipt->'status') <> 'string' OR
             jsonb_typeof(source_receipt->'checkedAt') <> 'string' OR
             NOT COALESCE(source_receipt->>'documentId' ~ '^[a-z0-9][a-z0-9_-]{0,95}$', false) OR
             NOT COALESCE(length(source_receipt->>'title') BETWEEN 1 AND 240, false) OR
             NOT COALESCE(source_receipt->>'url' ~ '^https://[^/@:?#]+(:443)?(/|$)', false) OR
             source_receipt->>'status' NOT IN ('seeded', 'fetched', 'unavailable', 'failed', 'not_localized') OR
             NOT (source_receipt->'sha256' = 'null'::jsonb OR COALESCE(source_receipt->>'sha256' ~ '^[a-f0-9]{64}$', false)) OR
             NOT COALESCE(source_receipt->>'checkedAt' ~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?Z$', false) THEN RETURN false; END IF;
        END LOOP;
      END IF;

      IF provider_document->>'status' = 'contradiction_confirmed' THEN
        IF provider_document->>'reasonCode' <> 'opposing_explicit_statements' THEN RETURN false; END IF;
        FOR comparison IN SELECT value FROM jsonb_array_elements(provider_document->'comparisons') LOOP
          IF jsonb_typeof(comparison) <> 'object' OR
             public.ds_public_policy_object_key_count(comparison) NOT BETWEEN 6 AND 8 OR
             NOT (comparison ?& ARRAY['factId', 'siteStatement', 'siteValue', 'providerFact', 'providerValue', 'relation']) OR
             NOT COALESCE(comparison->>'factId' ~ '^[a-z][a-z0-9_]{0,47}$', false) OR
             jsonb_typeof(comparison->'siteValue') <> 'boolean' OR jsonb_typeof(comparison->'providerValue') <> 'boolean' OR
             jsonb_typeof(comparison->'relation') <> 'string' OR
             comparison->>'relation' NOT IN ('opposes', 'supports') OR
             (comparison->>'relation' = 'supports') <> (comparison->'siteValue' = comparison->'providerValue') OR
             jsonb_typeof(comparison->'siteStatement') <> 'object' OR jsonb_typeof(comparison->'providerFact') <> 'object' THEN RETURN false; END IF;
          IF comparison->>'relation' = 'opposes' THEN
            IF comparison->'siteStatement'->>'sourceKind' <> 'audited_site' OR
               comparison->'providerFact'->>'sourceKind' <> 'provider_official' OR
               comparison->'siteStatement'->>'sourceId' = comparison->'providerFact'->>'sourceId' OR
               comparison->'siteStatement'->>'url' = comparison->'providerFact'->>'url' THEN RETURN false; END IF;
            has_confirmed_contradiction := true;
          END IF;
          IF comparison ? 'legalMappingStatus' AND comparison->>'legalMappingStatus' NOT IN ('not_available', 'elements_not_satisfied') THEN RETURN false; END IF;
          IF comparison ? 'legalFinding' AND (jsonb_typeof(comparison->'legalFinding') <> 'object' OR pg_column_size(comparison->'legalFinding') > 8192 OR comparison->'legalFinding'->>'status' <> 'infraccion_legal_acreditada') THEN RETURN false; END IF;
          FOREACH source_item IN ARRAY ARRAY[comparison->'siteStatement', comparison->'providerFact'] LOOP
            IF public.ds_public_policy_object_key_count(source_item) <> 8 OR
               NOT (source_item ?& ARRAY['sourceId', 'version', 'title', 'url', 'capturedAt', 'excerpt', 'documentKind', 'sourceKind']) OR
               jsonb_typeof(source_item->'sourceId') <> 'string' OR jsonb_typeof(source_item->'version') <> 'string' OR
               jsonb_typeof(source_item->'title') <> 'string' OR jsonb_typeof(source_item->'url') <> 'string' OR
               jsonb_typeof(source_item->'capturedAt') <> 'string' OR jsonb_typeof(source_item->'excerpt') <> 'string' OR
               jsonb_typeof(source_item->'documentKind') <> 'string' OR jsonb_typeof(source_item->'sourceKind') <> 'string' OR
               NOT COALESCE(length(source_item->>'sourceId') BETWEEN 1 AND 96, false) OR NOT COALESCE(length(source_item->>'version') BETWEEN 1 AND 64, false) OR
               NOT COALESCE(length(source_item->>'title') BETWEEN 1 AND 200, false) OR NOT COALESCE(length(source_item->>'excerpt') BETWEEN 1 AND 500, false) OR
               NOT COALESCE(source_item->>'url' ~ '^https://[^/@:?#]+(:443)?(/|$)', false) OR
               source_item->>'documentKind' NOT IN ('privacy', 'cookies', 'terms', 'legal', 'service', 'technical-evidence', 'legal-authority') OR
               source_item->>'sourceKind' NOT IN ('audited_site', 'provider_official', 'auditor_observation', 'legal_authority') OR
               NOT COALESCE(source_item->>'capturedAt' ~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?Z$', false) THEN RETURN false; END IF;
          END LOOP;
        END LOOP;
        IF NOT has_confirmed_contradiction THEN RETURN false; END IF;
        has_confirmed_contradiction := false;
      END IF;
    END LOOP;
  END IF;

  IF p_value->>'reasonCode' = 'auditor_error' THEN
    RETURN p_value->>'status' = 'unknown' AND item_count = 0 AND provider_document_count = 0;
  ELSIF p_value->>'reasonCode' = 'observed_service_undisclosed' THEN
    RETURN p_value->>'status' = 'fail' AND has_undisclosed;
  ELSIF p_value->>'reasonCode' = 'provider_documentation_contradiction' THEN
    IF p_value->>'status' <> 'fail' OR p_value->>'status' = 'unknown' THEN RETURN false; END IF;
    FOR provider_document IN SELECT value FROM jsonb_array_elements(COALESCE(p_value->'providerDocumentation', '[]'::jsonb)) LOOP
      IF provider_document->>'status' = 'contradiction_confirmed' THEN RETURN true; END IF;
    END LOOP;
    RETURN false;
  ELSIF p_value->>'reasonCode' = 'public_policy_missing' THEN
    RETURN p_value->>'status' = 'fail' AND NOT has_undisclosed;
  ELSE
    IF p_value->>'status' <> 'pass' OR has_undisclosed THEN RETURN false; END IF;
    FOR provider_document IN SELECT value FROM jsonb_array_elements(COALESCE(p_value->'providerDocumentation', '[]'::jsonb)) LOOP
      IF provider_document->>'status' = 'contradiction_confirmed' THEN RETURN false; END IF;
    END LOOP;
    RETURN true;
  END IF;
END;
$$;

ALTER TABLE public.ds_scan_public_service_comparisons
  DROP CONSTRAINT IF EXISTS ds_scan_public_service_comparisons_comparison_json_check;
ALTER TABLE public.ds_scan_public_service_comparisons
  ADD CONSTRAINT ds_scan_public_service_comparisons_comparison_json_check
  CHECK (public.ds_valid_public_service_comparison(comparison_json) AND pg_column_size(comparison_json) <= 65536);

CREATE OR REPLACE FUNCTION public.ds_complete_scan_with_service_comparison(
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
    pg_column_size(p_public_service_comparison_json) <= 65536,
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
