import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { checkServerIdentity } from "node:tls";
import { afterEach, describe, expect, it } from "vitest";
import { resolveScanWorkerPoolConfig } from "./worker-pool-config.js";

const DATABASE_URL = "postgresql://ds_worker:secret@database/desarrollo_seguro";
const ERROR_CODE = "scan_worker_database_configuration_invalid";
let temporaryDirectory: string | undefined;

afterEach(() => {
  if (!temporaryDirectory) return;
  rmSync(temporaryDirectory, { recursive: true, force: true });
  temporaryDirectory = undefined;
});

describe("resolveScanWorkerPoolConfig", () => {
  it("uses the worker database secret without TLS outside production", () => {
    temporaryDirectory = mkdtempSync(join(tmpdir(), "ds-worker-pool-"));
    const settings = createSettings(temporaryDirectory);

    expect(resolveScanWorkerPoolConfig(settings.environment)).toEqual({
      connectionString: DATABASE_URL,
      max: 1,
      connectionTimeoutMillis: 5_000,
      idleTimeoutMillis: 10_000,
      application_name: "desarrollo-seguro-worker",
    });
  });

  it("requires a CA-verified TLS connection in production", () => {
    temporaryDirectory = mkdtempSync(join(tmpdir(), "ds-worker-pool-"));
    const settings = createSettings(temporaryDirectory);
    const caPath = join(temporaryDirectory, "database-ca.crt");
    generateCertificateAuthority(caPath);
    const ca = readFileSync(caPath, "utf8");

    expect(
      resolveScanWorkerPoolConfig({
        ...settings.environment,
        NODE_ENV: "production",
        DS_WORKER_DATABASE_TLS_CA_FILE: caPath,
      }),
    ).toEqual({
      connectionString: DATABASE_URL,
      max: 1,
      connectionTimeoutMillis: 5_000,
      idleTimeoutMillis: 10_000,
      application_name: "desarrollo-seguro-worker",
      ssl: {
        ca,
        checkServerIdentity,
        minVersion: "TLSv1.2",
        rejectUnauthorized: true,
      },
    });
  });

  it("rejects production config without a CA and rejects non-CA certificates", () => {
    temporaryDirectory = mkdtempSync(join(tmpdir(), "ds-worker-pool-"));
    const settings = createSettings(temporaryDirectory);
    expect(() =>
      resolveScanWorkerPoolConfig({
        ...settings.environment,
        NODE_ENV: "production",
      }),
    ).toThrow(ERROR_CODE);

    const certificatePath = join(temporaryDirectory, "server.crt");
    generateCertificateAuthority(certificatePath, false);
    expect(() =>
      resolveScanWorkerPoolConfig({
        ...settings.environment,
        NODE_ENV: "production",
        DS_WORKER_DATABASE_TLS_CA_FILE: certificatePath,
      }),
    ).toThrow(ERROR_CODE);
  });
});

function createSettings(directory: string) {
  const urlPath = join(directory, "worker-database-url");
  writeFileSync(urlPath, `${DATABASE_URL}\n`, { mode: 0o600 });
  return {
    environment: {
      DS_WORKER_DATABASE_URL_FILE: urlPath,
      DS_RUNTIME_COORDINATOR_SOCKET: "/run/desarrollo-seguro/coordinator.sock",
      DS_RUNTIME_COORDINATOR_UID: "1101",
      DS_RUNTIME_COORDINATOR_GID: "1101",
    },
  };
}

function generateCertificateAuthority(
  certificatePath: string,
  isCertificateAuthority = true,
): void {
  execFileSync("/usr/bin/openssl", [
    "req",
    "-x509",
    "-newkey",
    "rsa:2048",
    "-nodes",
    "-days",
    "1",
    "-subj",
    "/CN=Development Security worker test CA",
    "-addext",
    `basicConstraints=critical,CA:${isCertificateAuthority ? "TRUE" : "FALSE"}`,
    "-keyout",
    join(temporaryDirectory ?? tmpdir(), "worker-test-key.pem"),
    "-out",
    certificatePath,
  ], { stdio: "ignore" });
}
