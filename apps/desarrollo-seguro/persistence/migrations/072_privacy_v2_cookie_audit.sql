ALTER TABLE public.ds_scan_privacy_assessments
  DROP CONSTRAINT ds_scan_privacy_assessments_assessment_json_check,
  ADD CONSTRAINT ds_scan_privacy_assessments_assessment_json_check CHECK (
    jsonb_typeof(assessment_json) = 'object' AND
    assessment_json->>'policyVersion' IN ('privacy-v1', 'privacy-v2') AND
    jsonb_typeof(assessment_json->'criteria') = 'array' AND
    jsonb_array_length(assessment_json->'criteria') = 5 AND
    (assessment_json->>'policyVersion' = 'privacy-v1' OR
      jsonb_typeof(assessment_json->'evidence'->'cookieAudit') IS NOT DISTINCT FROM 'object') AND
    pg_column_size(assessment_json) <= 65536
  );

DO $$
DECLARE
  function_definition text;
  previous_condition text := $old$p_privacy_assessment_json->>'policyVersion' IS DISTINCT FROM 'privacy-v1'$old$;
  next_condition text := $new$(p_privacy_assessment_json->>'policyVersion' NOT IN ('privacy-v1', 'privacy-v2') OR
     (p_privacy_assessment_json->>'policyVersion' = 'privacy-v2' AND
      jsonb_typeof(p_privacy_assessment_json->'evidence'->'cookieAudit') IS DISTINCT FROM 'object'))$new$;
BEGIN
  SELECT pg_get_functiondef(
    'public.ds_complete_scan_with_privacy(uuid, uuid, timestamptz, text, timestamptz, text, jsonb, jsonb, jsonb, jsonb)'::regprocedure
  ) INTO function_definition;

  IF position(previous_condition IN function_definition) = 0 THEN
    RAISE EXCEPTION 'privacy completion function does not have the expected v1 policy guard';
  END IF;

  function_definition := replace(function_definition, previous_condition, next_condition);
  EXECUTE function_definition;
END;
$$;
