-- Public policy transparency check for non-client domains.
-- Keep prior profile versions immutable and move new scans to domain-v4.
INSERT INTO public.ds_profile_controls(profile_version, control_id, required)
SELECT 'domain-v4', control_id, required
FROM public.ds_profile_controls
WHERE profile_version = 'domain-v3'
ON CONFLICT(profile_version, control_id) DO NOTHING;

INSERT INTO public.ds_profile_controls(profile_version, control_id, required)
VALUES ('domain-v4', 'DS-PRIV-04', true)
ON CONFLICT(profile_version, control_id) DO NOTHING;

INSERT INTO public.ds_profile_check_rules(profile_version, control_id, target_kind, method)
SELECT 'domain-v4', control_id, target_kind, method
FROM public.ds_profile_check_rules
WHERE profile_version = 'domain-v3'
ON CONFLICT(profile_version, control_id, target_kind, method) DO NOTHING;

INSERT INTO public.ds_profile_check_rules(profile_version, control_id, target_kind, method)
VALUES ('domain-v4', 'DS-PRIV-04', 'host', 'GET')
ON CONFLICT(profile_version, control_id, target_kind, method) DO NOTHING;

UPDATE public.ds_domains
SET profile_version = 'domain-v4'
WHERE profile_version = 'domain-v3';

DO $$
DECLARE
  function_definition text;
  updated_definition text;
BEGIN
  SELECT pg_get_functiondef('public.ds_validate_scan_scope_before_insert()'::regprocedure)
  INTO function_definition;
  updated_definition := replace(function_definition, '''domain-v3''', '''domain-v3'', ''domain-v4''');
  IF updated_definition = function_definition OR position('domain-v4' IN updated_definition) = 0 THEN
    RAISE EXCEPTION 'domain_v4_scope_validator_extension_failed';
  END IF;
  EXECUTE updated_definition;

  SELECT pg_get_functiondef('public.ds_validate_check_result_before_insert()'::regprocedure)
  INTO function_definition;
  updated_definition := replace(function_definition, '''domain-v3''', '''domain-v3'', ''domain-v4''');
  IF updated_definition = function_definition OR position('domain-v4' IN updated_definition) = 0 THEN
    RAISE EXCEPTION 'domain_v4_check_validator_extension_failed';
  END IF;
  EXECUTE updated_definition;

  SELECT pg_get_functiondef('public.ds_validate_profile_check_coverage()'::regprocedure)
  INTO function_definition;
  updated_definition := replace(function_definition, '''domain-v3''', '''domain-v3'', ''domain-v4''');
  IF updated_definition = function_definition OR position('domain-v4' IN updated_definition) = 0 THEN
    RAISE EXCEPTION 'domain_v4_coverage_validator_extension_failed';
  END IF;
  EXECUTE updated_definition;

  SELECT pg_get_functiondef('public.ds_request_on_demand_scan(text)'::regprocedure)
  INTO function_definition;
  updated_definition := replace(
    function_definition,
    $old$VALUES (p_hostname, 'on_demand', 'domain-v3')$old$,
    $new$VALUES (p_hostname, 'on_demand', 'domain-v4')$new$
  );
  IF updated_definition = function_definition THEN
    RAISE EXCEPTION 'domain_v4_on_demand_admission_extension_failed';
  END IF;
  EXECUTE updated_definition;

  SELECT pg_get_functiondef('public.ds_sync_beta_certification(uuid)'::regprocedure)
  INTO function_definition;
  updated_definition := replace(function_definition, $old$'domain-v3')$old$, $new$'domain-v3', 'domain-v4')$new$);
  IF updated_definition = function_definition THEN
    RAISE EXCEPTION 'domain_v4_certification_profile_extension_failed';
  END IF;
  EXECUTE updated_definition;

  SELECT pg_get_functiondef('public.ds_enqueue_due_certification_scans(timestamptz)'::regprocedure)
  INTO function_definition;
  updated_definition := replace(function_definition, $old$'domain-v3')$old$, $new$'domain-v3', 'domain-v4')$new$);
  IF updated_definition = function_definition THEN
    RAISE EXCEPTION 'domain_v4_certification_scheduler_extension_failed';
  END IF;
  EXECUTE updated_definition;

  SELECT pg_get_functiondef('public.ds_purge_inactive_public_reports(timestamptz)'::regprocedure)
  INTO function_definition;
  updated_definition := replace(function_definition, $old$'domain-v3')$old$, $new$'domain-v3', 'domain-v4')$new$);
  IF updated_definition = function_definition THEN
    RAISE EXCEPTION 'domain_v4_retention_profile_extension_failed';
  END IF;
  EXECUTE updated_definition;
END;
$$;

-- Extend the PostgreSQL evidence boundary; the worker is not the trust boundary.
DO $$
DECLARE
  function_definition text;
  updated_definition text;
