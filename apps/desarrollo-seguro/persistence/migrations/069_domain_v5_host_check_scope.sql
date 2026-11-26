-- DNS and TLS checks are host-scoped for legacy profiles. For domain-v5,
-- they follow the one exact target path included in the report scope.
DO $$
DECLARE
  function_definition text;
  view_definition text;
  old_guard_pattern text := $pattern$IF\s+NEW\.target_path\s*<>\s*'/'\s*THEN$pattern$;
  new_guard text := $new$IF (run_profile_version = 'domain-v5'
      AND NOT run_scope @> jsonb_build_array(NEW.target_path))
      OR (run_profile_version <> 'domain-v5' AND NEW.target_path <> '/') THEN$new$;
  old_host_rule_pattern text := $pattern$\(rule\.target_kind\s*=\s*'host'\s+AND\s+NEW\.target_path\s*=\s*'/'\)$pattern$;
  new_host_rule text := $new$(rule.target_kind = 'host' AND (
          NEW.target_path = '/'
          OR (run_profile_version = 'domain-v5'
            AND run_scope @> jsonb_build_array(NEW.target_path))
        ))$new$;
BEGIN
  SELECT pg_get_functiondef('public.ds_validate_check_result_before_insert()'::regprocedure)
  INTO function_definition;

  IF function_definition IS NULL THEN
    RAISE EXCEPTION 'domain_v5_host_scope_guard_source_unexpected';
  END IF;
  function_definition := regexp_replace(function_definition, old_guard_pattern, new_guard, 'g');
  IF position('run_profile_version = ''domain-v5''' IN function_definition) = 0
    OR position('NOT run_scope @> jsonb_build_array(NEW.target_path)' IN function_definition) = 0
    OR regexp_like(function_definition, old_guard_pattern)
  THEN
    RAISE EXCEPTION 'domain_v5_host_scope_guard_update_failed';
  END IF;

  function_definition := regexp_replace(function_definition, old_host_rule_pattern, new_host_rule, 'g');
  IF position('rule.target_kind = ''host''' IN function_definition) = 0
    OR position('AND run_scope @> jsonb_build_array(NEW.target_path)' IN function_definition) = 0
    OR regexp_like(function_definition, old_host_rule_pattern)
  THEN
    RAISE EXCEPTION 'domain_v5_host_rule_update_failed';
  END IF;

  EXECUTE function_definition;

  SELECT pg_get_viewdef('public.ds_public_check_results'::regclass, true)
  INTO view_definition;
  view_definition := regexp_replace(
    view_definition,
    $pattern$WHEN 'DS-QUAL-02'(::text)? THEN ARRAY\[[^]]*\]$pattern$,
    $replacement$WHEN 'DS-QUAL-02' THEN ARRAY[
        'inspected', 'responseTimeMs', 'responseBytes', 'probeErrorCode',
        'mobileFcpMs', 'mobileLcpMs', 'mobileClsMilli', 'mobileTbtMs', 'mobileTtfbMs',
        'mobileTransferBytes', 'mobileScore', 'desktopFcpMs', 'desktopLcpMs',
        'desktopClsMilli', 'desktopTbtMs', 'desktopTtfbMs', 'desktopTransferBytes', 'desktopScore'
      ]$replacement$,
    'g'
  );
  IF position('mobileFcpMs' IN view_definition) = 0
    OR position('desktopScore' IN view_definition) = 0 THEN
    RAISE EXCEPTION 'domain_v5_public_evidence_projection_source_unexpected';
  END IF;
  EXECUTE 'CREATE OR REPLACE VIEW public.ds_public_check_results AS ' || view_definition;
END;
$$;
