import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { checkServerIdentity } from "node:tls";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  RETENTION_INTERVAL_MS,
  RETENTION_WINDOW_MS,
  resolveRetentionPoolConfig,
  runRetentionCycle,
  runRetentionScheduler,
} from "./retention-scheduler.js";

const DATABASE_URL =
  "postgresql://ds_retention:secret@development-security-database:5432/desarrollo_seguro";
let temporaryDirectory: string | undefined;

describe("report retention scheduler", () => {
  afterEach(() => {
    vi.useRealTimers();
    if (!temporaryDirectory) return;
    rmSync(temporaryDirectory, { recursive: true, force: true });
    temporaryDirectory = undefined;
  });

  it("purges only reports older than the enforced 90-day retention window", async () => {
    const now = new Date("2026-11-10T12:00:00.000Z");
    const query = vi.fn().mockResolvedValue({ rows: [{ deleted_rows: 4 }] });

    await expect(runRetentionCycle({ query }, () => now)).resolves.toBe(4);
    expect(query).toHaveBeenCalledWith(
      "SELECT public.ds_purge_expired_reports($1) AS deleted_rows",
      [new Date(now.getTime() - RETENTION_WINDOW_MS)],
    );
  });

  it("rejects an invalid deletion count instead of masking database errors", async () => {
    const query = vi.fn().mockResolvedValue({ rows: [{ deleted_rows: "many" }] });

    await expect(runRetentionCycle({ query })).rejects.toThrow(
      "report_retention_result_invalid",
    );
  });

  it("runs once at startup, then serially on the fixed daily interval", async () => {
    vi.useFakeTimers();
    const query = vi.fn().mockResolvedValue({ rows: [{ deleted_rows: 0 }] });
    const controller = new AbortController();
    const scheduler = runRetentionScheduler({ query }, {
      signal: controller.signal,
      now: () => new Date("2026-11-10T12:00:00.000Z"),
      onError: vi.fn(),
    });

    await vi.waitFor(() => expect(query).toHaveBeenCalledTimes(1));
    await vi.advanceTimersByTimeAsync(RETENTION_INTERVAL_MS);
    await vi.waitFor(() => expect(query).toHaveBeenCalledTimes(2));

    controller.abort();
    await scheduler;
    expect(query).toHaveBeenCalledTimes(2);
  });

  it("keeps running after a safe failure report and exits promptly on abort", async () => {
    vi.useFakeTimers();
    const query = vi
      .fn()
      .mockRejectedValueOnce(new Error("sensitive database detail"))
      .mockResolvedValue({ rows: [{ deleted_rows: 0 }] });
    const onError = vi.fn();
    const controller = new AbortController();
    const scheduler = runRetentionScheduler({ query }, {
      signal: controller.signal,
      onError,
    });

    await vi.waitFor(() => expect(onError).toHaveBeenCalledTimes(1));
    expect(onError).toHaveBeenCalledWith("retention_cycle_failed");
    await vi.advanceTimersByTimeAsync(RETENTION_INTERVAL_MS);
    await vi.waitFor(() => expect(query).toHaveBeenCalledTimes(2));

    controller.abort();
    await scheduler;
  });

  it("uses a dedicated file secret and CA-verified TLS in production", () => {
    temporaryDirectory = mkdtempSync(join(tmpdir(), "ds-retention-test-"));
    const urlPath = join(temporaryDirectory, "retention-url");
    const caPath = join(temporaryDirectory, "ca.crt");
    writeFileSync(urlPath, `${DATABASE_URL}\n`, { mode: 0o600 });
    generateCertificateAuthority(caPath);
    const ca = readFileSync(caPath, "utf8");

    expect(
      resolveRetentionPoolConfig({
        NODE_ENV: "production",
        DS_RETENTION_DATABASE_URL_FILE: urlPath,
        DS_RETENTION_DATABASE_TLS_CA_FILE: caPath,
      }),
    ).toEqual({
      connectionString: DATABASE_URL,
      max: 1,
      connectionTimeoutMillis: 5_000,
      idleTimeoutMillis: 10_000,
      application_name: "desarrollo-seguro-retention",
      ssl: {
        ca,
        checkServerIdentity,
        minVersion: "TLSv1.2",
        rejectUnauthorized: true,
      },
    });
  });

  it("rejects a missing production CA and any URL outside its dedicated role/database", () => {
    temporaryDirectory = mkdtempSync(join(tmpdir(), "ds-retention-test-"));
    const urlPath = join(temporaryDirectory, "retention-url");
    writeFileSync(urlPath, `${DATABASE_URL}\n`, { mode: 0o600 });
    expect(() =>
      resolveRetentionPoolConfig({
        NODE_ENV: "production",
        DS_RETENTION_DATABASE_URL_FILE: urlPath,
      }),
    ).toThrow("retention_configuration_invalid");

    const unsafeUrlPath = join(temporaryDirectory, "unsafe-url");
    writeFileSync(
      unsafeUrlPath,
      `${DATABASE_URL.replace("ds_retention", "ds_worker")}\n`,
      { mode: 0o600 },
    );
    expect(() =>
      resolveRetentionPoolConfig({
        DS_RETENTION_DATABASE_URL_FILE: unsafeUrlPath,
      }),
    ).toThrow("retention_configuration_invalid");
  });
});

function generateCertificateAuthority(certificatePath: string): void {
  execFileSync(
    "/usr/bin/openssl",
    [
      "req",
      "-x509",
      "-newkey",
      "rsa:2048",
      "-nodes",
      "-days",
      "1",
      "-subj",
      "/CN=Development Security retention test CA",
      "-addext",
      "basicConstraints=critical,CA:TRUE",
      "-keyout",
      join(temporaryDirectory ?? tmpdir(), "retention-test-key.pem"),
      "-out",
      certificatePath,
    ],
    { stdio: "ignore" },
  );
}
