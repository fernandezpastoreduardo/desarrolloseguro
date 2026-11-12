export const RUNTIME_DIAGNOSTIC_STAGES = [
  "volume_create",
  "volume_prepare",
  "broker_start",
  "broker_ready",
  "executor",
  "executor_container_cleanup",
  "broker_container_cleanup",
  "volume_cleanup",
] as const;

export const RUNTIME_DIAGNOSTIC_CODES = [
  "docker_runtime_command_failed",
  "docker_runtime_unavailable",
  "docker_command_timeout",
  "docker_command_output_too_large",
  "docker_daemon_unavailable",
  "docker_permission_denied",
  "docker_resource_in_use",
  "docker_removal_in_progress",
  "runtime_coordinator_unavailable",
  "runtime_coordinator_socket_untrusted",
  "executor_response_invalid",
  "executor_result_invalid",
  "runtime_broker_process_error",
  "runtime_broker_process_exited",
  "runtime_broker_process_killed",
  "runtime_broker_container_start_failed",
  "runtime_broker_entrypoint_failed",
  "runtime_broker_application_failed",
  "runtime_broker_ready_timeout",
  "runtime_broker_ready_failed",
  "runtime_volume_create_failed",
  "runtime_volume_prepare_failed",
  "runtime_broker_start_failed",
  "runtime_cleanup_retry",
  "runtime_cleanup_failed",
] as const;

export type RuntimeDiagnosticStage = (typeof RUNTIME_DIAGNOSTIC_STAGES)[number];
export type RuntimeDiagnosticCode = (typeof RUNTIME_DIAGNOSTIC_CODES)[number];

export type RuntimeDiagnosticEvent = {
  type: "runtime_diagnostic";
  stage: RuntimeDiagnosticStage;
  code: RuntimeDiagnosticCode;
  attempt?: number;
  causeCode?: RuntimeDiagnosticCode;
};

export type RuntimeDiagnosticWriter = (event: RuntimeDiagnosticEvent) => void;
export type RuntimeDiagnosticSink = (line: string) => void;

/** Writes only allowlisted operational categories, never request or error payloads. */
export function createJsonLineRuntimeDiagnostic(
  write: RuntimeDiagnosticSink = (line) => process.stderr.write(line),
): RuntimeDiagnosticWriter {
  return (event) => {
    if (!isSafeRuntimeDiagnosticEvent(event)) return;
    try {
      const safeEvent: RuntimeDiagnosticEvent = {
        type: event.type,
        stage: event.stage,
        code: event.code,
        ...(event.attempt === undefined ? {} : { attempt: event.attempt }),
        ...(event.causeCode === undefined ? {} : { causeCode: event.causeCode }),
      };
      write(`${JSON.stringify(safeEvent)}\n`);
    } catch {
      // Diagnostics must never change scan execution or cleanup behavior.
    }
  };
}

function isSafeRuntimeDiagnosticEvent(event: RuntimeDiagnosticEvent): boolean {
  return (
    event.type === "runtime_diagnostic" &&
    RUNTIME_DIAGNOSTIC_STAGES.includes(event.stage) &&
    RUNTIME_DIAGNOSTIC_CODES.includes(event.code) &&
    (event.causeCode === undefined || RUNTIME_DIAGNOSTIC_CODES.includes(event.causeCode)) &&
    (event.attempt === undefined || (
      Number.isSafeInteger(event.attempt) && event.attempt >= 1 && event.attempt <= 3
    ))
  );
}
