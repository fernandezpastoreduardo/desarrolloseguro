CREATE FUNCTION public.ds_valid_first_entry_policy_access(p_value jsonb)
RETURNS boolean
LANGUAGE plpgsql
IMMUTABLE
STRICT
PARALLEL SAFE
SET search_path = pg_catalog, public
AS $$
DECLARE
  policy_link jsonb;
  hostname text;
  path_value text;
BEGIN
  IF jsonb_typeof(p_value) <> 'object' OR public.ds_public_policy_object_key_count(p_value) <> 9 OR
     NOT (p_value ?& ARRAY['policyVersion', 'status', 'reasonCode', 'consentPromptDetected',
       'thirdPartyCookieDetected', 'nonEssentialThirdPartyStorageDetected', 'linkLocation', 'link', 'documentAccess']) OR
     p_value->>'policyVersion' <> 'first-entry-policy-access-v1' OR
     jsonb_typeof(p_value->'status') <> 'string' OR
     p_value->>'status' NOT IN ('pass', 'fail', 'unknown') OR
     jsonb_typeof(p_value->'reasonCode') <> 'string' OR
     p_value->>'reasonCode' NOT IN ('consent_component_link_accessible', 'consent_link_missing',
       'consent_link_unavailable', 'footer_link_accessible_without_consent',
       'footer_insufficient_with_third_party_cookies', 'policy_link_missing', 'auditor_error') OR
     jsonb_typeof(p_value->'linkLocation') <> 'string' OR
     p_value->>'linkLocation' NOT IN ('consent_component', 'footer', 'none', 'unknown') OR
     jsonb_typeof(p_value->'documentAccess') <> 'string' OR
     p_value->>'documentAccess' NOT IN ('accessible', 'unavailable', 'not_checked', 'unknown') OR
     p_value->'consentPromptDetected' IS NULL OR
     jsonb_typeof(p_value->'consentPromptDetected') NOT IN ('boolean', 'null') OR
     p_value->'thirdPartyCookieDetected' IS NULL OR
     jsonb_typeof(p_value->'thirdPartyCookieDetected') NOT IN ('boolean', 'null') OR
     p_value->'nonEssentialThirdPartyStorageDetected' IS NULL OR
     jsonb_typeof(p_value->'nonEssentialThirdPartyStorageDetected') NOT IN ('boolean', 'null') OR
     pg_column_size(p_value) > 4096 THEN
    RETURN false;
  END IF;

  policy_link := p_value->'link';
  IF jsonb_typeof(policy_link) <> 'null' THEN
    IF jsonb_typeof(policy_link) <> 'object' OR public.ds_public_policy_object_key_count(policy_link) <> 3 OR
       NOT (policy_link ?& ARRAY['hostname', 'path', 'kind']) OR
       jsonb_typeof(policy_link->'hostname') <> 'string' OR
       jsonb_typeof(policy_link->'path') <> 'string' OR
       jsonb_typeof(policy_link->'kind') <> 'string' OR
       policy_link->>'kind' NOT IN ('privacy', 'cookies', 'terms', 'legal') THEN
      RETURN false;
    END IF;
    hostname := lower(policy_link->>'hostname');
    path_value := policy_link->>'path';
    IF length(hostname) NOT BETWEEN 1 AND 253 OR
       NOT COALESCE(hostname ~ '^([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)(\.([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?))*$', false) OR
       hostname ~ '^[0-9.]+$' OR
       hostname = 'localhost' OR hostname ~ '\.(localhost|local|internal|test|invalid|example|onion|lan|home|corp|intranet|private)$' OR
       hostname ~ '\.home\.arpa$' OR length(path_value) > 512 OR left(path_value, 1) <> '/' OR
       path_value ~ '[?#[:space:][:cntrl:]]' THEN
      RETURN false;
    END IF;
  END IF;

  IF p_value->>'status' = 'pass' AND p_value->>'documentAccess' <> 'accessible' THEN RETURN false; END IF;
  IF p_value->>'status' = 'unknown' AND p_value->>'reasonCode' <> 'auditor_error' THEN RETURN false; END IF;
  IF p_value->>'status' = 'fail' AND p_value->>'reasonCode' = 'auditor_error' THEN RETURN false; END IF;
  IF p_value->>'status' = 'pass' AND p_value->>'consentPromptDetected' = 'true' AND
     (p_value->>'linkLocation' <> 'consent_component' OR p_value->>'reasonCode' <> 'consent_component_link_accessible') THEN RETURN false; END IF;
  IF p_value->>'status' = 'pass' AND p_value->>'consentPromptDetected' = 'false' AND
     (p_value->>'thirdPartyCookieDetected' IS DISTINCT FROM 'false' OR p_value->>'linkLocation' <> 'footer' OR
      p_value->>'reasonCode' <> 'footer_link_accessible_without_consent') THEN RETURN false; END IF;
  IF p_value->>'reasonCode' = 'consent_link_missing' AND
     (p_value->>'consentPromptDetected' IS DISTINCT FROM 'true' OR p_value->>'linkLocation' <> 'none' OR policy_link IS DISTINCT FROM 'null'::jsonb) THEN RETURN false; END IF;
  IF p_value->>'reasonCode' = 'consent_link_unavailable' AND
     (p_value->>'documentAccess' <> 'unavailable' OR policy_link IS NULL OR policy_link = 'null'::jsonb) THEN RETURN false; END IF;
  IF p_value->>'reasonCode' = 'footer_link_accessible_without_consent' AND
     (p_value->>'consentPromptDetected' IS DISTINCT FROM 'false' OR p_value->>'thirdPartyCookieDetected' IS DISTINCT FROM 'false' OR
      p_value->>'documentAccess' <> 'accessible' OR p_value->>'linkLocation' <> 'footer') THEN RETURN false; END IF;
  IF p_value->>'reasonCode' = 'footer_insufficient_with_third_party_cookies' AND
     (p_value->>'consentPromptDetected' IS DISTINCT FROM 'false' OR p_value->>'thirdPartyCookieDetected' IS DISTINCT FROM 'true' OR
      p_value->>'linkLocation' <> 'footer') THEN RETURN false; END IF;
  IF p_value->>'reasonCode' = 'policy_link_missing' AND
     (p_value->>'linkLocation' <> 'none' OR policy_link IS DISTINCT FROM 'null'::jsonb) THEN RETURN false; END IF;
  IF p_value->>'linkLocation' = 'none' AND policy_link IS DISTINCT FROM 'null'::jsonb THEN RETURN false; END IF;
  IF p_value->>'linkLocation' IN ('consent_component', 'footer') AND
     (policy_link IS NULL OR policy_link = 'null'::jsonb) THEN RETURN false; END IF;
  RETURN true;
