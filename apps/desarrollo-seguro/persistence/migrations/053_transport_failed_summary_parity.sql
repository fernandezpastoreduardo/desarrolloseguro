-- Keep PostgreSQL summaries aligned with the public TypeScript sanitizer for
-- the already-allowlisted transport_failed probe code.
DO $$
DECLARE
  function_definition text;
  updated_definition text;
  expected_mapping_count integer;
  actual_mapping_count integer;
BEGIN
  SELECT pg_get_functiondef('public.ds_validate_check_result_before_insert()'::regprocedure)
  INTO function_definition;

  updated_definition := replace(
    function_definition,
    $old$ELSE 'la prueba no pudo completarse'$old$,
    $new$WHEN 'transport_failed' THEN 'se produjo un error de transporte'
            ELSE 'la prueba no pudo completarse'$new$
  );

  SELECT count(*) INTO expected_mapping_count
  FROM regexp_matches(function_definition, 'ELSE ''la prueba no pudo completarse''', 'g');
  SELECT count(*) INTO actual_mapping_count
  FROM regexp_matches(updated_definition, 'WHEN ''transport_failed'' THEN ''se produjo un error de transporte''', 'g');

  IF updated_definition = function_definition OR
     expected_mapping_count < 2 OR
     actual_mapping_count <> expected_mapping_count THEN
    RAISE EXCEPTION 'transport_failed_summary_extension_failed';
  END IF;

  EXECUTE updated_definition;
END;
$$;
