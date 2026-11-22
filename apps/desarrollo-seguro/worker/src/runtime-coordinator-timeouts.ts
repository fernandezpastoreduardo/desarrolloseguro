/**
 * The coordinator budget includes the base domain scan, up to 125 seconds for
 * the bounded Solistos browser, runtime setup, and cleanup. The browser's
 * own observation budget remains 120 seconds.
 */
export const RUNTIME_COORDINATOR_EXECUTION_TIMEOUT_MS = 210_000;
export const RUNTIME_COORDINATOR_CLIENT_TIMEOUT_MS =
  RUNTIME_COORDINATOR_EXECUTION_TIMEOUT_MS + 5_000;
