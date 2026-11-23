-- Persist the bounded page-probe diagnostics admitted by the application.
-- PostgreSQL remains the trust boundary for both evidence and public summaries.
DO $$
DECLARE
  function_definition text;
  updated_definition text;
  probe_rule_count integer;
BEGIN
  SELECT pg_get_functiondef('public.ds_validate_check_result_before_insert()'::regprocedure)
  INTO function_definition;
  updated_definition := function_definition;

  updated_definition := replace(updated_definition,
    $old$        WHEN 'csp' THEN 'boolean'$old$,
    $new$        WHEN 'csp' THEN 'boolean'
        WHEN 'probeErrorCode' THEN 'enum:dns_resolution_failed,connection_failed,broker_failed,request_aborted,request_timeout,response_size_limit_exceeded,https_request_failed,http_request_failed,invalid_http_response,redirect_limit_exceeded,redirect_origin_not_allowlisted,redirect_path_not_allowlisted,tls_certificate_invalid,tls_handshake_failed,transport_failed'$new$);

  updated_definition := replace(updated_definition,
    $old$        WHEN 'policyLanguageCatalogVersion' THEN 'enum:public-policy-language-eea-v1'
        ELSE NULL END$old$,
    $new$        WHEN 'policyLanguageCatalogVersion' THEN 'enum:public-policy-language-eea-v1'
        WHEN 'probeErrorCode' THEN 'enum:dns_resolution_failed,connection_failed,broker_failed,request_aborted,request_timeout,response_size_limit_exceeded,https_request_failed,http_request_failed,invalid_http_response,redirect_limit_exceeded,redirect_origin_not_allowlisted,redirect_path_not_allowlisted,tls_certificate_invalid,tls_handshake_failed,transport_failed'
        ELSE NULL END$new$);

  updated_definition := replace(updated_definition,
    $old$        WHEN 'consentPromptDetected' THEN 'boolean'
        ELSE NULL END$old$,
    $new$        WHEN 'consentPromptDetected' THEN 'boolean'
        WHEN 'probeErrorCode' THEN 'enum:dns_resolution_failed,connection_failed,broker_failed,request_aborted,request_timeout,response_size_limit_exceeded,https_request_failed,http_request_failed,invalid_http_response,redirect_limit_exceeded,redirect_origin_not_allowlisted,redirect_path_not_allowlisted,tls_certificate_invalid,tls_handshake_failed,transport_failed'
        ELSE NULL END$new$);

  updated_definition := replace(updated_definition,
    $old$        WHEN 'knownTrackingResourceReferences' THEN 'count'
        ELSE NULL END$old$,
    $new$        WHEN 'knownTrackingResourceReferences' THEN 'count'
        WHEN 'probeErrorCode' THEN 'enum:dns_resolution_failed,connection_failed,broker_failed,request_aborted,request_timeout,response_size_limit_exceeded,https_request_failed,http_request_failed,invalid_http_response,redirect_limit_exceeded,redirect_origin_not_allowlisted,redirect_path_not_allowlisted,tls_certificate_invalid,tls_handshake_failed,transport_failed'
        ELSE NULL END$new$);

  updated_definition := replace(updated_definition,
    $old$        WHEN 'responseBytes' THEN 'count'
        ELSE NULL END$old$,
    $new$        WHEN 'responseBytes' THEN 'count'
        WHEN 'probeErrorCode' THEN 'enum:dns_resolution_failed,connection_failed,broker_failed,request_aborted,request_timeout,response_size_limit_exceeded,https_request_failed,http_request_failed,invalid_http_response,redirect_limit_exceeded,redirect_origin_not_allowlisted,redirect_path_not_allowlisted,tls_certificate_invalid,tls_handshake_failed,transport_failed'
        ELSE NULL END$new$);

  -- Build the public explanation from the code in the database as well, so a
  -- worker cannot persist arbitrary summary text alongside an allowlisted code.
  updated_definition := replace(updated_definition,
    $old$      ELSE 'Comprobación ' || NEW.control_id || ': ' || NEW.status || '.'
    END;$old$,
    $new$      WHEN NEW.status = 'unknown' AND NEW.evidence_json ? 'probeErrorCode' THEN
        'El lector no pudo completar esta comprobación: ' || CASE NEW.evidence_json->>'probeErrorCode'
          WHEN 'dns_resolution_failed' THEN 'no se pudo resolver el dominio'
          WHEN 'connection_failed' THEN 'no se pudo completar la conexión'
          WHEN 'broker_failed' THEN 'el servicio de medición no respondió'
          WHEN 'request_aborted' THEN 'la prueba se interrumpió'
          WHEN 'request_timeout' THEN 'se agotó el tiempo de espera'
          WHEN 'response_size_limit_exceeded' THEN 'la respuesta superó el límite permitido'
          WHEN 'https_request_failed' THEN 'falló la solicitud HTTPS'
          WHEN 'http_request_failed' THEN 'falló la solicitud de prueba'
          WHEN 'invalid_http_response' THEN 'se recibió una respuesta no válida'
          WHEN 'redirect_limit_exceeded' THEN 'se superó el límite de redirecciones'
          WHEN 'redirect_origin_not_allowlisted' THEN 'la redirección salió del dominio permitido'
          WHEN 'redirect_path_not_allowlisted' THEN 'la redirección salió de la ruta permitida'
          WHEN 'tls_certificate_invalid' THEN 'el certificado no pasó la comprobación'
          WHEN 'tls_handshake_failed' THEN 'el servidor rechazó la negociación de cifrado'
          ELSE 'la prueba no pudo completarse'
        END || '.'
      ELSE 'Comprobación ' || NEW.control_id || ': ' || NEW.status || '.'
    END;$new$);

  updated_definition := replace(updated_definition,
    $old$  RETURN NEW;$old$,
    $new$  IF NEW.evidence_json ? 'probeErrorCode' AND NEW.status <> 'unknown' THEN
    RAISE EXCEPTION 'scan_evidence_invalid';
  END IF;

  RETURN NEW;$new$);

  SELECT count(*) INTO probe_rule_count
  FROM regexp_matches(
    updated_definition,
    'WHEN ''probeErrorCode'' THEN ''enum:dns_resolution_failed',
    'g'
  );

  IF updated_definition = function_definition
    OR probe_rule_count <> 5
    OR position('probeErrorCode' IN updated_definition) = 0
    OR position('El lector no pudo completar esta comprobación:' IN updated_definition) = 0
    OR position('scan_evidence_invalid' IN updated_definition) = 0 THEN
    RAISE EXCEPTION 'public_probe_diagnostic_validator_extension_failed';
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
      WHEN 'DS-HDR-01' THEN ARRAY['finalScheme', 'hsts', 'nosniff', 'frameProtection', 'referrerPolicy', 'csp', 'probeErrorCode']
      WHEN 'DS-PRIV-04' THEN ARRAY[
        'inspected', 'privacyPolicyLinksFound', 'policyLinksFound', 'sitePrivacyPolicyFetched',
        'policyPagesFetched', 'policyPagesMissing', 'policyPagesDenied',
        'policyRecipientsMentioned', 'policyPurposesMentioned', 'policyTextBlocked',
        'policyProbeFailed', 'policyLanguageCatalogVersion', 'probeErrorCode'
      ]
      WHEN 'DS-PRIV-05' THEN ARRAY['inspected', 'cookieCount', 'insecureCookieCount', 'catalogMatchCount', 'consentPromptDetected', 'probeErrorCode']
      WHEN 'DS-PRIV-06' THEN ARRAY['inspected', 'thirdPartyResourceReferences', 'knownTrackingResourceReferences', 'probeErrorCode']
      WHEN 'DS-QUAL-02' THEN ARRAY['inspected', 'responseTimeMs', 'responseBytes', 'probeErrorCode']
      ELSE ARRAY[]::text[]
    END)
  ), '{}'::jsonb) AS evidence_json
FROM public.ds_check_results AS checks;
