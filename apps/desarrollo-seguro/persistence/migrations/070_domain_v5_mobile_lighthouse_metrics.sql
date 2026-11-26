-- Persist the mobile Speed Index used by the Lighthouse 13.6.0 score.
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
    $old$        WHEN 'mobileFcpMs' THEN 'performance_ms'$old$,
    $new$        WHEN 'mobileFcpMs' THEN 'performance_ms'
        WHEN 'mobileSpeedIndexMs' THEN 'performance_ms'$new$
  );
  updated_definition := replace(
    updated_definition,
    $old$          NEW.evidence_json ? 'mobileFcpMs'$old$,
    $new$          NEW.evidence_json ? 'mobileFcpMs'
          AND NEW.evidence_json ? 'mobileSpeedIndexMs'$new$
  );

  IF updated_definition = function_definition
    OR position('mobileSpeedIndexMs' IN updated_definition) = 0 THEN
    RAISE EXCEPTION 'domain_v5_mobile_speed_index_validator_update_failed';
  END IF;
  EXECUTE updated_definition;

  SELECT pg_get_viewdef('public.ds_public_check_results'::regclass, true)
  INTO view_definition;
  updated_view_definition := replace(
    view_definition,
    $old$'mobileFcpMs', 'mobileLcpMs'$old$,
    $new$'mobileFcpMs', 'mobileSpeedIndexMs', 'mobileLcpMs'$new$
  );
  IF updated_view_definition = view_definition
    OR position('mobileSpeedIndexMs' IN updated_view_definition) = 0 THEN
    RAISE EXCEPTION 'domain_v5_mobile_speed_index_projection_update_failed';
  END IF;
  EXECUTE 'CREATE OR REPLACE VIEW public.ds_public_check_results AS ' || updated_view_definition;
END;
$$;
