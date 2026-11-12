-- Add passive tracking-reference and initial-response measurements without
-- changing the immutable domain-v1 report contract.
INSERT INTO public.ds_profile_controls(profile_version, control_id, required)
VALUES
  ('domain-v2', 'DS-DNS-01', true),
  ('domain-v2', 'DS-TLS-01', true),
  ('domain-v2', 'DS-HTTP-01', true),
  ('domain-v2', 'DS-HDR-01', true),
  ('domain-v2', 'DS-PRIV-05', true),
  ('domain-v2', 'DS-PRIV-06', true),
  ('domain-v2', 'DS-QUAL-02', true)
ON CONFLICT(profile_version, control_id) DO NOTHING;

INSERT INTO public.ds_profile_check_rules(profile_version, control_id, target_kind, method)
VALUES
  ('domain-v2', 'DS-DNS-01', 'host', 'DNS'),
  ('domain-v2', 'DS-TLS-01', 'host', 'TLS'),
  ('domain-v2', 'DS-HTTP-01', 'route', 'HEAD'),
  ('domain-v2', 'DS-HTTP-01', 'route', 'GET'),
  ('domain-v2', 'DS-HDR-01', 'route', 'GET'),
  ('domain-v2', 'DS-PRIV-05', 'route', 'GET'),
  ('domain-v2', 'DS-PRIV-06', 'route', 'GET'),
  ('domain-v2', 'DS-QUAL-02', 'route', 'GET')
ON CONFLICT(profile_version, control_id, target_kind, method) DO NOTHING;

-- Expose only explicitly approved evidence keys to API readers. The underlying
-- evidence_json column remains unavailable to ds_read and ds_api.
CREATE OR REPLACE VIEW public.ds_public_check_results AS
SELECT
  checks.run_id,
  checks.control_id,
  checks.status,
  checks.required,
  checks.severity,
  checks.observed_at,
  checks.target_path,
  checks.method,
  checks.summary,
  checks.limitation,
  COALESCE((
    SELECT jsonb_object_agg(item.key, item.value)
    FROM jsonb_each(checks.evidence_json) AS item(key, value)
    WHERE item.key = ANY(CASE checks.control_id
      WHEN 'DS-DNS-01' THEN ARRAY['addressClass', 'aRecordCount', 'aaaaRecordCount']
      WHEN 'DS-TLS-01' THEN ARRAY['protocol', 'certificateValid', 'hostnameMatches']
      WHEN 'DS-TLS-02' THEN ARRAY['tls10Accepted', 'tls11Accepted', 'tls12Accepted', 'tls13Accepted']
      WHEN 'DS-HTTP-01' THEN ARRAY['statusCode', 'redirectedToHttps', 'finalScheme']
      WHEN 'DS-HDR-01' THEN ARRAY['finalScheme', 'hsts', 'nosniff', 'frameProtection', 'referrerPolicy', 'csp']
      WHEN 'DS-PRIV-05' THEN ARRAY['inspected', 'cookieCount', 'insecureCookieCount', 'catalogMatchCount', 'consentPromptDetected']
      WHEN 'DS-PRIV-06' THEN ARRAY['inspected', 'thirdPartyResourceReferences', 'knownTrackingResourceReferences']
      WHEN 'DS-QUAL-02' THEN ARRAY['inspected', 'responseTimeMs', 'responseBytes']
      ELSE ARRAY[]::text[]
    END)
  ), '{}'::jsonb) AS evidence_json
FROM public.ds_check_results AS checks;

-- Existing runs remain domain-v1 history; only future admissions use v2.
UPDATE public.ds_domains SET profile_version = 'domain-v2'
WHERE profile_version = 'domain-v1';

DO $$
DECLARE
  function_definition text;
  updated_definition text;
