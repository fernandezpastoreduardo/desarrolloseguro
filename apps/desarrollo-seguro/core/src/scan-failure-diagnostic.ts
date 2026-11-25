export const SCAN_FAILURE_DIAGNOSTIC_STAGES = [
  "volume_create", "volume_prepare", "broker_start", "broker_ready", "executor",
  "executor_container_cleanup", "broker_container_cleanup", "volume_cleanup",
  "privacy_browser_observation", "privacy_assessment", "cookie_legal_findings",
  "service_comparison", "first_entry_policy_access", "response_validation",
  "runtime_session_create", "executor_execution", "runtime_session_cleanup",
] as const;

export const SCAN_FAILURE_DIAGNOSTIC_CODES = [
  "docker_runtime_command_failed", "docker_runtime_unavailable", "docker_command_timeout",
  "docker_command_output_too_large", "docker_daemon_unavailable", "docker_permission_denied",
  "docker_resource_in_use", "docker_removal_in_progress", "runtime_coordinator_unavailable",
  "runtime_coordinator_socket_untrusted", "executor_response_invalid", "executor_result_invalid",
  "executor_application_failed", "runtime_broker_process_error", "runtime_broker_process_exited",
  "runtime_broker_process_killed", "runtime_broker_container_start_failed",
  "runtime_broker_entrypoint_failed", "runtime_broker_application_failed",
  "runtime_broker_ready_timeout", "runtime_broker_ready_failed", "runtime_volume_create_failed",
  "runtime_volume_prepare_failed", "runtime_broker_start_failed", "runtime_cleanup_retry",
  "runtime_cleanup_failed", "runtime_execution_timeout", "executor_response_too_large",
] as const;

export const SCAN_DIAGNOSTIC_PROBE_OPERATIONS = ["dns", "tls", "http-head", "http-get", "headers"] as const;
export const SCAN_DIAGNOSTIC_PROBE_CODES = [
  "dns_resolution_failed", "connection_failed", "broker_failed", "request_aborted",
  "request_timeout", "response_size_limit_exceeded", "https_request_failed", "http_request_failed",
  "invalid_http_response", "redirect_limit_exceeded", "redirect_origin_not_allowlisted",
  "redirect_path_not_allowlisted", "tls_certificate_invalid", "tls_handshake_failed",
  "transport_failed", "probe_unavailable", "empty_evidence",
] as const;

export type ScanFailureDiagnosticProbe = {
  operation: (typeof SCAN_DIAGNOSTIC_PROBE_OPERATIONS)[number];
  code: (typeof SCAN_DIAGNOSTIC_PROBE_CODES)[number];
};

export type ScanFailureDiagnostic = {
  stage: (typeof SCAN_FAILURE_DIAGNOSTIC_STAGES)[number];
  code: (typeof SCAN_FAILURE_DIAGNOSTIC_CODES)[number];
  probeFailures?: ScanFailureDiagnosticProbe[];
};

/** Parse an operational diagnosis without accepting arbitrary error text or payloads. */
export function parseScanFailureDiagnostic(value: unknown): ScanFailureDiagnostic | null {
  if (!isPlainRecord(value) || !SCAN_FAILURE_DIAGNOSTIC_STAGES.includes(value.stage as ScanFailureDiagnostic["stage"]) ||
    !SCAN_FAILURE_DIAGNOSTIC_CODES.includes(value.code as ScanFailureDiagnostic["code"])) return null;
  if (value.probeFailures === undefined) return { stage: value.stage as ScanFailureDiagnostic["stage"], code: value.code as ScanFailureDiagnostic["code"] };
  if (!Array.isArray(value.probeFailures) || value.probeFailures.length < 1 || value.probeFailures.length > SCAN_DIAGNOSTIC_PROBE_OPERATIONS.length) return null;
  const seen = new Set<string>();
  const probeFailures: ScanFailureDiagnosticProbe[] = [];
  for (const item of value.probeFailures) {
    if (!isPlainRecord(item) || !SCAN_DIAGNOSTIC_PROBE_OPERATIONS.includes(item.operation as ScanFailureDiagnosticProbe["operation"]) ||
      !SCAN_DIAGNOSTIC_PROBE_CODES.includes(item.code as ScanFailureDiagnosticProbe["code"]) || seen.has(String(item.operation))) return null;
    seen.add(String(item.operation));
    probeFailures.push({ operation: item.operation as ScanFailureDiagnosticProbe["operation"], code: item.code as ScanFailureDiagnosticProbe["code"] });
  }
  return { stage: value.stage as ScanFailureDiagnostic["stage"], code: value.code as ScanFailureDiagnostic["code"], probeFailures };
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype;
}
