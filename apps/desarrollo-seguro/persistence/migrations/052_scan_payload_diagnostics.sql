-- Separate the bounded reasons a check row fails its SQL payload contract.
-- These codes let worker telemetry diagnose contract drift without logging
-- any evidence values or site content.
DO $$
DECLARE
  function_definition text;
  updated_definition text;
BEGIN
  SELECT pg_get_functiondef('public.ds_validate_check_result_before_insert()'::regprocedure)
  INTO function_definition;

  updated_definition := replace(
    function_definition,
    $old$  IF NEW.required IS DISTINCT FROM true
    OR NEW.severity NOT IN ('critical', 'high', 'medium', 'low', 'info')
    OR NEW.summary <> rtrim(expected_summary)
    OR NEW.limitation <> (
      'Resultado limitado a las rutas públicas declaradas del perfil '
      || run_profile_version || '.'
    )
    OR jsonb_typeof(NEW.evidence_json) <> 'object'
    OR pg_column_size(NEW.evidence_json) > 8192 THEN
    RAISE EXCEPTION 'scan_check_payload_not_allowlisted';
  END IF;$old$,
    $new$  IF NEW.required IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'scan_check_required_invalid';
  END IF;
  IF NEW.severity NOT IN ('critical', 'high', 'medium', 'low', 'info') THEN
    RAISE EXCEPTION 'scan_check_severity_not_allowlisted';
  END IF;
  IF NEW.summary <> rtrim(expected_summary) THEN
    RAISE EXCEPTION 'scan_check_summary_not_allowlisted';
  END IF;
  IF NEW.limitation <> (
    'Resultado limitado a las rutas públicas declaradas del perfil '
    || run_profile_version || '.'
  ) THEN
    RAISE EXCEPTION 'scan_check_limitation_not_allowlisted';
  END IF;
  IF jsonb_typeof(NEW.evidence_json) <> 'object' THEN
    RAISE EXCEPTION 'scan_check_evidence_payload_not_allowlisted';
  END IF;
  IF pg_column_size(NEW.evidence_json) > 8192 THEN
    RAISE EXCEPTION 'scan_check_evidence_size_exceeded';
  END IF;$new$
  );

  IF updated_definition = function_definition OR
     position('scan_check_required_invalid' IN updated_definition) = 0 OR
     position('scan_check_severity_not_allowlisted' IN updated_definition) = 0 OR
     position('scan_check_summary_not_allowlisted' IN updated_definition) = 0 OR
     position('scan_check_limitation_not_allowlisted' IN updated_definition) = 0 OR
     position('scan_check_evidence_payload_not_allowlisted' IN updated_definition) = 0 OR
     position('scan_check_evidence_size_exceeded' IN updated_definition) = 0 THEN
    RAISE EXCEPTION 'scan_payload_diagnostic_extension_failed';
  END IF;

  EXECUTE updated_definition;
END;
$$;