BEGIN
  SELECT pg_get_functiondef('public.ds_validate_check_result_before_insert()'::regprocedure)
  INTO function_definition;
  updated_definition := replace(function_definition, '''domain-v3''', '''domain-v3'', ''domain-v4''');
  updated_definition := replace(
    updated_definition,
    $old$    WHEN 'DS-PRIV-03' THEN ARRAY['GET']$old$,
    $new$    WHEN 'DS-PRIV-03' THEN ARRAY['GET']
    WHEN 'DS-PRIV-04' THEN ARRAY['GET']$new$
  );
  updated_definition := replace(
    updated_definition,
    $old$      WHEN 'DS-PRIV-05' THEN CASE evidence_key$old$,
    $new$      WHEN 'DS-PRIV-04' THEN CASE evidence_key
        WHEN 'inspected' THEN 'boolean'
        WHEN 'privacyPolicyLinksFound' THEN 'count'
        WHEN 'policyLinksFound' THEN 'count'
        WHEN 'sitePrivacyPolicyFetched' THEN 'boolean'
        WHEN 'policyPagesFetched' THEN 'count'
        WHEN 'policyPagesMissing' THEN 'count'
        WHEN 'policyPagesDenied' THEN 'count'
        WHEN 'policyRecipientsMentioned' THEN 'boolean'
        WHEN 'policyPurposesMentioned' THEN 'boolean'
        WHEN 'policyTextBlocked' THEN 'boolean'
        WHEN 'policyProbeFailed' THEN 'boolean'
        WHEN 'policyLanguageCatalogVersion' THEN 'enum:public-policy-language-eea-v1'
        ELSE NULL END
      WHEN 'DS-PRIV-05' THEN CASE evidence_key$new$
  );
  updated_definition := replace(
    updated_definition,
    $old$    WHEN 'DS-PRIV-05' THEN
      NEW.evidence_json->>'inspected' = 'true'$old$,
    $new$    WHEN 'DS-PRIV-04' THEN
      NEW.evidence_json->>'inspected' = 'true'
      AND NEW.evidence_json->>'privacyPolicyLinksFound' ~ '^[0-9]+$'
      AND (NEW.evidence_json->>'privacyPolicyLinksFound')::integer > 0
      AND NEW.evidence_json->>'sitePrivacyPolicyFetched' = 'true'
      AND NEW.evidence_json->>'policyPagesDenied' = '0'
      AND NEW.evidence_json->>'policyPagesMissing' = '0'
      AND NEW.evidence_json->>'policyRecipientsMentioned' = 'true'
      AND NEW.evidence_json->>'policyPurposesMentioned' = 'true'
      AND NEW.evidence_json->>'policyTextBlocked' = 'false'
      AND NEW.evidence_json->>'policyProbeFailed' = 'false'
    WHEN 'DS-PRIV-05' THEN
      NEW.evidence_json->>'inspected' = 'true'$new$
  );
  IF updated_definition = function_definition
    OR position('DS-PRIV-04' IN updated_definition) = 0
    OR position('policyLanguageCatalogVersion' IN updated_definition) = 0
    OR position('domain-v4' IN updated_definition) = 0 THEN
    RAISE EXCEPTION 'domain_v4_check_contract_extension_failed';
  END IF;
  EXECUTE updated_definition;
END;
$$;

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
      WHEN 'DS-TLS-02' THEN ARRAY[
        'tls10Accepted', 'tls11Accepted', 'tls12Accepted', 'tls13Accepted',
        'tls10ProbeError', 'tls11ProbeError', 'tls12ProbeError', 'tls13ProbeError'
      ]
      WHEN 'DS-HTTP-01' THEN ARRAY[
        'statusCode', 'redirectedToHttps', 'finalScheme', 'requestedHostname',
        'finalHostname', 'canonicalHostname', 'redirectStatusCode',
        'redirectFromHostname', 'redirectToHostname'
      ]
      WHEN 'DS-HDR-01' THEN ARRAY['finalScheme', 'hsts', 'nosniff', 'frameProtection', 'referrerPolicy', 'csp']
      WHEN 'DS-PRIV-04' THEN ARRAY[
        'inspected', 'privacyPolicyLinksFound', 'policyLinksFound', 'sitePrivacyPolicyFetched',
        'policyPagesFetched', 'policyPagesMissing', 'policyPagesDenied',
        'policyRecipientsMentioned', 'policyPurposesMentioned', 'policyTextBlocked',
        'policyProbeFailed', 'policyLanguageCatalogVersion'
      ]
      WHEN 'DS-PRIV-05' THEN ARRAY['inspected', 'cookieCount', 'insecureCookieCount', 'catalogMatchCount', 'consentPromptDetected']
      WHEN 'DS-PRIV-06' THEN ARRAY['inspected', 'thirdPartyResourceReferences', 'knownTrackingResourceReferences']
      WHEN 'DS-QUAL-02' THEN ARRAY['inspected', 'responseTimeMs', 'responseBytes']
      ELSE ARRAY[]::text[]
    END)
  ), '{}'::jsonb) AS evidence_json
FROM public.ds_check_results AS checks;
