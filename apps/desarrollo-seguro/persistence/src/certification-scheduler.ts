import { Pool, type PoolConfig } from "pg";
import { pathToFileURL } from "node:url";
import { resolveRetentionPoolConfig } from "./retention-scheduler.js";
import { emitSchedulerNotification } from "./scheduler-notification.js";

export const CERTIFICATION_AUDIT_INTERVAL_MS = 5 * 60 * 1_000;
const CERTIFICATION_AUDIT_FAILURE = "certification_audit_cycle_failed";
const CERTIFICATION_AUDIT_RESULT_INVALID = "certification_audit_result_invalid";

export async function runCertificationAuditCycle(
  pool: Pick<Pool, "query">,
  now: () => Date = () => new Date(),
): Promise<number> {
  const result = await pool.query<{ ds_enqueue_due_certification_scans: unknown }>(
    "SELECT public.ds_enqueue_due_certification_scans($1) AS ds_enqueue_due_certification_scans",
    [now()],
  );
  const enqueuedRows = result.rows[0]?.ds_enqueue_due_certification_scans;
  if (
    typeof enqueuedRows !== "number" ||
    !Number.isSafeInteger(enqueuedRows) ||
    enqueuedRows < 0
  ) {
    throw new Error(CERTIFICATION_AUDIT_RESULT_INVALID);
  }
  return enqueuedRows;
}

export async function runCertificationScheduler(
  pool: Pick<Pool, "query">,
  options: {
    signal: AbortSignal;
    now?: () => Date;
    intervalMs?: number;
    onError?: (category: string) => void;
    onSuccess?: (category: string, affectedCount: number) => void;
  },
): Promise<void> {
  const intervalMs = options.intervalMs ?? CERTIFICATION_AUDIT_INTERVAL_MS;
  if (!Number.isSafeInteger(intervalMs) || intervalMs < 1_000) {
    throw new Error("certification_scheduler_interval_invalid");
  }

  while (!options.signal.aborted) {
    try {
      const affectedCount = await runCertificationAuditCycle(pool, options.now);
      options.onSuccess?.("certification_audit_cycle_completed", affectedCount);
    } catch {
      options.onError?.(CERTIFICATION_AUDIT_FAILURE);
    }
    if (options.signal.aborted) return;
    await waitForNextCycle(intervalMs, options.signal);
  }
}

function waitForNextCycle(intervalMs: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const finish = () => {
      clearTimeout(timer);
      signal.removeEventListener("abort", finish);
      resolve();
    };
    const timer = setTimeout(finish, intervalMs);
    signal.addEventListener("abort", finish, { once: true });
  });
}

export function resolveCertificationPoolConfig(
  environment: NodeJS.ProcessEnv,
): PoolConfig {
  try {
    return {
      ...resolveRetentionPoolConfig(environment),
      application_name: "desarrollo-seguro-certification-scheduler",
    };
  } catch {
    throw new Error("certification_scheduler_configuration_invalid");
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const pool = new Pool(resolveCertificationPoolConfig(process.env));
  const controller = new AbortController();
  process.once("SIGINT", () => controller.abort());
  process.once("SIGTERM", () => controller.abort());
  try {
    await runCertificationScheduler(pool, {
      signal: controller.signal,
      onError: (category) =>
        emitSchedulerNotification(category, (line) => process.stderr.write(line)),
      onSuccess: (category, affectedCount) =>
        emitSchedulerNotification(
          category,
          (line) => process.stdout.write(line),
          undefined,
          affectedCount,
        ),
    });
  } catch {
    emitSchedulerNotification(
      "certification_scheduler_failed",
      (line) => process.stderr.write(line),
    );
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}
