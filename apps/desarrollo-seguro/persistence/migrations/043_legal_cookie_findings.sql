CREATE FUNCTION public.ds_valid_legal_cookie_findings(p_value jsonb)
RETURNS boolean
LANGUAGE plpgsql
IMMUTABLE
STRICT
PARALLEL SAFE
SET search_path = pg_catalog, public
AS $$
DECLARE
  item jsonb;
  evidence_item jsonb;
BEGIN
  IF jsonb_typeof(p_value) <> 'array' OR jsonb_array_length(p_value) > 2 THEN RETURN false; END IF;
  FOR item IN SELECT value FROM jsonb_array_elements(p_value) LOOP
    IF jsonb_typeof(item) <> 'object' OR public.ds_public_policy_object_key_count(item) <> 12 OR
       NOT (item ?& ARRAY['ruleId', 'ruleVersion', 'status', 'title', 'description', 'jurisdiction',
         'articles', 'infringementClass', 'sanction', 'authority', 'evidence', 'evidenceComplete']) OR
       NOT COALESCE(item->>'ruleId' IN ('lssi-cookie-no-prior-consent-v1', 'lssi-cookie-after-rejection-v1'), false) OR
       item->>'ruleVersion' <> '1.0.0' OR item->>'status' <> 'accredited' OR
       item->>'jurisdiction' <> 'ES' OR item->>'infringementClass' <> 'minor' OR
       item->>'authority' <> 'Agencia Española de Protección de Datos' OR
       item->>'evidenceComplete' <> 'true' OR
       item #>> '{sanction,type}' <> 'statutory_maximum' OR
       item #>> '{sanction,currency}' <> 'EUR' OR item #>> '{sanction,maximum}' <> '30000' OR
       jsonb_typeof(item->'evidence') <> 'array' OR jsonb_array_length(item->'evidence') < 1 OR
       jsonb_array_length(item->'evidence') > 50 OR jsonb_typeof(item->'articles') <> 'array' OR
       jsonb_array_length(item->'articles') <> 4 THEN RETURN false; END IF;
    FOR evidence_item IN SELECT value FROM jsonb_array_elements(item->'evidence') LOOP
      IF jsonb_typeof(evidence_item) <> 'object' OR public.ds_public_policy_object_key_count(evidence_item) <> 9 OR
         NOT (evidence_item ?& ARRAY['flow', 'phase', 'capturedAtMs', 'cookieName', 'cookieDomain', 'provider',
           'purpose', 'attributionRuleId', 'correlatedRequestHosts']) OR
         NOT COALESCE(evidence_item->>'flow' IN ('initial', 'reject'), false) OR
         NOT COALESCE(evidence_item->>'phase' IN ('before_choice', 'after_choice', 'after_reload'), false) OR
         jsonb_typeof(evidence_item->'capturedAtMs') <> 'number' OR
         jsonb_typeof(evidence_item->'correlatedRequestHosts') <> 'array' OR
         jsonb_array_length(evidence_item->'correlatedRequestHosts') > 20 THEN RETURN false; END IF;
    END LOOP;
  END LOOP;
  RETURN true;
END;
$$;

CREATE TABLE public.ds_scan_legal_cookie_findings (
  run_id uuid PRIMARY KEY REFERENCES public.ds_scan_runs(id) ON DELETE CASCADE,
  findings_json jsonb NOT NULL CHECK (
    public.ds_valid_legal_cookie_findings(findings_json) AND pg_column_size(findings_json) <= 65536
  ),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TRIGGER ds_scan_legal_cookie_findings_immutable
  BEFORE UPDATE OR DELETE ON public.ds_scan_legal_cookie_findings
  FOR EACH ROW EXECUTE FUNCTION public.ds_reject_report_mutation();

CREATE FUNCTION public.ds_complete_scan_with_legal_cookie_findings(
  p_job_id uuid, p_lease_token uuid, p_completed_at timestamptz, p_scanner_version text,
  p_started_at timestamptz, p_verdict text, p_scope_json jsonb, p_checks_json jsonb,
  p_metrics_json jsonb, p_privacy_assessment_json jsonb, p_processor_transparency_json jsonb,
  p_internal_audit_summary_json jsonb, p_public_policy_json jsonb,
  p_public_service_comparison_json jsonb, p_legal_cookie_findings_json jsonb
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE report_id uuid;
BEGIN
  IF p_legal_cookie_findings_json IS NULL OR NOT COALESCE(
    public.ds_valid_legal_cookie_findings(p_legal_cookie_findings_json) AND
    pg_column_size(p_legal_cookie_findings_json) <= 65536, false
  ) THEN RAISE EXCEPTION 'invalid_legal_cookie_findings'; END IF;
  report_id := public.ds_complete_scan_with_service_comparison(
    p_job_id, p_lease_token, p_completed_at, p_scanner_version, p_started_at,
    p_verdict, p_scope_json, p_checks_json, p_metrics_json, p_privacy_assessment_json,
    p_processor_transparency_json, p_internal_audit_summary_json, p_public_policy_json,
    p_public_service_comparison_json
  );
  IF jsonb_array_length(p_legal_cookie_findings_json) > 0 THEN
    INSERT INTO public.ds_scan_legal_cookie_findings(run_id, findings_json)
    VALUES (report_id, p_legal_cookie_findings_json);
  END IF;
  RETURN report_id;
END;
$$;

REVOKE ALL ON public.ds_scan_legal_cookie_findings FROM PUBLIC;
REVOKE ALL ON FUNCTION public.ds_valid_legal_cookie_findings(jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.ds_complete_scan_with_legal_cookie_findings(
  uuid, uuid, timestamptz, text, timestamptz, text, jsonb, jsonb, jsonb,
  jsonb, jsonb, jsonb, jsonb, jsonb, jsonb
) FROM PUBLIC;
