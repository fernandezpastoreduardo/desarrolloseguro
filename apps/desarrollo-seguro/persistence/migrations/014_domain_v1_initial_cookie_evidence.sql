-- Versioned root-page profile. transport-v1 remains unchanged and historical.
INSERT INTO public.ds_profile_controls(profile_version, control_id, required)
VALUES
  ('domain-v1', 'DS-DNS-01', true),
  ('domain-v1', 'DS-TLS-01', true),
  ('domain-v1', 'DS-HTTP-01', true),
  ('domain-v1', 'DS-HDR-01', true),
  ('domain-v1', 'DS-PRIV-05', true)
ON CONFLICT(profile_version, control_id) DO NOTHING;

INSERT INTO public.ds_profile_check_rules(
  profile_version, control_id, target_kind, method
)
VALUES
  ('domain-v1', 'DS-DNS-01', 'host', 'DNS'),
  ('domain-v1', 'DS-TLS-01', 'host', 'TLS'),
  ('domain-v1', 'DS-HTTP-01', 'route', 'HEAD'),
  ('domain-v1', 'DS-HTTP-01', 'route', 'GET'),
  ('domain-v1', 'DS-HDR-01', 'route', 'GET'),
  ('domain-v1', 'DS-PRIV-05', 'route', 'GET')
ON CONFLICT(profile_version, control_id, target_kind, method) DO NOTHING;

-- Existing on-demand domains must move to the same profile as new requests;
-- scheduled domains and their profile histories remain untouched.
UPDATE public.ds_domains
SET profile_version = 'domain-v1'
WHERE enrollment = 'on_demand'
  AND profile_version = 'transport-v1';

-- Extend the immutable validators with a new profile, never by changing the
-- meaning of transport-v1. The existing contract remains the source of truth.
DO $$
DECLARE
  function_definition text;
  updated_definition text;
BEGIN
  SELECT pg_get_functiondef(
    'public.ds_validate_scan_scope_before_insert()'::regprocedure
  ) INTO function_definition;
  updated_definition := replace(
    function_definition,
    $old$NEW.profile_version = 'transport-v1'$old$,
    $new$NEW.profile_version IN ('transport-v1', 'domain-v1')$new$
  );
  updated_definition := replace(
    updated_definition,
    $old$, 'transport-v1'$old$,
    $new$, 'domain-v1', 'transport-v1'$new$
  );
  IF updated_definition = function_definition
    OR position('domain-v1' IN updated_definition) = 0 THEN
    RAISE EXCEPTION 'domain_v1_scope_validator_extension_failed';
  END IF;
  EXECUTE updated_definition;

  SELECT pg_get_functiondef(
    'public.ds_validate_check_result_before_insert()'::regprocedure
  ) INTO function_definition;
  updated_definition := replace(
    function_definition,
    $old$, 'transport-v1'$old$,
    $new$, 'domain-v1', 'transport-v1'$new$
  );
  updated_definition := replace(
    updated_definition,
    $old$  pass_supported boolean := false;$old$,
    $new$  pass_supported boolean := false;
  expected_summary text;$new$
  );
  updated_definition := replace(
    updated_definition,
    $old$OR NEW.summary <> 'Comprobación ' || NEW.control_id || ': ' || NEW.status || '.'$old$,
    $new$OR NEW.summary <> expected_summary$new$
  );
  updated_definition := replace(
    updated_definition,
    $old$  IF NEW.required IS DISTINCT FROM true$old$,
    $new$  expected_summary := CASE
      WHEN NEW.control_id = 'DS-PRIV-05' THEN CASE
        WHEN NEW.evidence_json->>'inspected' = 'true'
          AND NEW.evidence_json ? 'cookieCount'
          AND NEW.evidence_json ? 'insecureCookieCount'
          AND NEW.evidence_json ? 'catalogMatchCount'
          AND NEW.evidence_json ? 'consentPromptDetected' THEN
          'Cookies en respuesta inicial: '
          || COALESCE(NEW.evidence_json->>'cookieCount', '0') || '; '
          || 'coincidencias con la tabla local Analytics/Marketing: '
          || COALESCE(NEW.evidence_json->>'catalogMatchCount', '0')
          || '; sin atributo Secure: '
          || COALESCE(NEW.evidence_json->>'insecureCookieCount', '0')
          || '. No se interactuó con el banner de consentimiento.'
        ELSE
          'No se pudo inspeccionar la respuesta inicial para detectar cookies conocidas; criterio no evaluado.'
        END
      ELSE 'Comprobación ' || NEW.control_id || ': ' || NEW.status || '.'
    END;
  IF NEW.required IS DISTINCT FROM true$new$
  );
  updated_definition := replace(
    updated_definition,
    $old$    WHEN 'DS-PRIV-03' THEN ARRAY['GET']$old$,
    $new$    WHEN 'DS-PRIV-05' THEN ARRAY['GET']
    WHEN 'DS-PRIV-03' THEN ARRAY['GET']$new$
  );
  updated_definition := replace(
    updated_definition,
    $old$      WHEN 'DS-PRIV-03' THEN CASE evidence_key$old$,
    $new$      WHEN 'DS-PRIV-05' THEN CASE evidence_key
        WHEN 'inspected' THEN 'boolean'
        WHEN 'cookieCount' THEN 'count'
        WHEN 'insecureCookieCount' THEN 'count'
        WHEN 'catalogMatchCount' THEN 'count'
        WHEN 'consentPromptDetected' THEN 'boolean'
        ELSE NULL END
      WHEN 'DS-PRIV-03' THEN CASE evidence_key$new$
  );
  updated_definition := replace(
    updated_definition,
    $old$    WHEN 'DS-PRIV-03' THEN
      NEW.evidence_json->>'mixedContentCount' = '0'$old$,
    $new$    WHEN 'DS-PRIV-05' THEN
      NEW.evidence_json->>'inspected' = 'true'
      AND NEW.evidence_json ? 'catalogMatchCount'
      AND NEW.evidence_json->>'catalogMatchCount' = '0'
    WHEN 'DS-PRIV-03' THEN
      NEW.evidence_json->>'mixedContentCount' = '0'$new$
  );
  IF position('DS-PRIV-05' IN updated_definition) = 0
    OR position('domain-v1' IN updated_definition) = 0
    OR position('Cookies en respuesta inicial:' IN updated_definition) = 0 THEN
    RAISE EXCEPTION 'domain_v1_check_validator_extension_failed';
  END IF;
  EXECUTE updated_definition;

  SELECT pg_get_functiondef(
    'public.ds_validate_profile_check_coverage()'::regprocedure
  ) INTO function_definition;
  updated_definition := replace(
    function_definition,
    $old$, 'transport-v1'$old$,
    $new$, 'domain-v1', 'transport-v1'$new$
  );
  IF updated_definition = function_definition THEN
    RAISE EXCEPTION 'domain_v1_coverage_validator_extension_failed';
  END IF;
  EXECUTE updated_definition;

  SELECT pg_get_functiondef(
    'public.ds_request_on_demand_scan(text)'::regprocedure
  ) INTO function_definition;
  updated_definition := replace(
    function_definition,
    $old$VALUES (p_hostname, 'on_demand', 'transport-v1')$old$,
    $new$VALUES (p_hostname, 'on_demand', 'domain-v1')$new$
  );
  IF updated_definition = function_definition THEN
    RAISE EXCEPTION 'domain_v1_admission_profile_extension_failed';
  END IF;
  EXECUTE updated_definition;
END;
$$;
