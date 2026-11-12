-- Persist only allowlisted transport error categories for incomplete TLS probes.
DO $$
DECLARE
  function_definition text;
  updated_definition text;
BEGIN
  SELECT pg_get_functiondef('public.ds_validate_check_result_before_insert()'::regprocedure)
  INTO function_definition;

  updated_definition := replace(function_definition,
    $old$WHEN 'DS-TLS-02' THEN CASE evidence_key
        WHEN 'tls10Accepted' THEN 'boolean'
        WHEN 'tls11Accepted' THEN 'boolean'
        WHEN 'tls12Accepted' THEN 'boolean'
        WHEN 'tls13Accepted' THEN 'boolean'
        ELSE NULL END$old$,
    $new$WHEN 'DS-TLS-02' THEN CASE evidence_key
        WHEN 'tls10Accepted' THEN 'boolean'
        WHEN 'tls11Accepted' THEN 'boolean'
        WHEN 'tls12Accepted' THEN 'boolean'
        WHEN 'tls13Accepted' THEN 'boolean'
        WHEN 'tls10ProbeError' THEN 'enum:dns_resolution_failed,connection_failed,broker_failed,request_aborted,request_timeout,response_size_limit_exceeded,https_request_failed,http_request_failed,invalid_http_response,redirect_limit_exceeded,redirect_origin_not_allowlisted,redirect_path_not_allowlisted,tls_certificate_invalid,tls_handshake_failed,transport_failed'
        WHEN 'tls11ProbeError' THEN 'enum:dns_resolution_failed,connection_failed,broker_failed,request_aborted,request_timeout,response_size_limit_exceeded,https_request_failed,http_request_failed,invalid_http_response,redirect_limit_exceeded,redirect_origin_not_allowlisted,redirect_path_not_allowlisted,tls_certificate_invalid,tls_handshake_failed,transport_failed'
        WHEN 'tls12ProbeError' THEN 'enum:dns_resolution_failed,connection_failed,broker_failed,request_aborted,request_timeout,response_size_limit_exceeded,https_request_failed,http_request_failed,invalid_http_response,redirect_limit_exceeded,redirect_origin_not_allowlisted,redirect_path_not_allowlisted,tls_certificate_invalid,tls_handshake_failed,transport_failed'
        WHEN 'tls13ProbeError' THEN 'enum:dns_resolution_failed,connection_failed,broker_failed,request_aborted,request_timeout,response_size_limit_exceeded,https_request_failed,http_request_failed,invalid_http_response,redirect_limit_exceeded,redirect_origin_not_allowlisted,redirect_path_not_allowlisted,tls_certificate_invalid,tls_handshake_failed,transport_failed'
        ELSE NULL END$new$);

  IF updated_definition = function_definition
    OR position('tls13ProbeError' IN updated_definition) = 0 THEN
    RAISE EXCEPTION 'tls_probe_diagnostic_contract_extension_failed';
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
      WHEN 'DS-HTTP-01' THEN ARRAY['statusCode', 'redirectedToHttps', 'finalScheme']
      WHEN 'DS-HDR-01' THEN ARRAY['finalScheme', 'hsts', 'nosniff', 'frameProtection', 'referrerPolicy', 'csp']
      WHEN 'DS-PRIV-05' THEN ARRAY['inspected', 'cookieCount', 'insecureCookieCount', 'catalogMatchCount', 'consentPromptDetected']
      WHEN 'DS-PRIV-06' THEN ARRAY['inspected', 'thirdPartyResourceReferences', 'knownTrackingResourceReferences']
      WHEN 'DS-QUAL-02' THEN ARRAY['inspected', 'responseTimeMs', 'responseBytes']
      ELSE ARRAY[]::text[]
    END)
  ), '{}'::jsonb) AS evidence_json
FROM public.ds_check_results AS checks;
