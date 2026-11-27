-- Expose bounded, non-sensitive reasons when a v5 performance profile is incomplete.
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
    $old$        WHEN 'mobileScoreModelVersion' THEN 'enum:lighthouse-13.6.0'$old$,
    $new$        WHEN 'mobileScoreModelVersion' THEN 'enum:lighthouse-13.6.0'
        WHEN 'mobileDiagnosticCode' THEN 'enum:observation_budget_exhausted,observation_stopped_early,request_budget_exceeded,required_measurement_missing,browser_timeout,browser_observation_error'
        WHEN 'mobileMissingMetricsMask' THEN 'count'
        WHEN 'desktopDiagnosticCode' THEN 'enum:observation_budget_exhausted,observation_stopped_early,request_budget_exceeded,required_measurement_missing,browser_timeout,browser_observation_error'
        WHEN 'desktopMissingMetricsMask' THEN 'count'$new$
  );

  IF updated_definition = function_definition
    OR position('mobileDiagnosticCode' IN updated_definition) = 0
    OR position('desktopMissingMetricsMask' IN updated_definition) = 0 THEN
    RAISE EXCEPTION 'domain_v5_performance_diagnostics_validator_update_failed';
  END IF;
  EXECUTE updated_definition;

  SELECT pg_get_viewdef('public.ds_public_check_results'::regclass, true)
  INTO view_definition;
  updated_view_definition := regexp_replace(
    view_definition,
    $pattern$WHEN 'DS-QUAL-02'(::text)? THEN ARRAY\[[^]]*\]$pattern$,
    $replacement$WHEN 'DS-QUAL-02' THEN ARRAY[
        'inspected', 'responseTimeMs', 'responseBytes', 'probeErrorCode',
        'mobileFcpMs', 'mobileSpeedIndexMs', 'mobileScoreModelVersion', 'mobileLcpMs', 'mobileClsMilli', 'mobileTbtMs', 'mobileTtfbMs',
        'mobileTransferBytes', 'mobileScore', 'desktopFcpMs', 'desktopLcpMs',
        'desktopClsMilli', 'desktopTbtMs', 'desktopTtfbMs', 'desktopTransferBytes', 'desktopScore',
        'mobileDiagnosticCode', 'mobileMissingMetricsMask', 'desktopDiagnosticCode', 'desktopMissingMetricsMask'
      ]$replacement$,
    'g'
  );
  IF updated_view_definition = view_definition
    OR position('mobileDiagnosticCode' IN updated_view_definition) = 0
    OR position('desktopMissingMetricsMask' IN updated_view_definition) = 0 THEN
    RAISE EXCEPTION 'domain_v5_performance_diagnostics_projection_update_failed';
  END IF;
  EXECUTE 'CREATE OR REPLACE VIEW public.ds_public_check_results AS ' || updated_view_definition;
END;
$$;
