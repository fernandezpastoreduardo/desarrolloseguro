CREATE TABLE IF NOT EXISTS public.ds_profile_check_rules (
  profile_version text NOT NULL,
  control_id text NOT NULL,
  target_kind text NOT NULL CHECK (target_kind IN ('host', 'route')),
  method text NOT NULL,
  PRIMARY KEY (profile_version, control_id, target_kind, method),
  FOREIGN KEY (profile_version, control_id)
    REFERENCES public.ds_profile_controls(profile_version, control_id)
);

CREATE OR REPLACE FUNCTION public.ds_reject_profile_check_rule_mutation()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
BEGIN
  RAISE EXCEPTION 'Development Security profile check rules are immutable';
END;
$$;

DROP TRIGGER IF EXISTS ds_profile_check_rules_immutable
  ON public.ds_profile_check_rules;
CREATE TRIGGER ds_profile_check_rules_immutable
  BEFORE UPDATE OR DELETE ON public.ds_profile_check_rules
  FOR EACH ROW EXECUTE FUNCTION public.ds_reject_profile_check_rule_mutation();

INSERT INTO public.ds_profile_controls(profile_version, control_id, required)
SELECT 'controls-v2', control_id, true
FROM public.ds_profile_controls
WHERE profile_version = 'controls-v1'
ON CONFLICT(profile_version, control_id) DO NOTHING;

INSERT INTO public.ds_profile_check_rules(
  profile_version, control_id, target_kind, method
)
VALUES
  ('controls-v2', 'DS-DNS-01', 'host', 'DNS'),
  ('controls-v2', 'DS-TLS-01', 'host', 'TLS'),
  ('controls-v2', 'DS-TLS-02', 'host', 'TLS'),
  ('controls-v2', 'DS-HTTP-01', 'route', 'HEAD'),
  ('controls-v2', 'DS-HTTP-01', 'route', 'GET'),
  ('controls-v2', 'DS-HDR-01', 'route', 'GET'),
  ('controls-v2', 'DS-PRIV-01', 'route', 'GET'),
  ('controls-v2', 'DS-PRIV-02', 'route', 'GET'),
  ('controls-v2', 'DS-PRIV-03', 'route', 'GET'),
  ('controls-v2', 'DS-QUAL-01', 'route', 'GET')
ON CONFLICT(profile_version, control_id, target_kind, method) DO NOTHING;

CREATE OR REPLACE FUNCTION public.ds_validate_scan_scope_before_insert()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
DECLARE
  path_count integer;
  unique_path_count integer;
BEGIN
  IF NEW.profile_version NOT IN ('controls-v1', 'controls-v2', 'controls-v3')
    OR jsonb_typeof(NEW.scope_json) <> 'array'
    OR jsonb_array_length(NEW.scope_json) < 1
    OR jsonb_array_length(NEW.scope_json) > 3
    OR NOT NEW.scope_json @> '["/"]'::jsonb
    OR EXISTS (
      SELECT 1
      FROM jsonb_array_elements(NEW.scope_json) AS paths(path)
      WHERE jsonb_typeof(path) <> 'string'
        OR path #>> '{}' NOT IN ('/', '/precios', '/informe')
    ) THEN
    RAISE EXCEPTION 'scan_scope_not_allowlisted';
  END IF;

  SELECT count(*)::integer, count(DISTINCT path)::integer
  INTO path_count, unique_path_count
  FROM jsonb_array_elements_text(NEW.scope_json) AS paths(path);
  IF path_count <> unique_path_count THEN
    RAISE EXCEPTION 'scan_scope_not_allowlisted';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS ds_scan_run_scope_guard ON public.ds_scan_runs;
CREATE TRIGGER ds_scan_run_scope_guard
  BEFORE INSERT ON public.ds_scan_runs
  FOR EACH ROW EXECUTE FUNCTION public.ds_validate_scan_scope_before_insert();

CREATE OR REPLACE FUNCTION public.ds_validate_check_result_before_insert()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
DECLARE
  run_scope jsonb;
  run_hostname text;
  run_profile_version text;
  contract_methods text[];
  evidence_key text;
  evidence_value jsonb;
  evidence_rule text;
  pass_supported boolean := false;
