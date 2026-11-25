CREATE OR REPLACE FUNCTION public.ds_valid_first_entry_policy_state_snapshot(p_value jsonb)
RETURNS boolean
LANGUAGE plpgsql
IMMUTABLE
STRICT
PARALLEL SAFE
SET search_path = pg_catalog, public
AS $$
DECLARE
  item jsonb;
  captured_at numeric;
  expires_at numeric;
  safe_integer_max constant numeric := 9007199254740991;
BEGIN
  IF jsonb_typeof(p_value) <> 'object' OR public.ds_public_policy_object_key_count(p_value) <> 5 OR
     NOT (p_value ?& ARRAY['capturedAtMs', 'cookies', 'storageKeys', 'cookieReadComplete', 'storageReadComplete']) OR
     jsonb_typeof(p_value->'capturedAtMs') <> 'number' OR
     (p_value->>'capturedAtMs') !~ '^(0|[1-9][0-9]*)$' OR
     NOT COALESCE(CASE WHEN jsonb_typeof(p_value->'cookies') = 'array'
       THEN jsonb_array_length(p_value->'cookies') <= 200 ELSE false END, false) OR
     NOT COALESCE(CASE WHEN jsonb_typeof(p_value->'storageKeys') = 'array'
       THEN jsonb_array_length(p_value->'storageKeys') <= 200 ELSE false END, false) OR
     jsonb_typeof(p_value->'cookieReadComplete') <> 'boolean' OR
     jsonb_typeof(p_value->'storageReadComplete') <> 'boolean' THEN
    RETURN false;
  END IF;
  captured_at := (p_value->>'capturedAtMs')::numeric;
  IF captured_at > safe_integer_max THEN RETURN false; END IF;

  FOR item IN SELECT value FROM jsonb_array_elements(p_value->'cookies') LOOP
    IF jsonb_typeof(item) <> 'object' OR public.ds_public_policy_object_key_count(item) <> 6 OR
       NOT (item ?& ARRAY['name', 'domain', 'secure', 'httpOnly', 'sameSite', 'expiresAtUnixSeconds']) OR
       jsonb_typeof(item->'name') <> 'string' OR length(item->>'name') NOT BETWEEN 1 AND 100 OR
       item->>'name' ~ '[[:cntrl:][:space:]]' OR
       jsonb_typeof(item->'domain') <> 'string' OR length(item->>'domain') NOT BETWEEN 1 AND 253 OR
       item->>'domain' ~ '[[:cntrl:][:space:]]' OR
       jsonb_typeof(item->'secure') <> 'boolean' OR jsonb_typeof(item->'httpOnly') <> 'boolean' OR
       jsonb_typeof(item->'sameSite') <> 'string' OR
       item->>'sameSite' NOT IN ('Strict', 'Lax', 'None', 'unspecified') OR
       (item->'expiresAtUnixSeconds' <> 'null'::jsonb AND
        (jsonb_typeof(item->'expiresAtUnixSeconds') <> 'number' OR
         (item->>'expiresAtUnixSeconds') !~ '^(0|[1-9][0-9]*)$')) THEN
      RETURN false;
    END IF;
    IF item->'expiresAtUnixSeconds' <> 'null'::jsonb THEN
      expires_at := (item->>'expiresAtUnixSeconds')::numeric;
      IF expires_at > safe_integer_max THEN RETURN false; END IF;
    END IF;
  END LOOP;

  FOR item IN SELECT value FROM jsonb_array_elements(p_value->'storageKeys') LOOP
    IF jsonb_typeof(item) <> 'object' OR public.ds_public_policy_object_key_count(item) <> 3 OR
       NOT (item ?& ARRAY['name', 'domain', 'kind']) OR
       jsonb_typeof(item->'name') <> 'string' OR length(item->>'name') NOT BETWEEN 1 AND 100 OR
       item->>'name' ~ '[[:cntrl:][:space:]]' OR
       jsonb_typeof(item->'domain') <> 'string' OR length(item->>'domain') NOT BETWEEN 1 AND 253 OR
       item->>'domain' ~ '[[:cntrl:][:space:]]' OR
       jsonb_typeof(item->'kind') <> 'string' OR
       item->>'kind' NOT IN ('local', 'session', 'indexeddb', 'cache', 'window-name') THEN
      RETURN false;
    END IF;
  END LOOP;
  RETURN true;
END;
$$;

CREATE OR REPLACE FUNCTION public.ds_valid_first_entry_policy_link_visit(p_value jsonb)
RETURNS boolean
LANGUAGE plpgsql
IMMUTABLE
STRICT
PARALLEL SAFE
SET search_path = pg_catalog, public
AS $$
DECLARE
  link_value jsonb;
  before_value jsonb;
  after_value jsonb;
  navigation_started numeric;
  before_captured numeric;
  after_captured numeric;
