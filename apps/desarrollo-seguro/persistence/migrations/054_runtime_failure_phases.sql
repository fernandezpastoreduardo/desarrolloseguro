CREATE OR REPLACE FUNCTION public.ds_fail_scan(
  p_job_id uuid,
  p_lease_token uuid,
  p_failure_code text,
  p_max_attempts integer,
  p_failure_diagnostic jsonb
) RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  current_job public.ds_scan_jobs%ROWTYPE;
  next_state text;
  diagnostic_probe jsonb;
  seen_probe_operations text[] := ARRAY[]::text[];
BEGIN
  IF p_max_attempts IS NULL OR p_max_attempts < 1 OR p_max_attempts > 10 THEN
    RAISE EXCEPTION 'invalid_scan_max_attempts';
  END IF;
  IF p_failure_code IS NULL OR p_failure_code NOT IN (
    'coordinator_unavailable', 'coordinator_socket_untrusted', 'runtime_volume_failed',
    'broker_failed', 'egress_failed', 'executor_failed', 'transport_failed'
  ) THEN
    RAISE EXCEPTION 'invalid_scan_failure_code';
  END IF;
  IF p_failure_diagnostic IS NOT NULL THEN
    IF jsonb_typeof(p_failure_diagnostic) <> 'object'
      OR NOT (p_failure_diagnostic ? 'stage')
      OR NOT (p_failure_diagnostic ? 'code')
      OR p_failure_diagnostic - 'stage' - 'code' - 'probeFailures' <> '{}'::jsonb
      OR p_failure_diagnostic->>'stage' NOT IN (
        'volume_create', 'volume_prepare', 'broker_start', 'broker_ready', 'executor',
        'executor_container_cleanup', 'broker_container_cleanup', 'volume_cleanup',
        'privacy_browser_observation', 'privacy_assessment', 'cookie_legal_findings',
        'service_comparison', 'first_entry_policy_access', 'response_validation'
      )
      OR p_failure_diagnostic->>'code' NOT IN (
        'docker_runtime_command_failed', 'docker_runtime_unavailable', 'docker_command_timeout',
        'docker_command_output_too_large', 'docker_daemon_unavailable', 'docker_permission_denied',
        'docker_resource_in_use', 'docker_removal_in_progress', 'runtime_coordinator_unavailable',
        'runtime_coordinator_socket_untrusted', 'executor_response_invalid', 'executor_result_invalid',
        'executor_application_failed', 'runtime_broker_process_error', 'runtime_broker_process_exited',
        'runtime_broker_process_killed', 'runtime_broker_container_start_failed',
        'runtime_broker_entrypoint_failed', 'runtime_broker_application_failed',
        'runtime_broker_ready_timeout', 'runtime_broker_ready_failed', 'runtime_volume_create_failed',
        'runtime_volume_prepare_failed', 'runtime_broker_start_failed', 'runtime_cleanup_retry',
        'runtime_cleanup_failed', 'runtime_execution_timeout', 'executor_response_too_large'
      )
      OR length(p_failure_diagnostic::text) > 2048 THEN
      RAISE EXCEPTION 'invalid_scan_failure_diagnostic';
    END IF;
    IF p_failure_diagnostic ? 'probeFailures' THEN
      IF jsonb_typeof(p_failure_diagnostic->'probeFailures') <> 'array'
        OR jsonb_array_length(p_failure_diagnostic->'probeFailures') NOT BETWEEN 1 AND 5 THEN
        RAISE EXCEPTION 'invalid_scan_failure_diagnostic';
      END IF;
      FOR diagnostic_probe IN SELECT value FROM jsonb_array_elements(p_failure_diagnostic->'probeFailures') LOOP
        IF jsonb_typeof(diagnostic_probe) <> 'object'
          OR NOT (diagnostic_probe ? 'operation')
          OR NOT (diagnostic_probe ? 'code')
          OR diagnostic_probe - 'operation' - 'code' <> '{}'::jsonb
          OR diagnostic_probe->>'operation' NOT IN ('dns', 'tls', 'http-head', 'http-get', 'headers')
          OR diagnostic_probe->>'code' NOT IN (
            'dns_resolution_failed', 'connection_failed', 'broker_failed', 'request_aborted',
            'request_timeout', 'response_size_limit_exceeded', 'https_request_failed',
            'http_request_failed', 'invalid_http_response', 'redirect_limit_exceeded',
            'redirect_origin_not_allowlisted', 'redirect_path_not_allowlisted',
            'tls_certificate_invalid', 'tls_handshake_failed', 'transport_failed',
            'probe_unavailable', 'empty_evidence'
          ) THEN
          RAISE EXCEPTION 'invalid_scan_failure_diagnostic';
        END IF;
        IF diagnostic_probe->>'operation' = ANY(seen_probe_operations) THEN
          RAISE EXCEPTION 'invalid_scan_failure_diagnostic';
        END IF;
        seen_probe_operations := array_append(seen_probe_operations, diagnostic_probe->>'operation');
      END LOOP;
    END IF;
  END IF;

  SELECT * INTO current_job FROM public.ds_scan_jobs
  WHERE id = p_job_id AND state = 'running' AND lease_token = p_lease_token
    AND lease_until > clock_timestamp()
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'scan_lease_lost';
  END IF;

  next_state := CASE WHEN current_job.attempts >= p_max_attempts
    THEN 'failed' ELSE 'retrying' END;
  UPDATE public.ds_scan_jobs
  SET state = CASE WHEN next_state = 'failed' THEN 'failed' ELSE 'queued' END,
      available_at = CASE WHEN next_state = 'failed' THEN available_at
        ELSE clock_timestamp() + LEAST(60, power(2, current_job.attempts - 1)) * interval '1 second' END,
      lease_until = NULL,
      lease_token = NULL,
      finished_at = CASE WHEN next_state = 'failed' THEN clock_timestamp() ELSE NULL END,
      public_error_code = CASE WHEN next_state = 'failed' THEN p_failure_code ELSE NULL END,
      failure_diagnostic = CASE WHEN next_state = 'failed' THEN p_failure_diagnostic ELSE NULL END
  WHERE id = current_job.id;
  RETURN next_state;
END;
$$;

REVOKE ALL ON FUNCTION public.ds_fail_scan(uuid, uuid, text, integer, jsonb) FROM PUBLIC;