BEGIN
  SELECT pg_get_functiondef('public.ds_validate_scan_scope_before_insert()'::regprocedure)
  INTO function_definition;
  updated_definition := regexp_replace(function_definition,
    $pattern$NEW[.]profile_version NOT IN[[:space:]]*[(][^)]*[)]$pattern$,
    $new$NEW.profile_version NOT IN ('controls-v1', 'controls-v2', 'controls-v3', 'domain-v1', 'domain-v2', 'transport-v1')$new$);
  updated_definition := replace(updated_definition,
    $old$NEW.profile_version IN ('transport-v1', 'domain-v1')$old$,
    $new$NEW.profile_version IN ('transport-v1', 'domain-v1', 'domain-v2')$new$);
  IF updated_definition = function_definition
    OR position($expected$NEW.profile_version NOT IN ('controls-v1', 'controls-v2', 'controls-v3', 'domain-v1', 'domain-v2', 'transport-v1')$expected$ IN updated_definition) = 0
    OR position($expected$NEW.profile_version IN ('transport-v1', 'domain-v1', 'domain-v2')$expected$ IN updated_definition) = 0 THEN
    RAISE EXCEPTION 'domain_v2_scope_validator_extension_failed';
  END IF;
  EXECUTE updated_definition;

  SELECT pg_get_functiondef('public.ds_validate_check_result_before_insert()'::regprocedure)
  INTO function_definition;
  updated_definition := replace(function_definition,
    $old$'domain-v1', 'transport-v1'$old$,
    $new$'domain-v1', 'domain-v2', 'transport-v1'$new$);
  updated_definition := replace(updated_definition,
    $old$WHEN 'DS-PRIV-05' THEN ARRAY['GET']$old$,
    $new$WHEN 'DS-PRIV-05' THEN ARRAY['GET']
    WHEN 'DS-PRIV-06' THEN ARRAY['GET']
    WHEN 'DS-QUAL-02' THEN ARRAY['GET']$new$);
  updated_definition := replace(updated_definition,
    $old$WHEN run_profile_version IN ('controls-v3', 'domain-v1', 'transport-v1')$old$,
    $new$WHEN run_profile_version IN ('controls-v3', 'domain-v1', 'domain-v2', 'transport-v1')$new$);
  updated_definition := replace(updated_definition,
    $old$      WHEN 'DS-PRIV-05' THEN CASE evidence_key$old$,
    $new$      WHEN 'DS-PRIV-06' THEN CASE evidence_key
        WHEN 'inspected' THEN 'boolean'
        WHEN 'thirdPartyResourceReferences' THEN 'count'
        WHEN 'knownTrackingResourceReferences' THEN 'count'
        ELSE NULL END
      WHEN 'DS-QUAL-02' THEN CASE evidence_key
        WHEN 'inspected' THEN 'boolean'
        WHEN 'responseTimeMs' THEN 'count'
        WHEN 'responseBytes' THEN 'count'
        ELSE NULL END
      WHEN 'DS-PRIV-05' THEN CASE evidence_key$new$);
  updated_definition := replace(updated_definition,
    $old$    WHEN 'DS-PRIV-05' THEN
      NEW.evidence_json->>'inspected' = 'true'$old$,
    $new$    WHEN 'DS-PRIV-06' THEN
      NEW.evidence_json->>'inspected' = 'true'
      AND NEW.evidence_json ? 'knownTrackingResourceReferences'
      AND NEW.evidence_json->>'knownTrackingResourceReferences' = '0'
    WHEN 'DS-QUAL-02' THEN
      NEW.evidence_json->>'inspected' = 'true'
      AND NEW.evidence_json->>'responseTimeMs' ~ '^[0-9]+$'
      AND (NEW.evidence_json->>'responseTimeMs')::integer <= 2500
      AND NEW.evidence_json ? 'responseBytes'
    WHEN 'DS-PRIV-05' THEN
      NEW.evidence_json->>'inspected' = 'true'$new$);
  IF position('DS-PRIV-06' IN updated_definition) = 0
    OR position('DS-QUAL-02' IN updated_definition) = 0
    OR position('domain-v2' IN updated_definition) = 0 THEN
    RAISE EXCEPTION 'domain_v2_check_validator_extension_failed';
  END IF;
  EXECUTE updated_definition;

  SELECT pg_get_functiondef('public.ds_validate_profile_check_coverage()'::regprocedure)
  INTO function_definition;
  updated_definition := replace(function_definition,
    $old$'domain-v1', 'transport-v1'$old$,
    $new$'domain-v1', 'domain-v2', 'transport-v1'$new$);
  IF updated_definition = function_definition THEN
    RAISE EXCEPTION 'domain_v2_coverage_validator_extension_failed';
  END IF;
  EXECUTE updated_definition;

  SELECT pg_get_functiondef('public.ds_request_on_demand_scan(text)'::regprocedure)
  INTO function_definition;
  updated_definition := replace(function_definition,
    $old$VALUES (p_hostname, 'on_demand', 'domain-v1')$old$,
    $new$VALUES (p_hostname, 'on_demand', 'domain-v2')$new$);
  IF updated_definition = function_definition THEN
    RAISE EXCEPTION 'domain_v2_admission_profile_extension_failed';
  END IF;
  EXECUTE updated_definition;
END;
$$;
