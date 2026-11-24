CREATE OR REPLACE FUNCTION public.ds_valid_provider_discovery(p_discovery jsonb)
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
  evidence_key_count integer;
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
  evidence_key_count := public.ds_public_policy_object_key_count(evidence);
  IF jsonb_typeof(evidence) <> 'object' OR
     NOT (evidence ?& ARRAY['kind', 'sourceId', 'title', 'url', 'capturedAt', 'excerpt']) OR
     evidence_key_count NOT IN (6, 7, 8) OR
     (evidence_key_count = 7 AND NOT (evidence ? 'destinationHostname' OR evidence ? 'destinationPath')) OR
     (evidence_key_count = 8 AND NOT (evidence ?& ARRAY['destinationHostname', 'destinationPath'])) OR
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
       evidence_key_count NOT IN (7, 8) OR
       NOT (evidence ? 'destinationHostname') OR
       COALESCE(evidence->>'destinationHostname', '') !~ '^(?=.{1,253}$)[a-z0-9.-]+$' OR
       (evidence ? 'destinationPath' AND (
         COALESCE(evidence->>'destinationPath', '') !~ '^/[^?#[:space:][:cntrl:]]*$' OR
         length(evidence->>'destinationPath') > 512
       ))
     )) OR
     (evidence->>'kind' = 'explicit_site_reference' AND evidence_key_count <> 6) THEN
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
