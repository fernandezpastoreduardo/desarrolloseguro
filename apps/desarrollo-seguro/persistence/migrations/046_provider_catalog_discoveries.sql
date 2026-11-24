CREATE FUNCTION public.ds_valid_provider_discovery(p_discovery jsonb)
RETURNS boolean
LANGUAGE plpgsql
IMMUTABLE
STRICT
PARALLEL SAFE
SET search_path = pg_catalog, public
AS $$
DECLARE
  evidence jsonb;
  document jsonb;
  document_count integer;
  fetched_count integer := 0;
  event_status text;
BEGIN
  IF jsonb_typeof(p_discovery) <> 'object' OR
     public.ds_public_policy_object_key_count(p_discovery) <> 7 OR
     NOT (p_discovery ?& ARRAY['providerId', 'displayName', 'aliases', 'products', 'evidence', 'officialDocuments', 'documentationStatus']) OR
     jsonb_typeof(p_discovery->'providerId') <> 'string' OR COALESCE(p_discovery->>'providerId', '') !~ '^[a-z0-9][a-z0-9_-]{0,31}$' OR
     jsonb_typeof(p_discovery->'displayName') <> 'string' OR length(p_discovery->>'displayName') NOT BETWEEN 1 AND 120 OR
     jsonb_typeof(p_discovery->'aliases') <> 'array' OR jsonb_array_length(p_discovery->'aliases') > 20 OR
     jsonb_typeof(p_discovery->'products') <> 'array' OR jsonb_array_length(p_discovery->'products') > 20 OR
     jsonb_typeof(p_discovery->'officialDocuments') <> 'array' OR jsonb_array_length(p_discovery->'officialDocuments') > 30 OR
     jsonb_typeof(p_discovery->'documentationStatus') <> 'string' OR
     p_discovery->>'documentationStatus' NOT IN ('located', 'source_unavailable', 'source_not_localized') OR
     pg_column_size(p_discovery) > 65536 THEN
    RETURN false;
  END IF;

  IF EXISTS (
    SELECT 1 FROM jsonb_array_elements(p_discovery->'aliases') AS alias(value)
    WHERE jsonb_typeof(alias.value) <> 'string' OR length(alias.value#>>'{}') NOT BETWEEN 1 AND 80
  ) OR EXISTS (
    SELECT 1 FROM jsonb_array_elements(p_discovery->'products') AS product(value)
    WHERE jsonb_typeof(product.value) <> 'string' OR length(product.value#>>'{}') NOT BETWEEN 1 AND 120
  ) THEN
    RETURN false;
  END IF;

  evidence := p_discovery->'evidence';
  IF jsonb_typeof(evidence) <> 'object' OR
     NOT (
       evidence ?& ARRAY['kind', 'sourceId', 'title', 'url', 'capturedAt', 'excerpt'] AND
       (public.ds_public_policy_object_key_count(evidence) = 6 OR
        public.ds_public_policy_object_key_count(evidence) = 8 AND
        evidence ?& ARRAY['destinationHostname', 'destinationPath'])
     ) OR
     jsonb_typeof(evidence->'kind') <> 'string' OR
     evidence->>'kind' NOT IN ('explicit_site_reference', 'observed_destination') OR
     COALESCE(evidence->>'sourceId', '') !~ '^[a-z0-9][a-z0-9_-]{0,95}$' OR
     jsonb_typeof(evidence->'title') <> 'string' OR length(evidence->>'title') NOT BETWEEN 1 AND 200 OR
     jsonb_typeof(evidence->'url') <> 'string' OR length(evidence->>'url') > 2048 OR
     COALESCE(evidence->>'url', '') !~ '^https://[^/:@?#[:space:]]+(?:/[^?#[:space:]]*)?$' OR
     jsonb_typeof(evidence->'capturedAt') <> 'string' OR
     (evidence->>'capturedAt')::timestamptz IS NULL OR
     jsonb_typeof(evidence->'excerpt') <> 'string' OR length(evidence->>'excerpt') NOT BETWEEN 1 AND 500 OR
     evidence->>'excerpt' ~* '[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}' OR
     (evidence->>'kind' = 'observed_destination' AND (
       public.ds_public_policy_object_key_count(evidence) <> 8 OR
       COALESCE(evidence->>'destinationHostname', '') !~ '^(?=.{1,253}$)[a-z0-9.-]+$' OR
       COALESCE(evidence->>'destinationPath', '') !~ '^/[^?#[:space:][:cntrl:]]*$' OR
       length(evidence->>'destinationPath') > 512
     )) OR
     (evidence->>'kind' = 'explicit_site_reference' AND public.ds_public_policy_object_key_count(evidence) <> 6) THEN
    RETURN false;
  END IF;

  document_count := jsonb_array_length(p_discovery->'officialDocuments');
  FOR document IN SELECT value FROM jsonb_array_elements(p_discovery->'officialDocuments') LOOP
    IF jsonb_typeof(document) <> 'object' OR public.ds_public_policy_object_key_count(document) <> 8 OR
       NOT (document ?& ARRAY['documentId', 'kind', 'title', 'url', 'discoveryMethod', 'status', 'sha256', 'checkedAt']) OR
       COALESCE(document->>'documentId', '') !~ '^[a-z0-9][a-z0-9_-]{0,95}$' OR
       jsonb_typeof(document->'kind') <> 'string' OR
       document->>'kind' NOT IN ('privacy', 'cookies', 'terms', 'legal', 'service', 'technical') OR
       jsonb_typeof(document->'title') <> 'string' OR length(document->>'title') NOT BETWEEN 1 AND 240 OR
       jsonb_typeof(document->'url') <> 'string' OR length(document->>'url') > 2048 OR
       COALESCE(document->>'url', '') !~ '^https://[^/:@?#[:space:]]+(?:/[^?#[:space:]]*)?(?:\?[^#[:space:]]*)?$' OR
       jsonb_typeof(document->'discoveryMethod') <> 'string' OR
       document->>'discoveryMethod' NOT IN ('audited_site_link', 'known_official_catalog') OR
       jsonb_typeof(document->'status') <> 'string' OR
       document->>'status' NOT IN ('fetched', 'unavailable', 'failed') OR
       (document->>'status' = 'fetched' AND COALESCE(document->>'sha256', '') !~ '^[a-f0-9]{64}$') OR
       (document->>'status' <> 'fetched' AND document->>'sha256' IS NOT NULL) OR
       jsonb_typeof(document->'checkedAt') <> 'string' OR
       (document->>'checkedAt')::timestamptz IS NULL THEN
      RETURN false;
    END IF;
    IF document->>'status' = 'fetched' THEN fetched_count := fetched_count + 1; END IF;
  END LOOP;

  event_status := p_discovery->>'documentationStatus';
  IF (document_count = 0 AND event_status <> 'source_not_localized') OR
     (document_count > 0 AND fetched_count = 0 AND event_status <> 'source_unavailable') OR
     (fetched_count > 0 AND event_status <> 'located') THEN
    RETURN false;
  END IF;
  RETURN true;
EXCEPTION WHEN OTHERS THEN
  RETURN false;
END;
$$;

CREATE TABLE public.ds_provider_catalog_discoveries (
  discovery_id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  catalog_version text NOT NULL REFERENCES public.ds_provider_catalog_versions(catalog_version),
  provider_id text NOT NULL CHECK (provider_id ~ '^[a-z0-9][a-z0-9_-]{0,31}$'),
  documentation_status text NOT NULL CHECK (
    documentation_status IN ('located', 'source_unavailable', 'source_not_localized')
  ),
  discovery_json jsonb NOT NULL CHECK (
    public.ds_valid_provider_discovery(discovery_json) AND pg_column_size(discovery_json) <= 65536
  ),
  discovered_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (catalog_version, provider_id)
);

CREATE TRIGGER ds_provider_catalog_discoveries_immutable
  BEFORE UPDATE OR DELETE ON public.ds_provider_catalog_discoveries
  FOR EACH ROW EXECUTE FUNCTION public.ds_reject_report_mutation();

CREATE FUNCTION public.ds_add_provider_catalog_discovery_version(
  p_expected_active_version text,
  p_catalog_version text,
  p_provider_facts_json jsonb,
  p_legal_rules_json jsonb,
  p_source_receipts_json jsonb,
  p_discovery_json jsonb
) RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  active_version text;
  base_version public.ds_provider_catalog_versions%ROWTYPE;
  existing_version public.ds_provider_catalog_versions%ROWTYPE;
  discovered_provider_id text;
BEGIN
  SELECT catalog_version INTO active_version
  FROM public.ds_provider_catalog_active WHERE singleton = true FOR UPDATE;
  IF active_version IS DISTINCT FROM p_expected_active_version THEN
    RAISE EXCEPTION 'provider_catalog_active_version_changed';
  END IF;
  SELECT * INTO base_version FROM public.ds_provider_catalog_versions
  WHERE catalog_version = active_version;
  IF NOT FOUND OR p_catalog_version IS NULL OR p_catalog_version !~ '^[a-f0-9]{64}$' OR
     p_provider_facts_json IS NULL OR jsonb_typeof(p_provider_facts_json) <> 'array' OR
     jsonb_array_length(p_provider_facts_json) > 300 OR pg_column_size(p_provider_facts_json) > 2097152 OR
     p_legal_rules_json IS DISTINCT FROM base_version.legal_rules_json OR
     p_source_receipts_json IS NULL OR NOT public.ds_valid_provider_catalog_sources(p_source_receipts_json) OR
     jsonb_array_length(p_source_receipts_json) > 500 OR pg_column_size(p_source_receipts_json) > 524288 OR
     p_discovery_json IS NULL OR NOT public.ds_valid_provider_discovery(p_discovery_json) THEN
    RAISE EXCEPTION 'invalid_provider_catalog_discovery';
  END IF;

  discovered_provider_id := p_discovery_json->>'providerId';
  IF NOT (p_provider_facts_json @> base_version.provider_facts_json) OR
     NOT (p_source_receipts_json @> base_version.source_receipts_json) OR
     NOT EXISTS (
       SELECT 1 FROM jsonb_array_elements(p_provider_facts_json) AS provider(value)
       WHERE provider.value->>'providerId' = discovered_provider_id AND
         provider.value->>'documentationStatus' = p_discovery_json->>'documentationStatus' AND
         provider.value->'discoveryEvidence' @> jsonb_build_array(p_discovery_json->'evidence')
     ) OR
     NOT EXISTS (
       SELECT 1 FROM jsonb_array_elements(p_provider_facts_json) AS provider(value)
       WHERE provider.value->>'providerId' = discovered_provider_id
     ) OR
     EXISTS (
       SELECT 1 FROM jsonb_array_elements(p_discovery_json->'officialDocuments') AS document(value)
       WHERE NOT EXISTS (
         SELECT 1 FROM jsonb_array_elements(p_source_receipts_json) AS receipt(value)
         WHERE receipt.value->>'providerId' = discovered_provider_id AND
           receipt.value->>'documentId' = document.value->>'documentId' AND
           receipt.value->>'url' = document.value->>'url' AND
           receipt.value->>'status' = document.value->>'status' AND
           receipt.value->>'sha256' IS NOT DISTINCT FROM document.value->>'sha256'
       )
     ) THEN
    RAISE EXCEPTION 'provider_catalog_discovery_snapshot_mismatch';
  END IF;
  IF EXISTS (
    SELECT 1 FROM jsonb_array_elements(base_version.provider_facts_json) AS provider(value)
    WHERE provider.value->>'providerId' = discovered_provider_id
  ) THEN
    RAISE EXCEPTION 'provider_catalog_provider_already_known';
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
  INSERT INTO public.ds_provider_catalog_discoveries(
    catalog_version, provider_id, documentation_status, discovery_json
  ) VALUES (
    p_catalog_version, discovered_provider_id, p_discovery_json->>'documentationStatus', p_discovery_json
  );
  RETURN p_catalog_version;
END;
$$;

REVOKE ALL ON public.ds_provider_catalog_discoveries FROM PUBLIC;
REVOKE ALL ON FUNCTION public.ds_valid_provider_discovery(jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.ds_add_provider_catalog_discovery_version(
  text, text, jsonb, jsonb, jsonb, jsonb
) FROM PUBLIC;
