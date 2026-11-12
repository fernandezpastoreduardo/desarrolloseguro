export const SCAN_FAILURE_CODES = [
  "coordinator_unavailable",
  "coordinator_socket_untrusted",
  "runtime_volume_failed",
  "broker_failed",
  "egress_failed",
  "executor_failed",
  "transport_failed",
] as const;

export type ScanFailureCode = (typeof SCAN_FAILURE_CODES)[number];
