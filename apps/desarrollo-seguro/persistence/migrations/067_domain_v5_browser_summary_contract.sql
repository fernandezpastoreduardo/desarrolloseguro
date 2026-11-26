-- Keep PostgreSQL's privacy-summary allowlist in sync with the shared
-- sanitizer when Chromium evidence is attached to domain-v5 checks.
DO $$
DECLARE
  function_definition text;
  updated_definition text;
BEGIN
  SELECT pg_get_functiondef('public.ds_validate_check_result_before_insert()'::regprocedure)
  INTO function_definition;

  updated_definition := replace(
    function_definition,
    $old$WHEN run_profile_version = 'domain-v4'
          AND NEW.evidence_json->>'browserObservationComplete' = 'true' THEN$old$,
    $new$WHEN run_profile_version IN ('domain-v4', 'domain-v5')
          AND NEW.evidence_json->>'browserObservationComplete' = 'true' THEN$new$
  );

  updated_definition := replace(
    updated_definition,
    $old$WHEN run_profile_version = 'domain-v4'
        AND NEW.control_id = 'DS-PRIV-06'
        AND NEW.evidence_json->>'browserObservationComplete' = 'true' THEN$old$,
    $new$WHEN run_profile_version IN ('domain-v4', 'domain-v5')
        AND NEW.control_id = 'DS-PRIV-06'
        AND NEW.evidence_json->>'browserObservationComplete' = 'true' THEN$new$
  );

  IF updated_definition = function_definition
    OR position($v5_cookie$WHEN run_profile_version IN ('domain-v4', 'domain-v5')
          AND NEW.evidence_json->>'browserObservationComplete' = 'true' THEN$v5_cookie$ IN updated_definition) = 0
    OR position($v5_tracking$WHEN run_profile_version IN ('domain-v4', 'domain-v5')
        AND NEW.control_id = 'DS-PRIV-06'
        AND NEW.evidence_json->>'browserObservationComplete' = 'true' THEN$v5_tracking$ IN updated_definition) = 0 THEN
    RAISE EXCEPTION 'domain_v5_browser_summary_contract_extension_failed';
  END IF;

  EXECUTE updated_definition;
END;
$$;
