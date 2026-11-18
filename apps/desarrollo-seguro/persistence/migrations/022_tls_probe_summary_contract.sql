-- Keep the public summary contract in sync with the safe TLS probe evidence.
-- The worker may explain allowlisted probe failures, but PostgreSQL remains
-- the trust boundary and derives the same bounded text from the evidence.
DO $$
DECLARE
  function_definition text;
  updated_definition text;
BEGIN
  SELECT pg_get_functiondef('public.ds_validate_check_result_before_insert()'::regprocedure)
  INTO function_definition;

  updated_definition := replace(
    function_definition,
    $old$      ELSE 'Comprobación ' || NEW.control_id || ': ' || NEW.status || '.'
    END;$old$,
    $new$      WHEN NEW.control_id = 'DS-TLS-02' THEN CASE
        WHEN NEW.evidence_json ? 'tls10ProbeError'
          OR NEW.evidence_json ? 'tls11ProbeError'
          OR NEW.evidence_json ? 'tls12ProbeError'
          OR NEW.evidence_json ? 'tls13ProbeError' THEN
          'No se pudieron completar todas las pruebas de TLS. '
          || CASE WHEN NEW.evidence_json->>'tls10ProbeError' IS NOT NULL
            THEN 'TLS 1.0: ' || CASE NEW.evidence_json->>'tls10ProbeError'
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
            END || '. ' ELSE '' END
          || CASE WHEN NEW.evidence_json->>'tls11ProbeError' IS NOT NULL
            THEN 'TLS 1.1: ' || CASE NEW.evidence_json->>'tls11ProbeError'
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
            END || '. ' ELSE '' END
          || CASE WHEN NEW.evidence_json->>'tls12ProbeError' IS NOT NULL
            THEN 'TLS 1.2: ' || CASE NEW.evidence_json->>'tls12ProbeError'
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
            END || '. ' ELSE '' END
          || CASE WHEN NEW.evidence_json->>'tls13ProbeError' IS NOT NULL
            THEN 'TLS 1.3: ' || CASE NEW.evidence_json->>'tls13ProbeError'
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
            END || '.' ELSE '' END
        WHEN NOT (
          NEW.evidence_json ? 'tls10Accepted'
          AND NEW.evidence_json ? 'tls11Accepted'
          AND NEW.evidence_json ? 'tls12Accepted'
          AND NEW.evidence_json ? 'tls13Accepted'
        ) THEN 'No se pudieron determinar todas las versiones de TLS; faltan resultados de una o más pruebas.'
        ELSE 'Comprobación ' || NEW.control_id || ': ' || NEW.status || '.'
      END
      ELSE 'Comprobación ' || NEW.control_id || ': ' || NEW.status || '.'
    END;$new$
  );

  -- Diagnostic branches append separators between version details. Trim the
  -- final separator before the database compares the worker supplied text.
  updated_definition := replace(
    updated_definition,
    $old$    OR NEW.summary <> expected_summary$old$,
    $new$    OR NEW.summary <> rtrim(expected_summary)$new$
  );

  IF updated_definition = function_definition
    OR position('tls10ProbeError' IN updated_definition) = 0
    OR position('No se pudieron completar todas las pruebas de TLS.' IN updated_definition) = 0
    OR position('rtrim(expected_summary)' IN updated_definition) = 0 THEN
    RAISE EXCEPTION 'tls_probe_summary_contract_extension_failed';
  END IF;
  EXECUTE updated_definition;
END;
$$;
