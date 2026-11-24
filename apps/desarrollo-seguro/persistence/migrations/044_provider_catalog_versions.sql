CREATE FUNCTION public.ds_valid_provider_catalog_sources(p_sources jsonb)
RETURNS boolean
LANGUAGE plpgsql
IMMUTABLE
STRICT
PARALLEL SAFE
SET search_path = pg_catalog, public
AS $$
DECLARE source_item jsonb;
BEGIN
  IF jsonb_typeof(p_sources) <> 'array' OR jsonb_array_length(p_sources) > 500 THEN
    RETURN false;
  END IF;
  FOR source_item IN SELECT value FROM jsonb_array_elements(p_sources) LOOP
    IF jsonb_typeof(source_item) <> 'object' OR
       public.ds_public_policy_object_key_count(source_item) <> 7 OR
       NOT (source_item ?& ARRAY['providerId', 'documentId', 'title', 'url', 'status', 'sha256', 'checkedAt']) OR
       jsonb_typeof(source_item->'providerId') <> 'string' OR COALESCE(source_item->>'providerId', '') !~ '^[a-z0-9][a-z0-9_-]{0,63}$' OR
       jsonb_typeof(source_item->'documentId') <> 'string' OR COALESCE(source_item->>'documentId', '') !~ '^[a-z0-9][a-z0-9_-]{0,95}$' OR
       jsonb_typeof(source_item->'title') <> 'string' OR length(source_item->>'title') NOT BETWEEN 1 AND 240 OR
       jsonb_typeof(source_item->'url') <> 'string' OR length(source_item->>'url') > 2048 OR COALESCE(source_item->>'url', '') !~ '^https://[^[:space:]]+$' OR
       jsonb_typeof(source_item->'status') <> 'string' OR COALESCE(source_item->>'status', '') NOT IN ('seeded', 'fetched', 'unavailable', 'failed', 'not_localized') OR
       (source_item->>'sha256' IS NOT NULL AND source_item->>'sha256' !~ '^[a-f0-9]{64}$') OR
       (source_item->>'status' = 'fetched' AND source_item->>'sha256' IS NULL) OR
       jsonb_typeof(source_item->'checkedAt') <> 'string' OR
       (source_item->>'checkedAt')::timestamptz IS NULL THEN
      RETURN false;
    END IF;
  END LOOP;
  RETURN true;
EXCEPTION WHEN OTHERS THEN
  RETURN false;
END;
$$;

