CREATE TABLE public.ds_beta_certifications (
  hostname text PRIMARY KEY REFERENCES public.ds_domains(hostname) ON DELETE CASCADE,
  policy_version text NOT NULL CHECK (policy_version = 'beta-0.1'),
  state text NOT NULL CHECK (state IN ('pending', 'active', 'suspended')),
  latest_report_id uuid REFERENCES public.ds_scan_runs(id) ON DELETE SET NULL,
  certified_report_id uuid REFERENCES public.ds_scan_runs(id) ON DELETE SET NULL,
  latest_assessment_status text NOT NULL CHECK (latest_assessment_status IN ('eligible', 'pending', 'blocked')),
  latest_assessment jsonb NOT NULL,
  state_reason text NOT NULL,
  last_checked_at timestamptz NOT NULL,
  activated_at timestamptz,
  suspended_at timestamptz
);

CREATE TABLE public.ds_beta_certification_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hostname text NOT NULL REFERENCES public.ds_beta_certifications(hostname) ON DELETE CASCADE,
  from_state text CHECK (from_state IS NULL OR from_state IN ('pending', 'active', 'suspended')),
  to_state text NOT NULL CHECK (to_state IN ('pending', 'active', 'suspended')),
  report_id uuid REFERENCES public.ds_scan_runs(id) ON DELETE SET NULL,
  reason_code text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE OR REPLACE FUNCTION public.ds_sync_beta_certification(p_report_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  report public.ds_scan_runs%ROWTYPE;
  current_cert public.ds_beta_certifications%ROWTYPE;
  categories jsonb;
  assessment jsonb;
  assessed_count integer;
  score integer;
  has_critical_failure boolean;
  eligibility text;
  next_state text;
  reason_code text;
  had_certification boolean;
BEGIN
  SELECT * INTO report FROM public.ds_scan_runs WHERE id = p_report_id;
  IF NOT FOUND OR report.profile_version NOT IN ('domain-v1', 'domain-v2', 'domain-v3') THEN
    RETURN;
  END IF;

  WITH definitions(id, label, weight, critical, controls) AS (
    VALUES
      ('transport-security', 'Seguridad TLS', 40, true, ARRAY['DS-TLS-01', 'DS-TLS-02']::text[]),
      ('security-headers', 'Cabeceras de seguridad', 30, false, ARRAY['DS-HDR-01']::text[]),
      ('privacy-cookies', 'Cookies y privacidad observable', 30, false, ARRAY['DS-PRIV-05']::text[])
  ), derived AS (
    SELECT definitions.id, definitions.label, definitions.weight, definitions.critical,
      CASE
        WHEN bool_or(results.status = 'fail') THEN 'fail'
        WHEN count(results.control_id) < cardinality(definitions.controls)
          OR bool_or(results.status = 'unknown') THEN 'unknown'
        ELSE 'pass'
      END AS status
    FROM definitions
    LEFT JOIN public.ds_check_results AS results
      ON results.run_id = p_report_id AND results.control_id = ANY(definitions.controls)
    GROUP BY definitions.id, definitions.label, definitions.weight,
      definitions.critical, definitions.controls
  )
  SELECT jsonb_agg(jsonb_build_object('id', id, 'label', label, 'weight', weight, 'status', status) ORDER BY id),
    count(*) FILTER (WHERE status <> 'unknown')::integer,
    bool_or(critical AND status = 'fail'),
    CASE WHEN sum(weight) FILTER (WHERE status <> 'unknown') = 0 THEN NULL
      ELSE round(100.0 * sum(weight) FILTER (WHERE status = 'pass') /
        sum(weight) FILTER (WHERE status <> 'unknown'))::integer END
  INTO categories, assessed_count, has_critical_failure, score
  FROM derived;

  IF has_critical_failure THEN
    eligibility := 'blocked';
  ELSIF assessed_count < 3 OR score IS NULL THEN
    eligibility := 'pending';
  ELSIF score >= 90 THEN
    eligibility := 'eligible';
  ELSE
    eligibility := 'blocked';
  END IF;

  assessment := jsonb_build_object(
    'policyVersion', 'beta-0.1', 'threshold', 90, 'score', score,
    'eligibility', eligibility, 'assessedCategories', assessed_count,
    'totalCategories', 3, 'categories', categories
  );

  SELECT * INTO current_cert
  FROM public.ds_beta_certifications
  WHERE hostname = report.hostname AND policy_version = 'beta-0.1'
  FOR UPDATE;
  had_certification := FOUND;

  IF eligibility = 'eligible' THEN
    next_state := 'active';
    reason_code := 'eligible_assessment';
  ELSIF eligibility = 'blocked' AND had_certification AND current_cert.state = 'active' THEN
    next_state := 'suspended';
    reason_code := 'blocked_assessment';
  ELSIF NOT had_certification THEN
    next_state := 'pending';
    reason_code := CASE WHEN eligibility = 'blocked' THEN 'initial_blocked_assessment' ELSE 'insufficient_evidence' END;
  ELSE
    next_state := current_cert.state;
    reason_code := CASE WHEN eligibility = 'blocked' THEN 'blocked_while_not_active' ELSE 'insufficient_evidence_while_certified' END;
  END IF;

  INSERT INTO public.ds_beta_certifications(
    hostname, policy_version, state, latest_report_id, certified_report_id,
    latest_assessment_status, latest_assessment, state_reason,
    last_checked_at, activated_at, suspended_at
  ) VALUES (
    report.hostname, 'beta-0.1', next_state, report.id,
    CASE WHEN eligibility = 'eligible' THEN report.id ELSE NULL END,
    eligibility, assessment, reason_code, report.completed_at,
    CASE WHEN next_state = 'active' THEN report.completed_at ELSE NULL END,
    CASE WHEN next_state = 'suspended' THEN report.completed_at ELSE NULL END
  )
  ON CONFLICT(hostname) DO UPDATE SET
    latest_report_id = EXCLUDED.latest_report_id,
    certified_report_id = CASE WHEN EXCLUDED.latest_assessment_status = 'eligible'
      THEN EXCLUDED.certified_report_id ELSE ds_beta_certifications.certified_report_id END,
    latest_assessment_status = EXCLUDED.latest_assessment_status,
    latest_assessment = EXCLUDED.latest_assessment,
    state_reason = EXCLUDED.state_reason,
    state = EXCLUDED.state,
    last_checked_at = EXCLUDED.last_checked_at,
    activated_at = CASE WHEN EXCLUDED.state = 'active'
      THEN COALESCE(ds_beta_certifications.activated_at, EXCLUDED.activated_at)
      ELSE ds_beta_certifications.activated_at END,
    suspended_at = CASE WHEN EXCLUDED.state = 'suspended'
      THEN EXCLUDED.suspended_at ELSE ds_beta_certifications.suspended_at END;

  IF NOT had_certification OR current_cert.state IS DISTINCT FROM next_state THEN
    INSERT INTO public.ds_beta_certification_events(hostname, from_state, to_state, report_id, reason_code)
    VALUES (report.hostname, CASE WHEN had_certification THEN current_cert.state ELSE NULL END,
      next_state, report.id, reason_code);
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.ds_sync_beta_certification_after_check()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  PERFORM public.ds_sync_beta_certification(NEW.run_id);
  RETURN NULL;
END;
$$;

CREATE CONSTRAINT TRIGGER ds_sync_beta_certification_after_checks
AFTER INSERT ON public.ds_check_results
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION public.ds_sync_beta_certification_after_check();

REVOKE ALL ON public.ds_beta_certifications, public.ds_beta_certification_events FROM PUBLIC;
REVOKE ALL ON FUNCTION public.ds_sync_beta_certification(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.ds_sync_beta_certification_after_check() FROM PUBLIC;
