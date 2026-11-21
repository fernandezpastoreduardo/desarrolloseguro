-- Allow only bounded Grumphya hostname redirects through the trust boundary.
DO $$
DECLARE
  function_definition text;
  updated_definition text;
BEGIN
  SELECT pg_get_functiondef('public.ds_validate_check_result_before_insert()'::regprocedure)
  INTO function_definition;

  updated_definition := replace(function_definition,
    $old$      WHEN 'DS-HTTP-01' THEN CASE evidence_key
        WHEN 'statusCode' THEN 'http_status'
        WHEN 'redirectedToHttps' THEN 'boolean'
        WHEN 'finalScheme' THEN 'enum:http,https'
        ELSE NULL END$old$,
    $new$      WHEN 'DS-HTTP-01' THEN CASE evidence_key
        WHEN 'statusCode' THEN 'http_status'
        WHEN 'redirectedToHttps' THEN 'boolean'
        WHEN 'finalScheme' THEN 'enum:http,https'
        WHEN 'requestedHostname' THEN CASE WHEN run_hostname IN ('grumphya.com', 'www.grumphya.com') THEN 'enum:grumphya.com,www.grumphya.com' ELSE NULL END
        WHEN 'finalHostname' THEN CASE WHEN run_hostname IN ('grumphya.com', 'www.grumphya.com') THEN 'enum:grumphya.com,www.grumphya.com' ELSE NULL END
        WHEN 'canonicalHostname' THEN CASE WHEN run_hostname IN ('grumphya.com', 'www.grumphya.com') THEN 'enum:grumphya.com,www.grumphya.com' ELSE NULL END
        WHEN 'redirectFromHostname' THEN CASE WHEN run_hostname IN ('grumphya.com', 'www.grumphya.com') THEN 'enum:grumphya.com,www.grumphya.com' ELSE NULL END
        WHEN 'redirectToHostname' THEN CASE WHEN run_hostname IN ('grumphya.com', 'www.grumphya.com') THEN 'enum:grumphya.com,www.grumphya.com' ELSE NULL END
        WHEN 'redirectStatusCode' THEN CASE WHEN run_hostname IN ('grumphya.com', 'www.grumphya.com') THEN 'http_status' ELSE NULL END
        ELSE NULL END$new$);

  IF updated_definition = function_definition
    OR position('redirectStatusCode' IN updated_definition) = 0 THEN
    RAISE EXCEPTION 'grumphya_redirect_evidence_contract_extension_failed';
  END IF;
  EXECUTE updated_definition;
END;
$$;

DO $$
DECLARE
  function_definition text;
  updated_definition text;
BEGIN
  SELECT pg_get_functiondef('public.ds_validate_check_result_before_insert()'::regprocedure)
  INTO function_definition;
  updated_definition := replace(function_definition,
    $old$  pass_supported := CASE NEW.control_id$old$,
    $new$  IF NEW.control_id = 'DS-HTTP-01' AND
    (NEW.evidence_json ? 'requestedHostname' OR NEW.evidence_json ? 'finalHostname'
      OR NEW.evidence_json ? 'canonicalHostname' OR NEW.evidence_json ? 'redirectStatusCode'
      OR NEW.evidence_json ? 'redirectFromHostname' OR NEW.evidence_json ? 'redirectToHostname') AND
    NOT (
      NEW.evidence_json->>'requestedHostname' = run_hostname
      AND NEW.evidence_json->>'finalHostname' = NEW.evidence_json->>'redirectToHostname'
      AND NEW.evidence_json->>'redirectFromHostname' = NEW.evidence_json->>'requestedHostname'
      AND NEW.evidence_json->>'redirectFromHostname' <> NEW.evidence_json->>'redirectToHostname'
      AND (
        (NEW.evidence_json->>'redirectStatusCode' IN ('301', '308')
          AND NEW.evidence_json->>'canonicalHostname' = NEW.evidence_json->>'finalHostname')
        OR (NEW.evidence_json->>'redirectStatusCode' IN ('302', '303', '307')
          AND NOT (NEW.evidence_json ? 'canonicalHostname'))
      )
    ) THEN
    RAISE EXCEPTION 'scan_evidence_invalid';
  END IF;

  pass_supported := CASE NEW.control_id$new$);
  IF updated_definition = function_definition OR position('scan_evidence_invalid' IN updated_definition) = 0 THEN
    RAISE EXCEPTION 'grumphya_redirect_evidence_guard_extension_failed';
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
      WHEN 'DS-PRIV-05' THEN ARRAY['inspected', 'cookieCount', 'insecureCookieCount', 'catalogMatchCount', 'consentPromptDetected']
      WHEN 'DS-PRIV-06' THEN ARRAY['inspected', 'thirdPartyResourceReferences', 'knownTrackingResourceReferences']
      WHEN 'DS-QUAL-02' THEN ARRAY['inspected', 'responseTimeMs', 'responseBytes']
      ELSE ARRAY[]::text[]
    END)
  ), '{}'::jsonb) AS evidence_json
FROM public.ds_check_results AS checks;
