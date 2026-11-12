-- Add independent TLS version probes to a new immutable domain profile.
INSERT INTO public.ds_profile_controls(profile_version, control_id, required)
SELECT 'domain-v3', control_id, required
FROM public.ds_profile_controls
WHERE profile_version = 'domain-v2'
ON CONFLICT(profile_version, control_id) DO NOTHING;

INSERT INTO public.ds_profile_controls(profile_version, control_id, required)
VALUES ('domain-v3', 'DS-TLS-02', true)
ON CONFLICT(profile_version, control_id) DO NOTHING;

INSERT INTO public.ds_profile_check_rules(profile_version, control_id, target_kind, method)
SELECT 'domain-v3', control_id, target_kind, method
FROM public.ds_profile_check_rules
WHERE profile_version = 'domain-v2'
ON CONFLICT(profile_version, control_id, target_kind, method) DO NOTHING;

INSERT INTO public.ds_profile_check_rules(profile_version, control_id, target_kind, method)
VALUES ('domain-v3', 'DS-TLS-02', 'host', 'TLS')
ON CONFLICT(profile_version, control_id, target_kind, method) DO NOTHING;

UPDATE public.ds_domains SET profile_version = 'domain-v3'
WHERE profile_version = 'domain-v2';

DO $$
DECLARE
  function_definition text;
  updated_definition text;
BEGIN
  SELECT pg_get_functiondef('public.ds_validate_scan_scope_before_insert()'::regprocedure)
  INTO function_definition;
  updated_definition := regexp_replace(function_definition,
    $pattern$NEW[.]profile_version NOT IN[[:space:]]*[(][^)]*[)]$pattern$,
    $new$NEW.profile_version NOT IN ('controls-v1', 'controls-v2', 'controls-v3', 'domain-v1', 'domain-v2', 'domain-v3', 'transport-v1')$new$);
  updated_definition := replace(updated_definition,
    $old$NEW.profile_version IN ('transport-v1', 'domain-v1', 'domain-v2')$old$,
    $new$NEW.profile_version IN ('transport-v1', 'domain-v1', 'domain-v2', 'domain-v3')$new$);
  IF updated_definition = function_definition
    OR position($expected$NEW.profile_version IN ('transport-v1', 'domain-v1', 'domain-v2', 'domain-v3')$expected$ IN updated_definition) = 0 THEN
    RAISE EXCEPTION 'domain_v3_scope_validator_extension_failed';
  END IF;
  EXECUTE updated_definition;

  SELECT pg_get_functiondef('public.ds_validate_check_result_before_insert()'::regprocedure)
  INTO function_definition;
  updated_definition := replace(function_definition,
    $old$'domain-v1', 'domain-v2', 'transport-v1'$old$,
    $new$'domain-v1', 'domain-v2', 'domain-v3', 'transport-v1'$new$);
  updated_definition := replace(updated_definition,
    $old$WHEN run_profile_version IN ('controls-v3', 'domain-v1', 'domain-v2', 'transport-v1')$old$,
    $new$WHEN run_profile_version IN ('controls-v3', 'domain-v1', 'domain-v2', 'domain-v3', 'transport-v1')$new$);
  IF updated_definition = function_definition
    OR position('domain-v3' IN updated_definition) = 0
    OR position('DS-TLS-02' IN updated_definition) = 0 THEN
    RAISE EXCEPTION 'domain_v3_check_validator_extension_failed';
  END IF;
  EXECUTE updated_definition;

  SELECT pg_get_functiondef('public.ds_validate_profile_check_coverage()'::regprocedure)
  INTO function_definition;
  updated_definition := replace(function_definition,
    $old$'domain-v1', 'domain-v2', 'transport-v1'$old$,
    $new$'domain-v1', 'domain-v2', 'domain-v3', 'transport-v1'$new$);
  IF updated_definition = function_definition THEN
    RAISE EXCEPTION 'domain_v3_coverage_validator_extension_failed';
  END IF;
  EXECUTE updated_definition;

  SELECT pg_get_functiondef('public.ds_request_on_demand_scan(text)'::regprocedure)
  INTO function_definition;
  updated_definition := replace(function_definition,
    $old$VALUES (p_hostname, 'on_demand', 'domain-v2')$old$,
    $new$VALUES (p_hostname, 'on_demand', 'domain-v3')$new$);
  IF updated_definition = function_definition THEN
    RAISE EXCEPTION 'domain_v3_admission_profile_extension_failed';
  END IF;
  EXECUTE updated_definition;
END;
$$;
