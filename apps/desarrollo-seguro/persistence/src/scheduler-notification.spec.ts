import { describe, expect, it, vi } from "vitest";
import {
  emitSchedulerNotification,
  isSchedulerNotificationCategory,
} from "./scheduler-notification.js";

describe("scheduler notifications", () => {
  it("accepts only the allowlisted categories", () => {
    expect(isSchedulerNotificationCategory("retention_cycle_failed")).toBe(true);
    expect(isSchedulerNotificationCategory("certification_scheduler_failed")).toBe(true);
    expect(isSchedulerNotificationCategory("retention_cycle_completed")).toBe(true);
    expect(isSchedulerNotificationCategory("database-password")).toBe(false);
    expect(isSchedulerNotificationCategory(undefined)).toBe(false);
  });

  it("emits a bounded JSON line without operational details", () => {
    const write = vi.fn();

    emitSchedulerNotification(
      "certification_audit_cycle_failed",
      write,
      () => new Date("2026-11-18T16:00:00.000Z"),
    );

    expect(write).toHaveBeenCalledWith(
      '{"event":"ds_scheduler_notification","category":"certification_audit_cycle_failed","observedAt":"2026-11-18T16:00:00.000Z"}\n',
    );
  });

  it("rejects an unapproved category before writing", () => {
    const write = vi.fn();

    expect(() =>
      emitSchedulerNotification("sensitive-database-error", write),
    ).toThrow("scheduler_notification_category_invalid");
    expect(write).not.toHaveBeenCalled();
  });
});