BEGIN
  SELECT scope_json, hostname, profile_version
  INTO run_scope, run_hostname, run_profile_version
  FROM public.ds_scan_runs
  WHERE id = NEW.run_id
    AND profile_version IN ('controls-v1', 'controls-v2', 'controls-v3');
  IF NOT FOUND THEN
    RAISE EXCEPTION 'scan_profile_not_allowlisted';
  END IF;

  IF NEW.required IS DISTINCT FROM true
    OR NEW.severity NOT IN ('critical', 'high', 'medium', 'low', 'info')
    OR NEW.summary <> 'Comprobación ' || NEW.control_id || ': ' || NEW.status || '.'
    OR NEW.limitation <> (
      'Resultado limitado a las rutas públicas declaradas del perfil '
      || run_profile_version || '.'
    )
    OR jsonb_typeof(NEW.evidence_json) <> 'object'
    OR pg_column_size(NEW.evidence_json) > 8192 THEN
    RAISE EXCEPTION 'scan_check_payload_not_allowlisted';
  END IF;

  contract_methods := CASE NEW.control_id
    WHEN 'DS-DNS-01' THEN ARRAY['DNS']
    WHEN 'DS-TLS-01' THEN ARRAY['TLS']
    WHEN 'DS-TLS-02' THEN ARRAY['TLS']
    WHEN 'DS-HTTP-01' THEN ARRAY['HEAD', 'GET']
    WHEN 'DS-HDR-01' THEN ARRAY['GET']
    WHEN 'DS-PRIV-01' THEN ARRAY['GET']
    WHEN 'DS-PRIV-02' THEN ARRAY['GET']
    WHEN 'DS-PRIV-03' THEN ARRAY['GET']
    WHEN 'DS-QUAL-01' THEN ARRAY['GET']
    ELSE NULL
  END;
  IF contract_methods IS NULL OR NOT NEW.method = ANY(contract_methods) THEN
    RAISE EXCEPTION 'scan_check_scope_not_allowlisted';
  END IF;

  IF NEW.status = 'not_applicable' THEN
    RAISE EXCEPTION 'scan_not_applicable_not_supported';
  END IF;

  IF NEW.method IN ('DNS', 'TLS') THEN
    IF NEW.target_path <> '/' THEN
      RAISE EXCEPTION 'scan_check_scope_not_allowlisted';
    END IF;
  ELSIF NOT run_scope @> jsonb_build_array(NEW.target_path)
    OR NEW.target_path NOT IN ('/', '/precios', '/informe') THEN
    RAISE EXCEPTION 'scan_check_scope_not_allowlisted';
  END IF;

  IF run_profile_version IN ('controls-v2', 'controls-v3') AND NOT EXISTS (
    SELECT 1 FROM public.ds_profile_check_rules AS rule
    WHERE rule.profile_version = run_profile_version
      AND rule.control_id = NEW.control_id
      AND rule.method = NEW.method
      AND (
        (rule.target_kind = 'host' AND NEW.target_path = '/')
        OR (rule.target_kind = 'route'
          AND run_scope @> jsonb_build_array(NEW.target_path))
      )
  ) THEN
    RAISE EXCEPTION 'scan_check_scope_not_allowlisted';
  END IF;

  FOR evidence_key, evidence_value IN
    SELECT key, value FROM jsonb_each(NEW.evidence_json)
  LOOP
    evidence_rule := CASE NEW.control_id
      WHEN 'DS-DNS-01' THEN CASE evidence_key
        WHEN 'addressClass' THEN 'enum:public,private,reserved,unresolved'
        WHEN 'aRecordCount' THEN 'count'
        WHEN 'aaaaRecordCount' THEN 'count'
        ELSE NULL END
      WHEN 'DS-TLS-01' THEN CASE evidence_key
        WHEN 'protocol' THEN 'enum:TLSv1.2,TLSv1.3'
        WHEN 'certificateValid' THEN 'boolean'
        WHEN 'hostnameMatches' THEN 'boolean'
        ELSE NULL END
      WHEN 'DS-TLS-02' THEN CASE evidence_key
        WHEN 'tls10Accepted' THEN 'boolean'
        WHEN 'tls11Accepted' THEN 'boolean'
        WHEN 'tls12Accepted' THEN 'boolean'
        WHEN 'tls13Accepted' THEN 'boolean'
        ELSE NULL END
      WHEN 'DS-HTTP-01' THEN CASE evidence_key
        WHEN 'statusCode' THEN 'http_status'
        WHEN 'redirectedToHttps' THEN 'boolean'
        WHEN 'finalScheme' THEN 'enum:http,https'
        ELSE NULL END
      WHEN 'DS-HDR-01' THEN CASE evidence_key
        WHEN 'hsts' THEN 'boolean'
        WHEN 'nosniff' THEN 'boolean'
        WHEN 'frameProtection' THEN 'boolean'
        WHEN 'referrerPolicy' THEN 'boolean'
        WHEN 'csp' THEN 'boolean'
        WHEN 'finalScheme' THEN CASE
          WHEN run_profile_version = 'controls-v3' THEN 'enum:http,https'
          ELSE NULL END
        ELSE NULL END
      WHEN 'DS-PRIV-01' THEN CASE evidence_key
        WHEN 'thirdPartyAttempts' THEN 'count'
        WHEN 'blockedRequests' THEN 'count'
        ELSE NULL END
      WHEN 'DS-PRIV-02' THEN CASE evidence_key
        WHEN 'cookieCount' THEN 'count'
        WHEN 'insecureCookieCount' THEN 'count'
        WHEN 'thirdPartyCookieCount' THEN 'count'
        WHEN 'inspected' THEN 'boolean'
        ELSE NULL END
      WHEN 'DS-PRIV-03' THEN CASE evidence_key
        WHEN 'mixedContentCount' THEN 'count'
        WHEN 'insecureNavigationCount' THEN 'count'
        ELSE NULL END
      WHEN 'DS-QUAL-01' THEN CASE evidence_key
        WHEN 'documentStatusCode' THEN 'http_status'
        WHEN 'failedEssentialResourceCount' THEN 'count'
        ELSE NULL END
      ELSE NULL
    END;

    IF evidence_rule IS NULL THEN
      RAISE EXCEPTION 'scan_evidence_not_allowlisted';
    ELSIF evidence_rule = 'boolean' AND jsonb_typeof(evidence_value) <> 'boolean' THEN
      RAISE EXCEPTION 'scan_evidence_invalid';
    ELSIF evidence_rule IN ('count', 'http_status')
      AND (jsonb_typeof(evidence_value) <> 'number'
        OR evidence_value #>> '{}' !~ '^(0|[1-9][0-9]*)$'
        OR (evidence_value #>> '{}')::numeric > CASE
          WHEN evidence_rule = 'http_status' THEN 599
          ELSE 100000
        END
        OR (evidence_rule = 'http_status'
          AND (evidence_value #>> '{}')::numeric < 100)) THEN
      RAISE EXCEPTION 'scan_evidence_invalid';
    ELSIF evidence_rule LIKE 'enum:%'
      AND (jsonb_typeof(evidence_value) <> 'string'
        OR NOT string_to_array(split_part(evidence_rule, ':', 2), ',')
          @> ARRAY[evidence_value #>> '{}']) THEN
      RAISE EXCEPTION 'scan_evidence_invalid';
    END IF;
  END LOOP;

  IF run_profile_version = 'controls-v3'
    AND NEW.control_id = 'DS-HDR-01'
    AND NEW.evidence_json->>'finalScheme' IS DISTINCT FROM 'https'
    AND NEW.status <> 'unknown' THEN
    RAISE EXCEPTION 'scan_headers_require_https';
  END IF;

  IF run_profile_version IN ('controls-v2', 'controls-v3')
    AND NEW.control_id = 'DS-HTTP-01'
    AND NEW.method = 'HEAD'
    AND NEW.evidence_json->>'statusCode' IN ('405', '501')
    AND NEW.evidence_json->>'redirectedToHttps' = 'true'
    AND NEW.evidence_json->>'finalScheme' = 'https'
    AND NEW.status <> 'unknown' THEN
    RAISE EXCEPTION 'scan_head_method_not_supported';
  END IF;

  IF NEW.control_id = 'DS-DNS-01'
    AND NEW.evidence_json->>'addressClass' IN ('private', 'reserved') THEN
    RAISE EXCEPTION 'scan_destination_not_public';
  END IF;

  pass_supported := CASE NEW.control_id
    WHEN 'DS-DNS-01' THEN
      NEW.evidence_json->>'addressClass' = 'public'
      AND COALESCE((NEW.evidence_json->>'aRecordCount')::numeric, 0)
        + COALESCE((NEW.evidence_json->>'aaaaRecordCount')::numeric, 0) > 0
    WHEN 'DS-TLS-01' THEN
      NEW.evidence_json->>'protocol' IN ('TLSv1.2', 'TLSv1.3')
      AND NEW.evidence_json->>'certificateValid' = 'true'
      AND NEW.evidence_json->>'hostnameMatches' = 'true'
    WHEN 'DS-TLS-02' THEN
      NEW.evidence_json->>'tls10Accepted' = 'false'
      AND NEW.evidence_json->>'tls11Accepted' = 'false'
      AND (NEW.evidence_json->>'tls12Accepted' = 'true'
        OR NEW.evidence_json->>'tls13Accepted' = 'true')
    WHEN 'DS-HTTP-01' THEN
      NEW.evidence_json->>'statusCode' ~ '^[0-9]+$'
      AND (NEW.evidence_json->>'statusCode')::integer BETWEEN 200 AND 399
      AND NEW.evidence_json->>'redirectedToHttps' = 'true'
      AND NEW.evidence_json->>'finalScheme' = 'https'
    WHEN 'DS-HDR-01' THEN
      NEW.evidence_json->>'hsts' = 'true'
      AND NEW.evidence_json->>'nosniff' = 'true'
      AND NEW.evidence_json->>'frameProtection' = 'true'
      AND NEW.evidence_json->>'referrerPolicy' = 'true'
      AND NEW.evidence_json->>'csp' = 'true'
      AND (run_profile_version <> 'controls-v3'
        OR NEW.evidence_json->>'finalScheme' = 'https')
    WHEN 'DS-PRIV-01' THEN
      NEW.evidence_json->>'thirdPartyAttempts' = '0'
      AND NEW.evidence_json->>'blockedRequests' = '0'
    WHEN 'DS-PRIV-02' THEN
      NEW.evidence_json->>'inspected' = 'true'
      AND NEW.evidence_json ? 'cookieCount'
      AND NEW.evidence_json->>'insecureCookieCount' = '0'
      AND NEW.evidence_json->>'thirdPartyCookieCount' = '0'
    WHEN 'DS-PRIV-03' THEN
      NEW.evidence_json->>'mixedContentCount' = '0'
      AND NEW.evidence_json->>'insecureNavigationCount' = '0'
    WHEN 'DS-QUAL-01' THEN
      NEW.evidence_json->>'documentStatusCode' ~ '^[0-9]+$'
      AND (NEW.evidence_json->>'documentStatusCode')::integer BETWEEN 200 AND 399
      AND NEW.evidence_json->>'failedEssentialResourceCount' = '0'
    ELSE false
  END;

  IF NEW.status = 'pass' AND NOT COALESCE(pass_supported, false) THEN
    RAISE EXCEPTION 'scan_pass_evidence_insufficient_or_contradictory';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS ds_check_result_payload_guard ON public.ds_check_results;
CREATE TRIGGER ds_check_result_payload_guard
  BEFORE INSERT ON public.ds_check_results
  FOR EACH ROW EXECUTE FUNCTION public.ds_validate_check_result_before_insert();

CREATE OR REPLACE FUNCTION public.ds_validate_profile_check_coverage()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF NEW.profile_version NOT IN ('controls-v2', 'controls-v3') THEN
    RETURN NULL;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.ds_profile_check_rules
    WHERE profile_version = NEW.profile_version
  ) THEN
    RAISE EXCEPTION 'scan_profile_not_catalogued';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.ds_profile_check_rules AS rule
    CROSS JOIN LATERAL jsonb_array_elements_text(NEW.scope_json) AS paths(path)
    WHERE rule.profile_version = NEW.profile_version
      AND (rule.target_kind = 'route' OR paths.path = '/')
      AND NOT EXISTS (
        SELECT 1 FROM public.ds_check_results AS result
        WHERE result.run_id = NEW.id
          AND result.control_id = rule.control_id
          AND result.target_path = paths.path
          AND result.method = rule.method
          AND result.required IS TRUE
      )
  ) THEN
    RAISE EXCEPTION 'scan_check_coverage_incomplete';
  END IF;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS ds_profile_check_coverage_guard
  ON public.ds_scan_runs;
CREATE CONSTRAINT TRIGGER ds_profile_check_coverage_guard
  AFTER INSERT ON public.ds_scan_runs
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION public.ds_validate_profile_check_coverage();


INSERT INTO public.ds_profile_controls(profile_version, control_id, required)
SELECT 'controls-v3', control_id, required
FROM public.ds_profile_controls
WHERE profile_version = 'controls-v2'
ON CONFLICT(profile_version, control_id) DO NOTHING;

INSERT INTO public.ds_profile_check_rules(
  profile_version, control_id, target_kind, method
)
SELECT 'controls-v3', control_id, target_kind, method
FROM public.ds_profile_check_rules
WHERE profile_version = 'controls-v2'
ON CONFLICT(profile_version, control_id, target_kind, method) DO NOTHING;
