import { describe, expect, it } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  readScanWorkerDatabaseUrl,
  resolveScanWorkerConfiguration,
} from "./worker-configuration.js";

const baseEnvironment = {
  DS_WORKER_DATABASE_URL_FILE: "/run/secrets/worker-database-url",
  DS_RUNTIME_COORDINATOR_SOCKET: "/run/desarrollo-seguro/coordinator.sock",
  DS_RUNTIME_COORDINATOR_UID: "1101",
  DS_RUNTIME_COORDINATOR_GID: "1101",
};

describe("resolveScanWorkerConfiguration", () => {
  it("accepts a secret-file database configuration and a protected socket identity", () => {
    expect(resolveScanWorkerConfiguration(baseEnvironment)).toEqual({
      databaseUrlFile: "/run/secrets/worker-database-url",
      coordinatorSocketPath: "/run/desarrollo-seguro/coordinator.sock",
      coordinatorUid: 1101,
      coordinatorGid: 1101,
      idleDelayMs: 1_000,
      errorDelayMs: 5_000,
    });
  });

  it.each([
    [{ ...baseEnvironment, DS_WORKER_DATABASE_URL: "postgresql://ds_worker:secret@db/desarrollo_seguro" }],
    [{ ...baseEnvironment, DS_RUNTIME_COORDINATOR_UID: "1x" }],
    [{ ...baseEnvironment, DS_RUNTIME_COORDINATOR_GID: "-1" }],
    [{ ...baseEnvironment, DS_RUNTIME_COORDINATOR_SOCKET: "relative.sock" }],
    [{ ...baseEnvironment, DS_WORKER_IDLE_DELAY_MS: "0" }],
    [{ ...baseEnvironment, DS_WORKER_ERROR_DELAY_MS: "600001" }],
  ])("rejects unsafe or malformed settings", (environment) => {
    expect(() => resolveScanWorkerConfiguration(environment)).toThrow(
      "scan_worker_configuration_invalid",
    );
  });
});

describe("readScanWorkerDatabaseUrl", () => {
  it("accepts only the dedicated worker role and application database", async () => {
    const directory = await mkdtemp(join(tmpdir(), "ds-worker-config-"));
    const secretFile = join(directory, "database-url");
    try {
      await writeFile(
        secretFile,
        "postgresql://ds_worker:secret@postgres/desarrollo_seguro\n",
        { mode: 0o600 },
      );
      expect(readScanWorkerDatabaseUrl(secretFile)).toBe(
        "postgresql://ds_worker:secret@postgres/desarrollo_seguro",
      );

      await writeFile(
        secretFile,
        "postgresql://ds_api:secret@postgres/desarrollo_seguro",
        { mode: 0o600 },
      );
      expect(() => readScanWorkerDatabaseUrl(secretFile)).toThrow(
        "scan_worker_database_configuration_invalid",
      );
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
