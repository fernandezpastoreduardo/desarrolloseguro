CREATE OR REPLACE FUNCTION public.ds_valid_legal_cookie_findings(p_value jsonb)
RETURNS boolean
LANGUAGE plpgsql
IMMUTABLE
STRICT
PARALLEL SAFE
SET search_path = pg_catalog, public
AS $$
DECLARE
  item jsonb;
  evidence_item jsonb;
  evidence_key_count integer;
BEGIN
  IF jsonb_typeof(p_value) <> 'array' OR jsonb_array_length(p_value) > 2 THEN RETURN false; END IF;
  FOR item IN SELECT value FROM jsonb_array_elements(p_value) LOOP
    IF jsonb_typeof(item) <> 'object' OR public.ds_public_policy_object_key_count(item) <> 12 OR
       NOT (item ?& ARRAY['ruleId', 'ruleVersion', 'status', 'title', 'description', 'jurisdiction',
         'articles', 'infringementClass', 'sanction', 'authority', 'evidence', 'evidenceComplete']) OR
       NOT COALESCE(item->>'ruleId' IN ('lssi-cookie-no-prior-consent-v1', 'lssi-cookie-after-rejection-v1'), false) OR
       item->>'ruleVersion' <> '1.0.0' OR item->>'status' <> 'accredited' OR
       item->>'jurisdiction' <> 'ES' OR item->>'infringementClass' <> 'minor' OR
       item->>'authority' <> 'Agencia Española de Protección de Datos' OR
       item->>'evidenceComplete' <> 'true' OR
       item #>> '{sanction,type}' <> 'statutory_maximum' OR
       item #>> '{sanction,currency}' <> 'EUR' OR item #>> '{sanction,maximum}' <> '30000' OR
       jsonb_typeof(item->'evidence') <> 'array' OR jsonb_array_length(item->'evidence') < 1 OR
       jsonb_array_length(item->'evidence') > 50 OR jsonb_typeof(item->'articles') <> 'array' OR
       jsonb_array_length(item->'articles') <> 4 THEN RETURN false; END IF;
    FOR evidence_item IN SELECT value FROM jsonb_array_elements(item->'evidence') LOOP
      evidence_key_count := public.ds_public_policy_object_key_count(evidence_item);
      IF jsonb_typeof(evidence_item) <> 'object' OR evidence_key_count < 9 OR evidence_key_count > 11 OR
         evidence_key_count <> 9 + CASE WHEN evidence_item ? 'auditBlockedRequestHosts' THEN 1 ELSE 0 END +
           CASE WHEN evidence_item ? 'corroborationPhase' THEN 1 ELSE 0 END OR
         NOT (evidence_item ?& ARRAY['flow', 'phase', 'capturedAtMs', 'cookieName', 'cookieDomain', 'provider',
           'purpose', 'attributionRuleId', 'correlatedRequestHosts']) OR
         (evidence_item ? 'corroborationPhase' AND
           NOT COALESCE(evidence_item->>'corroborationPhase' IN ('before_choice', 'after_choice', 'after_reload'), false)) OR
         NOT COALESCE(evidence_item->>'flow' IN ('initial', 'reject'), false) OR
         NOT COALESCE(evidence_item->>'phase' IN ('before_choice', 'after_choice', 'after_reload'), false) OR
         jsonb_typeof(evidence_item->'capturedAtMs') <> 'number' OR
         jsonb_typeof(evidence_item->'correlatedRequestHosts') <> 'array' OR
         jsonb_array_length(evidence_item->'correlatedRequestHosts') > 20 OR
         (evidence_item ? 'auditBlockedRequestHosts' AND
           (jsonb_typeof(evidence_item->'auditBlockedRequestHosts') <> 'array' OR
            jsonb_array_length(evidence_item->'auditBlockedRequestHosts') > 20)) THEN RETURN false; END IF;
    END LOOP;
  END LOOP;
  RETURN true;
END;
$$;
