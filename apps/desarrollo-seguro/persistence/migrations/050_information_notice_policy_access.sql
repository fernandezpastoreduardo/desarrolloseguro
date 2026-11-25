CREATE OR REPLACE FUNCTION public.ds_valid_first_entry_policy_access(p_value jsonb)
RETURNS boolean
LANGUAGE plpgsql
IMMUTABLE
STRICT
PARALLEL SAFE
SET search_path = pg_catalog, public
AS $$
DECLARE
  policy_link jsonb;
  hostname text;
  path_value text;
BEGIN
  IF jsonb_typeof(p_value) <> 'object' OR public.ds_public_policy_object_key_count(p_value) <> 9 OR
     NOT (p_value ?& ARRAY['policyVersion', 'status', 'reasonCode', 'consentPromptDetected',
       'thirdPartyCookieDetected', 'nonEssentialThirdPartyStorageDetected', 'linkLocation', 'link', 'documentAccess']) OR
     p_value->>'policyVersion' <> 'first-entry-policy-access-v1' OR
     jsonb_typeof(p_value->'status') <> 'string' OR
     p_value->>'status' NOT IN ('pass', 'fail', 'unknown') OR
     jsonb_typeof(p_value->'reasonCode') <> 'string' OR
     p_value->>'reasonCode' NOT IN ('consent_component_link_accessible',
       'information_notice_link_accessible_without_consent', 'consent_link_missing',
       'consent_link_unavailable', 'footer_link_accessible_without_consent',
       'footer_insufficient_with_third_party_cookies',
       'information_notice_insufficient_with_third_party_cookies', 'policy_link_missing', 'auditor_error') OR
     jsonb_typeof(p_value->'linkLocation') <> 'string' OR
     p_value->>'linkLocation' NOT IN ('consent_component', 'information_notice', 'footer', 'none', 'unknown') OR
     jsonb_typeof(p_value->'documentAccess') <> 'string' OR
     p_value->>'documentAccess' NOT IN ('accessible', 'unavailable', 'not_checked', 'unknown') OR
     p_value->'consentPromptDetected' IS NULL OR
     jsonb_typeof(p_value->'consentPromptDetected') NOT IN ('boolean', 'null') OR
     p_value->'thirdPartyCookieDetected' IS NULL OR
     jsonb_typeof(p_value->'thirdPartyCookieDetected') NOT IN ('boolean', 'null') OR
     p_value->'nonEssentialThirdPartyStorageDetected' IS NULL OR
     jsonb_typeof(p_value->'nonEssentialThirdPartyStorageDetected') NOT IN ('boolean', 'null') OR
     pg_column_size(p_value) > 4096 THEN
    RETURN false;
  END IF;

  policy_link := p_value->'link';
  IF jsonb_typeof(policy_link) <> 'null' THEN
    IF jsonb_typeof(policy_link) <> 'object' OR public.ds_public_policy_object_key_count(policy_link) <> 3 OR
       NOT (policy_link ?& ARRAY['hostname', 'path', 'kind']) OR
       jsonb_typeof(policy_link->'hostname') <> 'string' OR
       jsonb_typeof(policy_link->'path') <> 'string' OR
       jsonb_typeof(policy_link->'kind') <> 'string' OR
       policy_link->>'kind' NOT IN ('privacy', 'cookies', 'terms', 'legal') THEN
      RETURN false;
    END IF;
    hostname := lower(policy_link->>'hostname');
    path_value := policy_link->>'path';
    IF length(hostname) NOT BETWEEN 1 AND 253 OR
       NOT COALESCE(hostname ~ '^([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)(\.([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?))*$', false) OR
       hostname ~ '^[0-9.]+$' OR
       hostname = 'localhost' OR hostname ~ '\.(localhost|local|internal|test|invalid|example|onion|lan|home|corp|intranet|private)$' OR
       hostname ~ '\.home\.arpa$' OR length(path_value) > 512 OR left(path_value, 1) <> '/' OR
       path_value ~ '[?#[:space:][:cntrl:]]' THEN
      RETURN false;
    END IF;
  END IF;

  IF p_value->>'status' = 'pass' AND p_value->>'documentAccess' <> 'accessible' THEN RETURN false; END IF;
  IF p_value->>'status' = 'unknown' AND p_value->>'reasonCode' <> 'auditor_error' THEN RETURN false; END IF;
  IF p_value->>'status' = 'fail' AND p_value->>'reasonCode' = 'auditor_error' THEN RETURN false; END IF;
  IF p_value->>'status' = 'pass' AND p_value->>'consentPromptDetected' = 'true' AND
     (p_value->>'linkLocation' <> 'consent_component' OR p_value->>'reasonCode' <> 'consent_component_link_accessible') THEN RETURN false; END IF;
  IF p_value->>'status' = 'pass' AND p_value->>'consentPromptDetected' IS DISTINCT FROM 'true' AND
     (p_value->>'thirdPartyCookieDetected' IS DISTINCT FROM 'false' OR
      p_value->>'linkLocation' NOT IN ('footer', 'information_notice') OR
      (p_value->>'linkLocation' = 'footer' AND p_value->>'reasonCode' <> 'footer_link_accessible_without_consent') OR
      (p_value->>'linkLocation' = 'information_notice' AND p_value->>'reasonCode' <> 'information_notice_link_accessible_without_consent')) THEN RETURN false; END IF;
  IF p_value->>'status' = 'pass' AND p_value->>'reasonCode' NOT IN (
       'consent_component_link_accessible', 'footer_link_accessible_without_consent',
       'information_notice_link_accessible_without_consent') THEN RETURN false; END IF;
  IF p_value->>'reasonCode' = 'consent_link_missing' AND
     (p_value->>'consentPromptDetected' IS DISTINCT FROM 'true' OR p_value->>'linkLocation' <> 'none' OR policy_link IS DISTINCT FROM 'null'::jsonb) THEN RETURN false; END IF;
  IF p_value->>'reasonCode' = 'consent_link_unavailable' AND
     (p_value->>'documentAccess' <> 'unavailable' OR policy_link IS NULL OR policy_link = 'null'::jsonb) THEN RETURN false; END IF;
  IF p_value->>'reasonCode' = 'footer_link_accessible_without_consent' AND
     (p_value->>'consentPromptDetected' IS DISTINCT FROM 'false' OR p_value->>'thirdPartyCookieDetected' IS DISTINCT FROM 'false' OR
      p_value->>'documentAccess' <> 'accessible' OR p_value->>'linkLocation' <> 'footer') THEN RETURN false; END IF;
  IF p_value->>'reasonCode' = 'information_notice_link_accessible_without_consent' AND
     (p_value->>'consentPromptDetected' IS DISTINCT FROM 'false' OR p_value->>'thirdPartyCookieDetected' IS DISTINCT FROM 'false' OR
      p_value->>'documentAccess' <> 'accessible' OR p_value->>'linkLocation' <> 'information_notice') THEN RETURN false; END IF;
  IF p_value->>'reasonCode' = 'footer_insufficient_with_third_party_cookies' AND
     (p_value->>'consentPromptDetected' IS DISTINCT FROM 'false' OR p_value->>'thirdPartyCookieDetected' IS DISTINCT FROM 'true' OR
      p_value->>'linkLocation' <> 'footer') THEN RETURN false; END IF;
  IF p_value->>'reasonCode' = 'information_notice_insufficient_with_third_party_cookies' AND
     (p_value->>'consentPromptDetected' IS DISTINCT FROM 'false' OR p_value->>'thirdPartyCookieDetected' IS DISTINCT FROM 'true' OR
      p_value->>'linkLocation' <> 'information_notice') THEN RETURN false; END IF;
  IF p_value->>'reasonCode' = 'policy_link_missing' AND
     (p_value->>'linkLocation' <> 'none' OR policy_link IS DISTINCT FROM 'null'::jsonb) THEN RETURN false; END IF;
  IF p_value->>'linkLocation' = 'none' AND policy_link IS DISTINCT FROM 'null'::jsonb THEN RETURN false; END IF;
  IF p_value->>'linkLocation' IN ('consent_component', 'information_notice', 'footer') AND
     (policy_link IS NULL OR policy_link = 'null'::jsonb) THEN RETURN false; END IF;
  RETURN true;
END;
$$;
