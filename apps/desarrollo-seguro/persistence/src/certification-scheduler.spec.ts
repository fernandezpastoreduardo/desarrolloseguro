import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  CERTIFICATION_AUDIT_INTERVAL_MS,
  resolveCertificationPoolConfig,
  runCertificationAuditCycle,
  runCertificationScheduler,
} from "./certification-scheduler.js";

describe("certification audit scheduler", () => {
  afterEach(() => vi.useRealTimers());

  it("enqueues due certification audits with the scheduler clock", async () => {
    const now = new Date("2026-11-18T16:00:00.000Z");
    const query = vi.fn().mockResolvedValue({
      rows: [{ ds_enqueue_due_certification_scans: 2 }],
    });

    await expect(runCertificationAuditCycle({ query }, () => now)).resolves.toBe(2);
    expect(query).toHaveBeenCalledWith(
      "SELECT public.ds_enqueue_due_certification_scans($1) AS ds_enqueue_due_certification_scans",
      [now],
    );
  });

  it("rejects invalid scheduler results", async () => {
    const query = vi.fn().mockResolvedValue({
      rows: [{ ds_enqueue_due_certification_scans: "two" }],
    });

    await expect(runCertificationAuditCycle({ query })).rejects.toThrow(
      "certification_audit_result_invalid",
    );
  });

  it("continues after a safe failure and exits on abort", async () => {
    vi.useFakeTimers();
    const query = vi
      .fn()
      .mockRejectedValueOnce(new Error("database detail"))
      .mockResolvedValue({ rows: [{ ds_enqueue_due_certification_scans: 0 }] });
    const onError = vi.fn();
    const controller = new AbortController();
    const scheduler = runCertificationScheduler({ query }, {
      signal: controller.signal,
      onError,
    });

    await vi.waitFor(() => expect(onError).toHaveBeenCalledWith("certification_audit_cycle_failed"));
    await vi.advanceTimersByTimeAsync(CERTIFICATION_AUDIT_INTERVAL_MS);
    await vi.waitFor(() => expect(query).toHaveBeenCalledTimes(2));
    controller.abort();
    await scheduler;
  });

  it("accepts only the dedicated retention role database", () => {
    const directory = mkdtempSync(join(tmpdir(), "ds-certification-test-"));
    const urlPath = join(directory, "retention-url");
    writeFileSync(
      urlPath,
      "postgresql://ds_retention:secret@development-security-database:5432/desarrollo_seguro\n",
      { mode: 0o600 },
    );
    expect(resolveCertificationPoolConfig({
      DS_RETENTION_DATABASE_URL_FILE: urlPath,
    })).toMatchObject({
      max: 1,
      application_name: "desarrollo-seguro-certification-scheduler",
    });
    rmSync(directory, { recursive: true, force: true });
    expect(() => resolveCertificationPoolConfig({
      DS_RETENTION_DATABASE_URL_FILE: join(directory, "missing"),
    })).toThrow("certification_scheduler_configuration_invalid");
  });
});