END;
$$;

CREATE TABLE public.ds_scan_first_entry_policy_access (
  run_id uuid PRIMARY KEY REFERENCES public.ds_scan_runs(id) ON DELETE CASCADE,
  assessment_json jsonb NOT NULL CHECK (
    public.ds_valid_first_entry_policy_access(assessment_json) AND pg_column_size(assessment_json) <= 4096
  ),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TRIGGER ds_scan_first_entry_policy_access_immutable
  BEFORE UPDATE OR DELETE ON public.ds_scan_first_entry_policy_access
  FOR EACH ROW EXECUTE FUNCTION public.ds_reject_report_mutation();

CREATE OR REPLACE FUNCTION public.ds_complete_scan_with_provider_catalog(
  p_job_id uuid, p_lease_token uuid, p_completed_at timestamptz, p_scanner_version text,
  p_started_at timestamptz, p_verdict text, p_scope_json jsonb, p_checks_json jsonb,
  p_metrics_json jsonb, p_privacy_assessment_json jsonb, p_processor_transparency_json jsonb,
  p_internal_audit_summary_json jsonb, p_public_policy_json jsonb,
  p_public_service_comparison_json jsonb, p_legal_cookie_findings_json jsonb,
  p_provider_catalog_version text, p_first_entry_policy_access_json jsonb
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE report_id uuid;
BEGIN
  IF p_first_entry_policy_access_json IS NOT NULL AND NOT COALESCE(
    public.ds_valid_first_entry_policy_access(p_first_entry_policy_access_json), false
  ) THEN RAISE EXCEPTION 'invalid_first_entry_policy_access'; END IF;
  report_id := public.ds_complete_scan_with_provider_catalog(
    p_job_id, p_lease_token, p_completed_at, p_scanner_version, p_started_at,
    p_verdict, p_scope_json, p_checks_json, p_metrics_json, p_privacy_assessment_json,
    p_processor_transparency_json, p_internal_audit_summary_json, p_public_policy_json,
    p_public_service_comparison_json, p_legal_cookie_findings_json, p_provider_catalog_version
  );
  IF p_first_entry_policy_access_json IS NOT NULL THEN
    INSERT INTO public.ds_scan_first_entry_policy_access(run_id, assessment_json)
    VALUES (report_id, p_first_entry_policy_access_json);
  END IF;
  RETURN report_id;
END;
$$;

REVOKE ALL ON public.ds_scan_first_entry_policy_access FROM PUBLIC;
REVOKE ALL ON FUNCTION public.ds_valid_first_entry_policy_access(jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.ds_complete_scan_with_provider_catalog(
  uuid, uuid, timestamptz, text, timestamptz, text, jsonb, jsonb, jsonb,
  jsonb, jsonb, jsonb, jsonb, jsonb, jsonb, text, jsonb
) FROM PUBLIC;
