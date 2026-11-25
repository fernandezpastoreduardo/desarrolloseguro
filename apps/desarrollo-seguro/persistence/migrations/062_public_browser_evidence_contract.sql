-- Preserve bounded browser evidence from the isolated audit through the
-- PostgreSQL trust boundary and the public read view.
DO $$
DECLARE
  function_definition text;
  updated_definition text;
BEGIN
  SELECT pg_get_functiondef('public.ds_validate_check_result_before_insert()'::regprocedure)
  INTO function_definition;
  updated_definition := function_definition;

  updated_definition := replace(
    updated_definition,
    $old$  expected_summary := CASE$old$,
    $new$  IF run_profile_version = 'domain-v4'
    AND NEW.evidence_json->>'browserObservationComplete' = 'true'
    AND ((NEW.control_id = 'DS-PRIV-05' AND NOT (
      NEW.evidence_json ? 'browserCookieCount'
      AND NEW.evidence_json ? 'browserCatalogMatchCount'
      AND NEW.evidence_json ? 'browserInsecureCookieCount'
    )) OR (NEW.control_id = 'DS-PRIV-06' AND NOT (
      NEW.evidence_json ? 'browserThirdPartyRequestCount'
      AND NEW.evidence_json ? 'browserKnownTrackingRequestCount'
      AND NEW.evidence_json ? 'browserBlockedTrackingRequestCount'
      AND NEW.evidence_json ? 'browserTrackingResponseCount'
    ))) THEN
    RAISE EXCEPTION 'scan_evidence_invalid';
  END IF;
  expected_summary := CASE$new$
  );

  updated_definition := replace(
    updated_definition,
    $old$WHEN NEW.control_id = 'DS-PRIV-05' THEN CASE$old$,
    $new$WHEN NEW.control_id = 'DS-PRIV-05' THEN CASE
        WHEN run_profile_version = 'domain-v4'
          AND NEW.evidence_json->>'browserObservationComplete' = 'true' THEN
          'Antes de elegir, Chromium observó '
          || (NEW.evidence_json->>'browserCookieCount')
          || ' cookie' || CASE WHEN NEW.evidence_json->>'browserCookieCount' = '1' THEN '' ELSE 's' END
          || '; ' || (NEW.evidence_json->>'browserCatalogMatchCount')
          || CASE WHEN NEW.evidence_json->>'browserCatalogMatchCount' = '1' THEN ' coincidía' ELSE ' coincidían' END
          || ' con cookies conocidas del catálogo y '
          || (NEW.evidence_json->>'browserInsecureCookieCount')
          || ' carecían del atributo Secure.'$new$
  );

  updated_definition := replace(
    updated_definition,
    $old$WHEN NEW.control_id = 'DS-TLS-02' THEN CASE$old$,
    $new$WHEN run_profile_version = 'domain-v4'
        AND NEW.control_id = 'DS-PRIV-06'
        AND NEW.evidence_json->>'browserObservationComplete' = 'true' THEN
        'Antes de elegir, Chromium inició '
        || (NEW.evidence_json->>'browserThirdPartyRequestCount')
        || ' solicitud' || CASE WHEN NEW.evidence_json->>'browserThirdPartyRequestCount' = '1' THEN '' ELSE 'es' END
        || ' a terceros, incluidas '
        || (NEW.evidence_json->>'browserKnownTrackingRequestCount')
        || ' a rastreadores conocidos; se bloquearon '
        || (NEW.evidence_json->>'browserBlockedTrackingRequestCount')
        || ' intento' || CASE WHEN NEW.evidence_json->>'browserBlockedTrackingRequestCount' = '1' THEN '' ELSE 's' END
        || ' y ' || (NEW.evidence_json->>'browserTrackingResponseCount')
        || ' solicitud' || CASE WHEN NEW.evidence_json->>'browserTrackingResponseCount' = '1' THEN '' ELSE 'es' END
        || ' recibieron respuesta.'
      WHEN NEW.control_id = 'DS-TLS-02' THEN CASE$new$
  );

  updated_definition := replace(
    updated_definition,
    $old$        WHEN 'consentPromptDetected' THEN 'boolean'
        WHEN 'probeErrorCode' THEN$old$,
    $new$        WHEN 'consentPromptDetected' THEN 'boolean'
        WHEN 'browserObservationComplete' THEN 'boolean'
        WHEN 'browserCookieCount' THEN 'count'
        WHEN 'browserInsecureCookieCount' THEN 'count'
        WHEN 'browserCatalogMatchCount' THEN 'count'
        WHEN 'probeErrorCode' THEN$new$
  );
  updated_definition := replace(
    updated_definition,
    $old$        WHEN 'knownTrackingResourceReferences' THEN 'count'
        WHEN 'probeErrorCode' THEN$old$,
    $new$        WHEN 'knownTrackingResourceReferences' THEN 'count'
        WHEN 'browserObservationComplete' THEN 'boolean'
        WHEN 'browserThirdPartyRequestCount' THEN 'count'
        WHEN 'browserKnownTrackingRequestCount' THEN 'count'
        WHEN 'browserBlockedTrackingRequestCount' THEN 'count'
        WHEN 'browserTrackingResponseCount' THEN 'count'
        WHEN 'probeErrorCode' THEN$new$
  );

  updated_definition := replace(
    updated_definition,
    $old$    WHEN 'DS-PRIV-05' THEN
      NEW.evidence_json->>'inspected' = 'true'
      AND NEW.evidence_json ? 'catalogMatchCount'
      AND NEW.evidence_json->>'catalogMatchCount' = '0'$old$,
    $new$    WHEN 'DS-PRIV-05' THEN
      NEW.evidence_json->>'inspected' = 'true'
      AND ((NEW.evidence_json ? 'catalogMatchCount' AND NEW.evidence_json->>'catalogMatchCount' = '0')
        OR (run_profile_version = 'domain-v4'
          AND NEW.evidence_json->>'browserObservationComplete' = 'true'
          AND NEW.evidence_json->>'browserCatalogMatchCount' = '0'))$new$
  );
  updated_definition := replace(
    updated_definition,
    $old$    WHEN 'DS-PRIV-06' THEN
      NEW.evidence_json->>'inspected' = 'true'
      AND NEW.evidence_json ? 'knownTrackingResourceReferences'
      AND NEW.evidence_json->>'knownTrackingResourceReferences' = '0'$old$,
    $new$    WHEN 'DS-PRIV-06' THEN
      NEW.evidence_json->>'inspected' = 'true'
      AND ((NEW.evidence_json ? 'knownTrackingResourceReferences'
          AND NEW.evidence_json->>'knownTrackingResourceReferences' = '0')
        OR (run_profile_version = 'domain-v4'
          AND NEW.evidence_json->>'browserObservationComplete' = 'true'
          AND NEW.evidence_json->>'browserKnownTrackingRequestCount' = '0'))$new$
  );

  updated_definition := replace(
    updated_definition,
    $old$  IF NEW.limitation <> (
    'Resultado limitado a las rutas públicas declaradas del perfil '
    || run_profile_version || '.'
  ) THEN
    RAISE EXCEPTION 'scan_check_limitation_not_allowlisted';
  END IF;$old$,
    $new$  IF NOT (
    (run_profile_version = 'domain-v4' AND NEW.control_id = 'DS-PRIV-05'
      AND NEW.evidence_json->>'browserObservationComplete' = 'true'
      AND NEW.limitation = 'Cookies observadas por Chromium antes de elegir. La atribución a un servicio requiere coincidencia con el catálogo local y una solicitud del mismo flujo.')
    OR (run_profile_version = 'domain-v4' AND NEW.control_id = 'DS-PRIV-06'
      AND NEW.evidence_json->>'browserObservationComplete' = 'true'
      AND NEW.limitation = 'Una solicitud iniciada demuestra un intento; las bloqueadas por el auditor no demuestran transmisión de datos. El conteo de respuestas indica solicitudes que sí recibieron respuesta.')
    OR (NOT (run_profile_version = 'domain-v4' AND NEW.control_id IN ('DS-PRIV-05', 'DS-PRIV-06')
      AND NEW.evidence_json->>'browserObservationComplete' = 'true')
      AND NEW.limitation = 'Resultado limitado a las rutas públicas declaradas del perfil ' || run_profile_version || '.')
  ) THEN
    RAISE EXCEPTION 'scan_check_limitation_not_allowlisted';
  END IF;$new$
  );

  IF updated_definition = function_definition OR
     position('scan_evidence_invalid' IN updated_definition) = 0 OR
     position('browserCookieCount' IN updated_definition) = 0 OR
     position('browserKnownTrackingRequestCount' IN updated_definition) = 0 OR
     position('browserObservationComplete' IN updated_definition) = 0 OR
     position('Chromium observó ' IN updated_definition) = 0 OR
     position('no demuestran transmisión de datos' IN updated_definition) = 0 THEN
    RAISE EXCEPTION 'public_browser_check_contract_extension_failed';
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
      WHEN 'DS-HDR-01' THEN ARRAY[
        'finalScheme', 'hsts', 'nosniff', 'frameProtection', 'referrerPolicy', 'csp', 'probeErrorCode'
      ]
      WHEN 'DS-PRIV-04' THEN ARRAY[
        'inspected', 'privacyPolicyLinksFound', 'policyLinksFound', 'sitePrivacyPolicyFetched',
        'policyPagesFetched', 'policyPagesMissing', 'policyPagesDenied',
        'policyRecipientsMentioned', 'policyPurposesMentioned', 'policyTextBlocked',
        'policyProbeFailed', 'policyLanguageCatalogVersion', 'probeErrorCode'
      ]
      WHEN 'DS-PRIV-05' THEN ARRAY[
        'inspected', 'cookieCount', 'insecureCookieCount', 'catalogMatchCount',
        'consentPromptDetected', 'browserObservationComplete', 'browserCookieCount',
        'browserInsecureCookieCount', 'browserCatalogMatchCount', 'probeErrorCode'
      ]
      WHEN 'DS-PRIV-06' THEN ARRAY[
        'inspected', 'thirdPartyResourceReferences', 'knownTrackingResourceReferences',
        'browserObservationComplete', 'browserThirdPartyRequestCount',
        'browserKnownTrackingRequestCount', 'browserBlockedTrackingRequestCount',
        'browserTrackingResponseCount', 'probeErrorCode'
      ]
      WHEN 'DS-QUAL-02' THEN ARRAY['inspected', 'responseTimeMs', 'responseBytes', 'probeErrorCode']
      ELSE ARRAY[]::text[]
    END)
  ), '{}'::jsonb) AS evidence_json
FROM public.ds_check_results AS checks;
