-- Extend the persisted check validator for exact URL reports and their
-- complete mobile/desktop performance evidence.
DO $$
DECLARE
  function_definition text;
  updated_definition text;
  view_definition text;
  updated_view_definition text;
BEGIN
  SELECT pg_get_functiondef('public.ds_validate_check_result_before_insert()'::regprocedure)
  INTO function_definition;

  -- Migration 063 searched for a v4 list without accounting for duplicate
  -- v4 entries introduced by prior migrations. Replace each duplicate run
  -- with the intended v4/v5 pair, wherever it occurs in a profile allowlist.
  updated_definition := regexp_replace(
    function_definition,
    $pattern$'domain-v4'(, 'domain-v4')+$pattern$,
    $replacement$'domain-v4', 'domain-v5'$replacement$,
    'g'
  );

  -- The v5 profile requires the full measured metric set. Preserve older
  -- response-time evidence while validating the additional bounded values.
  updated_definition := replace(
    updated_definition,
    $old$IF NEW.target_path <> '/' THEN$old$,
    $new$IF (run_profile_version = 'domain-v5' AND NOT run_scope @> jsonb_build_array(NEW.target_path))
      OR (run_profile_version <> 'domain-v5' AND NEW.target_path <> '/') THEN$new$
  );

  updated_definition := replace(
    updated_definition,
    $old$(rule.target_kind = 'host' AND NEW.target_path = '/')$old$,
    $new$(rule.target_kind = 'host' AND (
          NEW.target_path = '/'
          OR (run_profile_version = 'domain-v5'
            AND run_scope @> jsonb_build_array(NEW.target_path))
        ))$new$
  );

  updated_definition := replace(
    updated_definition,
    $old$        WHEN 'responseBytes' THEN 'count'$old$,
    $new$        WHEN 'responseBytes' THEN 'count'
        WHEN 'mobileFcpMs' THEN 'performance_ms'
        WHEN 'mobileLcpMs' THEN 'performance_ms'
        WHEN 'mobileClsMilli' THEN 'performance_cls_milli'
        WHEN 'mobileTbtMs' THEN 'performance_ms'
        WHEN 'mobileTtfbMs' THEN 'performance_ms'
        WHEN 'mobileTransferBytes' THEN 'performance_bytes'
        WHEN 'mobileScore' THEN 'performance_score'
        WHEN 'desktopFcpMs' THEN 'performance_ms'
        WHEN 'desktopLcpMs' THEN 'performance_ms'
        WHEN 'desktopClsMilli' THEN 'performance_cls_milli'
        WHEN 'desktopTbtMs' THEN 'performance_ms'
        WHEN 'desktopTtfbMs' THEN 'performance_ms'
        WHEN 'desktopTransferBytes' THEN 'performance_bytes'
        WHEN 'desktopScore' THEN 'performance_score'$new$
  );

  updated_definition := replace(
    updated_definition,
    $old$    ELSIF evidence_rule LIKE 'enum:%'$old$,
    $new$    ELSIF evidence_rule IN (
      'performance_ms', 'performance_bytes', 'performance_cls_milli', 'performance_score'
    ) AND (
      jsonb_typeof(evidence_value) <> 'number'
      OR evidence_value #>> '{}' !~ '^(0|[1-9][0-9]*)$'
      OR (evidence_value #>> '{}')::numeric > CASE evidence_rule
        WHEN 'performance_bytes' THEN 67108864
        WHEN 'performance_cls_milli' THEN 100000
        WHEN 'performance_score' THEN 100
        ELSE 9007199254740991
      END
    ) THEN
      RAISE EXCEPTION 'scan_evidence_invalid';
    ELSIF evidence_rule LIKE 'enum:%'$new$
  );

  updated_definition := replace(
    updated_definition,
    $old$      WHEN 'DS-QUAL-02' THEN
      NEW.evidence_json->>'inspected' = 'true'
      AND NEW.evidence_json->>'responseTimeMs' ~ '^[0-9]+$'
      AND (NEW.evidence_json->>'responseTimeMs')::integer <= 2500
      AND NEW.evidence_json ? 'responseBytes'$old$,
    $new$      WHEN 'DS-QUAL-02' THEN CASE
        WHEN run_profile_version = 'domain-v5' THEN
          NEW.evidence_json ? 'mobileFcpMs'
          AND NEW.evidence_json ? 'mobileLcpMs'
          AND NEW.evidence_json ? 'mobileClsMilli'
          AND NEW.evidence_json ? 'mobileTbtMs'
          AND NEW.evidence_json ? 'mobileTtfbMs'
          AND NEW.evidence_json ? 'mobileTransferBytes'
          AND NEW.evidence_json ? 'mobileScore'
          AND NEW.evidence_json ? 'desktopFcpMs'
          AND NEW.evidence_json ? 'desktopLcpMs'
          AND NEW.evidence_json ? 'desktopClsMilli'
          AND NEW.evidence_json ? 'desktopTbtMs'
          AND NEW.evidence_json ? 'desktopTtfbMs'
          AND NEW.evidence_json ? 'desktopTransferBytes'
          AND NEW.evidence_json ? 'desktopScore'
        ELSE NEW.evidence_json->>'inspected' = 'true'
          AND NEW.evidence_json->>'responseTimeMs' ~ '^[0-9]+$'
          AND (NEW.evidence_json->>'responseTimeMs')::integer <= 2500
          AND NEW.evidence_json ? 'responseBytes'
      END$new$
  );

  IF updated_definition = function_definition
    OR position($check$'domain-v4', 'domain-v5'$check$ IN updated_definition) = 0
    OR position('mobileFcpMs' IN updated_definition) = 0
    OR position('desktopScore' IN updated_definition) = 0
    OR position('performance_cls_milli' IN updated_definition) = 0
    OR position('run_profile_version = ''domain-v5''' IN updated_definition) = 0
    OR position('run_profile_version = ''domain-v5'' AND NOT run_scope @> jsonb_build_array(NEW.target_path)' IN updated_definition) = 0
    OR position($host$OR (run_profile_version = 'domain-v5'$host$ IN updated_definition) = 0
    OR position($duplicate$'domain-v4', 'domain-v4'$duplicate$ IN updated_definition) > 0 THEN
    RAISE EXCEPTION 'domain_v5_persistence_validator_extension_failed';
  END IF;

  EXECUTE updated_definition;

  SELECT pg_get_viewdef('public.ds_public_check_results'::regclass, true)
  INTO view_definition;
  updated_view_definition := regexp_replace(
    view_definition,
    $pattern$WHEN 'DS-QUAL-02'(::text)? THEN ARRAY\[[^]]*\]$pattern$,
    $replacement$WHEN 'DS-QUAL-02' THEN ARRAY[
        'inspected', 'responseTimeMs', 'responseBytes', 'probeErrorCode',
        'mobileFcpMs', 'mobileLcpMs', 'mobileClsMilli', 'mobileTbtMs', 'mobileTtfbMs',
        'mobileTransferBytes', 'mobileScore', 'desktopFcpMs', 'desktopLcpMs',
        'desktopClsMilli', 'desktopTbtMs', 'desktopTtfbMs', 'desktopTransferBytes',
        'desktopScore'
      ]$replacement$,
    'g'
  );
  IF updated_view_definition = view_definition
    OR position('mobileFcpMs' IN updated_view_definition) = 0
    OR position('desktopScore' IN updated_view_definition) = 0 THEN
    RAISE EXCEPTION 'domain_v5_public_evidence_projection_extension_failed';
  END IF;
  EXECUTE 'CREATE OR REPLACE VIEW public.ds_public_check_results AS ' || updated_view_definition;
END;
$$;
