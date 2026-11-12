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
