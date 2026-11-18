const SCHEDULER_NOTIFICATION_CATEGORIES = [
  "retention_cycle_failed",
  "certification_audit_cycle_failed",
  "retention_cycle_completed",
  "certification_audit_cycle_completed",
  "retention_scheduler_failed",
  "certification_scheduler_failed",
] as const;

export type SchedulerNotificationCategory =
  (typeof SCHEDULER_NOTIFICATION_CATEGORIES)[number];

export function isSchedulerNotificationCategory(
  value: unknown,
): value is SchedulerNotificationCategory {
  return (
    typeof value === "string" &&
    (SCHEDULER_NOTIFICATION_CATEGORIES as readonly string[]).includes(value)
  );
}

export function emitSchedulerNotification(
  category: string,
  write: (line: string) => void,
  now: () => Date = () => new Date(),
  affectedCount?: number,
): void {
  if (!isSchedulerNotificationCategory(category)) {
    throw new Error("scheduler_notification_category_invalid");
  }
  if (
    affectedCount !== undefined &&
    (!Number.isSafeInteger(affectedCount) || affectedCount < 0 || affectedCount > 1_000)
  ) {
    throw new Error("scheduler_notification_count_invalid");
  }
  const payload = {
    event: "ds_scheduler_notification",
    category,
    observedAt: now().toISOString(),
    ...(affectedCount === undefined ? {} : { affectedCount }),
  };
  write(
    `${JSON.stringify(payload)}\n`,
  );
}
