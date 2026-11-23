-- Give the privacy-cookie control's special summary the same bounded auditor
-- diagnostic used by the generic public controls when its page probe fails.
DO $$
DECLARE
  function_definition text;
  updated_definition text;
BEGIN
  SELECT pg_get_functiondef('public.ds_validate_check_result_before_insert()'::regprocedure)
  INTO function_definition;

  updated_definition := replace(
    function_definition,
    $old$WHEN NEW.control_id = 'DS-PRIV-05' THEN CASE
        WHEN NEW.evidence_json->>'inspected' = 'true'$old$,
    $new$WHEN NEW.control_id = 'DS-PRIV-05' THEN CASE
        WHEN NEW.status = 'unknown' AND NEW.evidence_json ? 'probeErrorCode' THEN
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
        WHEN NEW.evidence_json->>'inspected' = 'true'$new$
  );

  IF updated_definition = function_definition
    OR position('DS-PRIV-05' IN updated_definition) = 0
    OR position('WHEN NEW.status = ''unknown'' AND NEW.evidence_json ? ''probeErrorCode''' IN updated_definition) = 0
    OR position('El lector no pudo completar esta comprobación:' IN updated_definition) = 0 THEN
    RAISE EXCEPTION 'privacy_probe_diagnostic_summary_extension_failed';
  END IF;
  EXECUTE updated_definition;
END;
$$;