CREATE TABLE public.ds_provider_catalog_versions (
  catalog_version text PRIMARY KEY CHECK (catalog_version ~ '^[a-f0-9]{64}$'),
  provider_facts_json jsonb NOT NULL CHECK (
    jsonb_typeof(provider_facts_json) = 'array' AND
    jsonb_array_length(provider_facts_json) <= 300 AND
    pg_column_size(provider_facts_json) <= 2097152
  ),
  legal_rules_json jsonb NOT NULL CHECK (
    jsonb_typeof(legal_rules_json) = 'array' AND
    jsonb_array_length(legal_rules_json) <= 200 AND
    pg_column_size(legal_rules_json) <= 1048576
  ),
  source_receipts_json jsonb NOT NULL CHECK (
    public.ds_valid_provider_catalog_sources(source_receipts_json) AND
    pg_column_size(source_receipts_json) <= 524288
  ),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TRIGGER ds_provider_catalog_versions_immutable
  BEFORE UPDATE OR DELETE ON public.ds_provider_catalog_versions
  FOR EACH ROW EXECUTE FUNCTION public.ds_reject_report_mutation();

CREATE TABLE public.ds_provider_catalog_active (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  catalog_version text NOT NULL REFERENCES public.ds_provider_catalog_versions(catalog_version),
  activated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.ds_provider_catalog_refresh_runs (
  scheduled_local_date date PRIMARY KEY CHECK (extract(day FROM scheduled_local_date) = 1),
  status text NOT NULL CHECK (status IN ('running', 'completed', 'failed')),
  catalog_version text REFERENCES public.ds_provider_catalog_versions(catalog_version),
  source_receipts_json jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (
    public.ds_valid_provider_catalog_sources(source_receipts_json) AND pg_column_size(source_receipts_json) <= 524288
  ),
  failure_code text CHECK (failure_code IS NULL OR failure_code ~ '^[a-z][a-z0-9_]{0,63}$'),
  started_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  CHECK ((status = 'running') = (completed_at IS NULL)),
  CHECK ((status = 'completed') = (catalog_version IS NOT NULL)),
  CHECK ((status = 'failed') = (failure_code IS NOT NULL))
);

CREATE FUNCTION public.ds_begin_provider_catalog_refresh(p_scheduled_local_date date)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE refresh_started boolean;
BEGIN
  IF p_scheduled_local_date IS NULL OR extract(day FROM p_scheduled_local_date) <> 1 THEN
    RAISE EXCEPTION 'invalid_provider_catalog_refresh_date';
  END IF;
  INSERT INTO public.ds_provider_catalog_refresh_runs(scheduled_local_date, status)
  VALUES (p_scheduled_local_date, 'running')
  ON CONFLICT (scheduled_local_date) DO UPDATE SET status = 'running',
    source_receipts_json = '[]'::jsonb, failure_code = NULL, completed_at = NULL,
    started_at = now()
  WHERE public.ds_provider_catalog_refresh_runs.status = 'failed' OR
    (public.ds_provider_catalog_refresh_runs.status = 'running' AND
      public.ds_provider_catalog_refresh_runs.started_at < now() - interval '15 minutes')
  RETURNING true INTO refresh_started;
  RETURN COALESCE(refresh_started, false);
END;
$$;

CREATE FUNCTION public.ds_activate_provider_catalog_version(
  p_catalog_version text,
  p_provider_facts_json jsonb,
  p_legal_rules_json jsonb,
  p_source_receipts_json jsonb,
  p_scheduled_local_date date
) RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  existing_version public.ds_provider_catalog_versions%ROWTYPE;
BEGIN
  IF p_catalog_version IS NULL OR p_catalog_version !~ '^[a-f0-9]{64}$' OR
     p_provider_facts_json IS NULL OR jsonb_typeof(p_provider_facts_json) <> 'array' OR jsonb_array_length(p_provider_facts_json) > 300 OR
     p_legal_rules_json IS NULL OR jsonb_typeof(p_legal_rules_json) <> 'array' OR jsonb_array_length(p_legal_rules_json) > 200 OR
     p_source_receipts_json IS NULL OR
     NOT public.ds_valid_provider_catalog_sources(p_source_receipts_json) OR
     jsonb_array_length(p_source_receipts_json) = 0 OR
     EXISTS (SELECT 1 FROM jsonb_array_elements(p_source_receipts_json) AS source(value)
       WHERE source.value->>'status' <> 'fetched') OR
     p_scheduled_local_date IS NULL OR extract(day FROM p_scheduled_local_date) <> 1 OR
     pg_column_size(p_provider_facts_json) > 2097152 OR
     pg_column_size(p_legal_rules_json) > 1048576 OR
     pg_column_size(p_source_receipts_json) > 524288 THEN
    RAISE EXCEPTION 'invalid_provider_catalog_version';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.ds_provider_catalog_refresh_runs
    WHERE scheduled_local_date = p_scheduled_local_date AND status = 'completed'
      AND catalog_version <> p_catalog_version
  ) THEN
    RAISE EXCEPTION 'provider_catalog_refresh_already_completed';
  END IF;

  INSERT INTO public.ds_provider_catalog_versions(
    catalog_version, provider_facts_json, legal_rules_json, source_receipts_json
  ) VALUES (
    p_catalog_version, p_provider_facts_json, p_legal_rules_json, p_source_receipts_json
  ) ON CONFLICT (catalog_version) DO NOTHING;

  SELECT * INTO existing_version FROM public.ds_provider_catalog_versions
  WHERE catalog_version = p_catalog_version;
  IF existing_version.provider_facts_json <> p_provider_facts_json OR
     existing_version.legal_rules_json <> p_legal_rules_json OR
     existing_version.source_receipts_json <> p_source_receipts_json THEN
    RAISE EXCEPTION 'provider_catalog_version_collision';
  END IF;

  INSERT INTO public.ds_provider_catalog_active(singleton, catalog_version, activated_at)
  VALUES (true, p_catalog_version, now())
  ON CONFLICT (singleton) DO UPDATE SET catalog_version = EXCLUDED.catalog_version,
    activated_at = EXCLUDED.activated_at;

  INSERT INTO public.ds_provider_catalog_refresh_runs(
    scheduled_local_date, status, catalog_version, source_receipts_json, failure_code, completed_at
  ) VALUES (p_scheduled_local_date, 'completed', p_catalog_version, p_source_receipts_json, NULL, now())
  ON CONFLICT (scheduled_local_date) DO UPDATE SET status = 'completed',
    catalog_version = EXCLUDED.catalog_version, failure_code = NULL,
    source_receipts_json = EXCLUDED.source_receipts_json, completed_at = EXCLUDED.completed_at;
  RETURN p_catalog_version;
END;
$$;

CREATE FUNCTION public.ds_seed_provider_catalog_version(
  p_catalog_version text,
  p_provider_facts_json jsonb,
  p_legal_rules_json jsonb,
  p_source_receipts_json jsonb
) RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  existing_version public.ds_provider_catalog_versions%ROWTYPE;
  active_version text;
BEGIN
  IF p_catalog_version IS NULL OR p_catalog_version !~ '^[a-f0-9]{64}$' OR
     p_provider_facts_json IS NULL OR jsonb_typeof(p_provider_facts_json) <> 'array' OR jsonb_array_length(p_provider_facts_json) > 300 OR
     p_legal_rules_json IS NULL OR jsonb_typeof(p_legal_rules_json) <> 'array' OR jsonb_array_length(p_legal_rules_json) > 200 OR
     p_source_receipts_json IS NULL OR NOT public.ds_valid_provider_catalog_sources(p_source_receipts_json) OR
     jsonb_array_length(p_source_receipts_json) = 0 OR
     EXISTS (SELECT 1 FROM jsonb_array_elements(p_source_receipts_json) AS source(value)
       WHERE source.value->>'status' <> 'seeded') OR
     pg_column_size(p_provider_facts_json) > 2097152 OR pg_column_size(p_legal_rules_json) > 1048576 OR
     pg_column_size(p_source_receipts_json) > 524288 THEN
    RAISE EXCEPTION 'invalid_provider_catalog_seed';
  END IF;
  INSERT INTO public.ds_provider_catalog_versions(
    catalog_version, provider_facts_json, legal_rules_json, source_receipts_json
  ) VALUES (p_catalog_version, p_provider_facts_json, p_legal_rules_json, p_source_receipts_json)
  ON CONFLICT (catalog_version) DO NOTHING;
  SELECT * INTO existing_version FROM public.ds_provider_catalog_versions
  WHERE catalog_version = p_catalog_version;
  IF existing_version.provider_facts_json <> p_provider_facts_json OR
     existing_version.legal_rules_json <> p_legal_rules_json OR
     existing_version.source_receipts_json <> p_source_receipts_json THEN
    RAISE EXCEPTION 'provider_catalog_version_collision';
  END IF;
  INSERT INTO public.ds_provider_catalog_active(singleton, catalog_version)
  VALUES (true, p_catalog_version) ON CONFLICT (singleton) DO NOTHING;
  SELECT catalog_version INTO active_version FROM public.ds_provider_catalog_active WHERE singleton = true;
  RETURN active_version;
END;
$$;

CREATE FUNCTION public.ds_fail_provider_catalog_refresh(
  p_scheduled_local_date date,
  p_failure_code text,
  p_source_receipts_json jsonb
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF p_scheduled_local_date IS NULL OR extract(day FROM p_scheduled_local_date) <> 1 OR
     p_failure_code IS NULL OR p_failure_code !~ '^[a-z][a-z0-9_]{0,63}$' OR
     p_source_receipts_json IS NULL OR NOT public.ds_valid_provider_catalog_sources(p_source_receipts_json) THEN
    RAISE EXCEPTION 'invalid_provider_catalog_refresh_failure';
  END IF;
  INSERT INTO public.ds_provider_catalog_refresh_runs(
    scheduled_local_date, status, source_receipts_json, failure_code, completed_at
  ) VALUES (p_scheduled_local_date, 'failed', p_source_receipts_json, p_failure_code, now())
  ON CONFLICT (scheduled_local_date) DO UPDATE SET status = 'failed',
    source_receipts_json = EXCLUDED.source_receipts_json, failure_code = EXCLUDED.failure_code,
    completed_at = EXCLUDED.completed_at
  WHERE public.ds_provider_catalog_refresh_runs.status <> 'completed';
END;
$$;

CREATE TABLE public.ds_scan_provider_catalog_versions (
  run_id uuid PRIMARY KEY REFERENCES public.ds_scan_runs(id) ON DELETE CASCADE,
  catalog_version text NOT NULL REFERENCES public.ds_provider_catalog_versions(catalog_version),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TRIGGER ds_scan_provider_catalog_versions_immutable
  BEFORE UPDATE OR DELETE ON public.ds_scan_provider_catalog_versions
  FOR EACH ROW EXECUTE FUNCTION public.ds_reject_report_mutation();

CREATE FUNCTION public.ds_complete_scan_with_provider_catalog(
  p_job_id uuid, p_lease_token uuid, p_completed_at timestamptz, p_scanner_version text,
  p_started_at timestamptz, p_verdict text, p_scope_json jsonb, p_checks_json jsonb,
  p_metrics_json jsonb, p_privacy_assessment_json jsonb, p_processor_transparency_json jsonb,
  p_internal_audit_summary_json jsonb, p_public_policy_json jsonb,
  p_public_service_comparison_json jsonb, p_legal_cookie_findings_json jsonb,
  p_provider_catalog_version text
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  report_id uuid;
BEGIN
  IF p_provider_catalog_version IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.ds_provider_catalog_versions
    WHERE catalog_version = p_provider_catalog_version
  ) THEN
    RAISE EXCEPTION 'provider_catalog_version_not_found';
  END IF;
  report_id := public.ds_complete_scan_with_legal_cookie_findings(
    p_job_id, p_lease_token, p_completed_at, p_scanner_version, p_started_at,
    p_verdict, p_scope_json, p_checks_json, p_metrics_json, p_privacy_assessment_json,
    p_processor_transparency_json, p_internal_audit_summary_json, p_public_policy_json,
    p_public_service_comparison_json, p_legal_cookie_findings_json
  );
  IF p_provider_catalog_version IS NOT NULL THEN
    INSERT INTO public.ds_scan_provider_catalog_versions(run_id, catalog_version)
    VALUES (report_id, p_provider_catalog_version);
  END IF;
  RETURN report_id;
END;
$$;

REVOKE ALL ON public.ds_provider_catalog_versions, public.ds_provider_catalog_active,
  public.ds_provider_catalog_refresh_runs, public.ds_scan_provider_catalog_versions FROM PUBLIC;
REVOKE ALL ON FUNCTION public.ds_valid_provider_catalog_sources(jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.ds_begin_provider_catalog_refresh(date) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.ds_activate_provider_catalog_version(text, jsonb, jsonb, jsonb, date) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.ds_seed_provider_catalog_version(text, jsonb, jsonb, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.ds_fail_provider_catalog_refresh(date, text, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.ds_complete_scan_with_provider_catalog(
  uuid, uuid, timestamptz, text, timestamptz, text, jsonb, jsonb, jsonb,
  jsonb, jsonb, jsonb, jsonb, jsonb, jsonb, text
) FROM PUBLIC;
