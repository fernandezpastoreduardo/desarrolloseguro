CREATE FUNCTION public.ds_add_provider_catalog_discovery_evidence_version(
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
  provider_id text;
  base_provider jsonb;
  merged_provider jsonb;
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
     jsonb_array_length(p_provider_facts_json) <> jsonb_array_length(base_version.provider_facts_json) OR
     jsonb_array_length(p_provider_facts_json) > 300 OR pg_column_size(p_provider_facts_json) > 2097152 OR
     p_legal_rules_json IS DISTINCT FROM base_version.legal_rules_json OR
     p_source_receipts_json IS NULL OR NOT public.ds_valid_provider_catalog_sources(p_source_receipts_json) OR
     jsonb_array_length(p_source_receipts_json) > 500 OR pg_column_size(p_source_receipts_json) > 524288 OR
     p_discovery_json IS NULL OR NOT public.ds_valid_provider_discovery(p_discovery_json) THEN
    RAISE EXCEPTION 'invalid_provider_catalog_discovery_merge';
  END IF;

  provider_id := p_discovery_json->>'providerId';
  IF (SELECT count(*) FROM jsonb_array_elements(base_version.provider_facts_json) AS provider(value)
      WHERE value->>'providerId' = provider_id) <> 1 THEN
    RAISE EXCEPTION 'provider_catalog_discovery_provider_identity_invalid';
  END IF;
  SELECT value INTO base_provider
  FROM jsonb_array_elements(base_version.provider_facts_json) AS provider(value)
  WHERE value->>'providerId' = provider_id;
  SELECT value INTO merged_provider
  FROM jsonb_array_elements(p_provider_facts_json) AS provider(value)
  WHERE value->>'providerId' = provider_id;
  IF base_provider IS NULL OR merged_provider IS NULL OR
     (SELECT count(*) FROM jsonb_array_elements(p_provider_facts_json) AS provider(value)
      WHERE value->>'providerId' = provider_id) <> 1 OR
     NOT ((merged_provider - 'documentationStatus') @> (base_provider - 'documentationStatus')) OR
     NOT (merged_provider->'discoveryEvidence' @> jsonb_build_array(p_discovery_json->'evidence')) OR
     NOT (p_source_receipts_json @> base_version.source_receipts_json) OR
     EXISTS (
       SELECT 1 FROM jsonb_array_elements(base_version.provider_facts_json) AS old_provider(value)
       WHERE old_provider.value->>'providerId' <> provider_id AND NOT EXISTS (
         SELECT 1 FROM jsonb_array_elements(p_provider_facts_json) AS new_provider(value)
         WHERE new_provider.value = old_provider.value
       )
     ) OR
     EXISTS (
       SELECT 1 FROM jsonb_array_elements(p_provider_facts_json) AS new_provider(value)
       WHERE new_provider.value->>'providerId' <> provider_id AND NOT EXISTS (
         SELECT 1 FROM jsonb_array_elements(base_version.provider_facts_json) AS old_provider(value)
         WHERE old_provider.value = new_provider.value
       )
     ) THEN
    RAISE EXCEPTION 'provider_catalog_discovery_merge_snapshot_mismatch';
  END IF;

  IF EXISTS (
    SELECT 1 FROM jsonb_array_elements(p_discovery_json->'officialDocuments') AS document(value)
    WHERE NOT EXISTS (
      SELECT 1 FROM jsonb_array_elements(merged_provider->'officialDocuments') AS saved_document(value)
      WHERE saved_document.value->>'documentId' = document.value->>'documentId' AND
        saved_document.value->>'title' = document.value->>'title' AND
        saved_document.value->>'url' = document.value->>'url'
    ) OR NOT EXISTS (
      SELECT 1 FROM jsonb_array_elements(p_source_receipts_json) AS receipt(value)
      WHERE receipt.value->>'providerId' = provider_id AND
        receipt.value->>'documentId' = document.value->>'documentId' AND
        receipt.value->>'title' = document.value->>'title' AND
        receipt.value->>'url' = document.value->>'url' AND
        receipt.value->>'status' = document.value->>'status' AND
        receipt.value->>'sha256' IS NOT DISTINCT FROM document.value->>'sha256'
    )
  ) THEN
    RAISE EXCEPTION 'provider_catalog_discovery_merge_document_mismatch';
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
    p_catalog_version, provider_id, p_discovery_json->>'documentationStatus', p_discovery_json
  );
  RETURN p_catalog_version;
END;
$$;

REVOKE ALL ON FUNCTION public.ds_add_provider_catalog_discovery_evidence_version(
  text, text, jsonb, jsonb, jsonb, jsonb
) FROM PUBLIC;
