-- Persist the pinned mobile scoring model in each new report.
DO $$
DECLARE
  function_definition text;
  updated_definition text;
  view_definition text;
  updated_view_definition text;
BEGIN
  SELECT pg_get_functiondef('public.ds_validate_check_result_before_insert()'::regprocedure)
  INTO function_definition;

  updated_definition := replace(
    function_definition,
    $old$        WHEN 'mobileSpeedIndexMs' THEN 'performance_ms'$old$,
    $new$        WHEN 'mobileSpeedIndexMs' THEN 'performance_ms'
        WHEN 'mobileScoreModelVersion' THEN 'enum:lighthouse-13.6.0'$new$
  );
  updated_definition := replace(
    updated_definition,
    $old$          AND NEW.evidence_json ? 'mobileSpeedIndexMs'$old$,
    $new$          AND NEW.evidence_json ? 'mobileSpeedIndexMs'
          AND NEW.evidence_json ? 'mobileScoreModelVersion'$new$
  );

  IF updated_definition = function_definition
    OR position('mobileScoreModelVersion' IN updated_definition) = 0
    OR position('enum:lighthouse-13.6.0' IN updated_definition) = 0 THEN
    RAISE EXCEPTION 'domain_v5_mobile_score_version_validator_update_failed';
  END IF;
  EXECUTE updated_definition;

  SELECT pg_get_viewdef('public.ds_public_check_results'::regclass, true)
  INTO view_definition;
  updated_view_definition := replace(
    view_definition,
    $old$'mobileFcpMs', 'mobileSpeedIndexMs', 'mobileLcpMs'$old$,
    $new$'mobileFcpMs', 'mobileSpeedIndexMs', 'mobileScoreModelVersion', 'mobileLcpMs'$new$
  );
  IF updated_view_definition = view_definition
    OR position('mobileScoreModelVersion' IN updated_view_definition) = 0 THEN
    RAISE EXCEPTION 'domain_v5_mobile_score_version_projection_update_failed';
  END IF;
  EXECUTE 'CREATE OR REPLACE VIEW public.ds_public_check_results AS ' || updated_view_definition;
END;
$$;