BEGIN
  IF jsonb_typeof(p_value) <> 'object' OR public.ds_public_policy_object_key_count(p_value) <> 6 OR
     NOT (p_value ?& ARRAY['status', 'link', 'documentAccess', 'navigationStartedAtMs', 'beforeNavigation', 'afterNavigation']) OR
     jsonb_typeof(p_value->'status') <> 'string' OR
     p_value->>'status' NOT IN ('evaluated', 'unknown', 'not_applicable') OR
     jsonb_typeof(p_value->'documentAccess') <> 'string' OR
     p_value->>'documentAccess' NOT IN ('accessible', 'unavailable', 'not_checked', 'unknown') OR
     (p_value->'navigationStartedAtMs' <> 'null'::jsonb AND
       (jsonb_typeof(p_value->'navigationStartedAtMs') <> 'number' OR
        (p_value->>'navigationStartedAtMs') !~ '^(0|[1-9][0-9]*)$')) OR
     (p_value->'beforeNavigation' <> 'null'::jsonb AND
       NOT public.ds_valid_first_entry_policy_state_snapshot(p_value->'beforeNavigation')) OR
     (p_value->'afterNavigation' <> 'null'::jsonb AND
       NOT public.ds_valid_first_entry_policy_state_snapshot(p_value->'afterNavigation')) THEN
    RETURN false;
  END IF;

  link_value := p_value->'link';
  IF link_value <> 'null'::jsonb AND (
       jsonb_typeof(link_value) <> 'object' OR public.ds_public_policy_object_key_count(link_value) <> 3 OR
       NOT (link_value ?& ARRAY['hostname', 'path', 'kind']) OR
       jsonb_typeof(link_value->'hostname') <> 'string' OR
       jsonb_typeof(link_value->'path') <> 'string' OR
       jsonb_typeof(link_value->'kind') <> 'string' OR
       link_value->>'kind' NOT IN ('privacy', 'cookies', 'terms', 'legal') OR
       length(link_value->>'hostname') NOT BETWEEN 1 AND 253 OR
       NOT COALESCE(lower(link_value->>'hostname') ~ '^([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)(\.([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?))*$', false) OR
       lower(link_value->>'hostname') ~ '^[0-9.]+$' OR lower(link_value->>'hostname') = 'localhost' OR
       lower(link_value->>'hostname') ~ '\.(localhost|local|internal|test|invalid|example|onion|lan|home|corp|intranet|private)$' OR
       lower(link_value->>'hostname') ~ '\.home\.arpa$' OR
       length(link_value->>'path') > 512 OR left(link_value->>'path', 1) <> '/' OR
       (link_value->>'path') ~ '[?#[:space:][:cntrl:]]') THEN
    RETURN false;
  END IF;

  IF p_value->'navigationStartedAtMs' <> 'null'::jsonb THEN
    navigation_started := (p_value->>'navigationStartedAtMs')::numeric;
    IF navigation_started > 9007199254740991 THEN RETURN false; END IF;
  END IF;
  IF p_value->>'status' = 'evaluated' AND link_value <> 'null'::jsonb THEN
    IF p_value->>'documentAccess' = 'not_checked' OR p_value->'navigationStartedAtMs' = 'null'::jsonb OR
       p_value->'beforeNavigation' = 'null'::jsonb OR p_value->'afterNavigation' = 'null'::jsonb THEN
      RETURN false;
    END IF;
    before_value := p_value->'beforeNavigation';
    after_value := p_value->'afterNavigation';
    before_captured := (before_value->>'capturedAtMs')::numeric;
    after_captured := (after_value->>'capturedAtMs')::numeric;
    IF before_captured > navigation_started OR navigation_started > after_captured THEN RETURN false; END IF;
  END IF;
  IF p_value->>'status' = 'not_applicable' AND
     (link_value <> 'null'::jsonb OR p_value->'navigationStartedAtMs' <> 'null'::jsonb OR
      p_value->'afterNavigation' <> 'null'::jsonb) THEN RETURN false; END IF;
  RETURN true;
END;
$$;

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
  IF jsonb_typeof(p_value) <> 'object' OR public.ds_public_policy_object_key_count(p_value) NOT IN (9, 10) OR
     NOT (p_value ?& ARRAY['policyVersion', 'status', 'reasonCode', 'consentPromptDetected',
       'thirdPartyCookieDetected', 'nonEssentialThirdPartyStorageDetected', 'linkLocation', 'link', 'documentAccess']) OR
     (p_value ? 'policyLinkVisit' AND NOT COALESCE(
       public.ds_valid_first_entry_policy_link_visit(p_value->'policyLinkVisit'), false
     )) OR
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
     pg_column_size(p_value) > 2097152 THEN
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

ALTER TABLE public.ds_scan_first_entry_policy_access
  DROP CONSTRAINT IF EXISTS ds_scan_first_entry_policy_access_assessment_json_check;
ALTER TABLE public.ds_scan_first_entry_policy_access
  ADD CONSTRAINT ds_scan_first_entry_policy_access_assessment_json_check
  CHECK (public.ds_valid_first_entry_policy_access(assessment_json) AND pg_column_size(assessment_json) <= 2097152);

REVOKE ALL ON FUNCTION public.ds_valid_first_entry_policy_state_snapshot(jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.ds_valid_first_entry_policy_link_visit(jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.ds_valid_first_entry_policy_access(jsonb) FROM PUBLIC;
