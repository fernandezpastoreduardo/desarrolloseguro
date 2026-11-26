/**
 * The coordinator budget includes the base domain scan and public-policy
 * pages, separate 120-second privacy and performance browser observations,
 * runtime setup, and cleanup.
 */
export const RUNTIME_COORDINATOR_EXECUTION_TIMEOUT_MS = 435_000;
export const RUNTIME_COORDINATOR_CLIENT_TIMEOUT_MS =
  RUNTIME_COORDINATOR_EXECUTION_TIMEOUT_MS + 5_000;
