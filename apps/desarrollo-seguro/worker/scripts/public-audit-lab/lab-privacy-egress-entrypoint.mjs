import { X509Certificate } from "node:crypto";
import { lstat, readFile } from "node:fs/promises";
import { isAbsolute } from "node:path";
import process from "node:process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { PRIVACY_BROWSER_BUDGET } from "@desarrolloseguro/core";
import { createPrivacyEgressProxy } from "../../dist/privacy-egress-proxy.js";
import { createLabEgressAdapters } from "./egress-adapters.mjs";

const RUN_ID_PATTERN = /^[a-z0-9](?:[a-z0-9-]{0,46}[a-z0-9])?$/iu;
const MAX_CERTIFICATE_BYTES = 64 * 1024;
const DEFAULT_PROXY_PORT = 3_128;
const DEFAULT_HTTPS_PORT = 8_443;
const DEFAULT_HTTP_PORT = 8_080;
const SAFE_CONFIGURATION_ERRORS = new Set([
  "lab_run_id_invalid",
  "lab_hostname_mismatch",
  "lab_fixture_alias_mismatch",
  "lab_fixture_certificate_path_invalid",
  "lab_fixture_certificate_invalid",
  "lab_fixture_certificate_hostname_mismatch",
  "lab_port_invalid",
  "lab_ports_conflict",
  "lab_byte_limit_invalid",
  "lab_egress_hostname_invalid",
  "lab_fixture_host_invalid",
  "lab_fixture_port_invalid",
  "lab_fixture_certificate_required",
]);

/** Reads and validates only the run-scoped, test-only privacy proxy configuration. */
export async function resolveLabPrivacyEgressConfiguration(environment = process.env) {
  const runId = readRunId(environment.DS_LAB_RUN_ID);
  const hostname = readHostname(environment.DS_LAB_HOSTNAME, runId);
  const fixtureAlias = readFixtureAlias(environment.DS_LAB_FIXTURE_ALIAS, runId);
  const proxyPort = readPort(environment.DS_LAB_PRIVACY_PROXY_PORT, DEFAULT_PROXY_PORT);
  const httpsPort = readPort(environment.DS_LAB_FIXTURE_HTTPS_PORT, DEFAULT_HTTPS_PORT);
  const httpPort = readPort(environment.DS_LAB_FIXTURE_HTTP_PORT, DEFAULT_HTTP_PORT);
  if (new Set([proxyPort, httpsPort, httpPort]).size !== 3) {
    throw new Error("lab_ports_conflict");
  }
  const maxReceivedBytes = readByteLimit(environment.DS_LAB_PRIVACY_MAX_RECEIVED_BYTES);
  const certificatePem = await readFixtureCertificate(environment.DS_LAB_FIXTURE_CA_FILE, hostname);

  return Object.freeze({
    runId,
    hostname,
    fixtureAlias,
    proxyPort,
    httpsPort,
    httpPort,
    maxReceivedBytes,
    certificatePem,
  });
}

/** Creates the real privacy proxy with lab-only, exact-host fixture adapters. */
export async function createLabPrivacyEgress(environment = process.env) {
  const configuration = await resolveLabPrivacyEgressConfiguration(environment);
  const adapters = createLabEgressAdapters({
    hostname: configuration.hostname,
    fixtureHost: configuration.fixtureAlias,
    httpsPort: configuration.httpsPort,
    httpPort: configuration.httpPort,
    certificatePem: configuration.certificatePem,
  });
  const proxy = createPrivacyEgressProxy({
    host: "0.0.0.0",
    port: configuration.proxyPort,
    maxReceivedBytes: configuration.maxReceivedBytes,
    maxConnections: 32,
    lookup: adapters.lookup,
    connectPinned: adapters.connectPinned,
  });
  return { configuration, adapters, proxy };
}

export async function startLabPrivacyEgress(environment = process.env) {
  const { configuration, proxy } = await createLabPrivacyEgress(environment);
  const address = await proxy.listen();
  process.stdout.write(`${JSON.stringify({
    event: "privacy_proxy_ready",
    runId: configuration.runId,
    hostname: configuration.hostname,
    port: address.port,
  })}\n`);

  let closing = false;
  const close = async () => {
    if (closing) return;
    closing = true;
    await proxy.close();
    process.stdout.write(`${JSON.stringify({
      event: "privacy_proxy_stats",
      runId: configuration.runId,
      ...proxy.stats(),
    })}\n`);
  };
  process.once("SIGTERM", () => { void close().catch(writeSafeShutdownFailure); });
  process.once("SIGINT", () => { void close().catch(writeSafeShutdownFailure); });
  return { configuration, proxy, close };
}

function readRunId(value) {
  if (typeof value !== "string" || !RUN_ID_PATTERN.test(value)) {
    throw new Error("lab_run_id_invalid");
  }
  return value.toLowerCase();
}

function readHostname(value, runId) {
  const expected = `scan-${runId}.example.net`;
  if (typeof value !== "string" || value.toLowerCase().replace(/\.$/u, "") !== expected) {
    throw new Error("lab_hostname_mismatch");
  }
  return expected;
}

function readFixtureAlias(value, runId) {
  const expected = `public-audit-fixture-${runId}`;
  if (typeof value !== "string" || value.toLowerCase() !== expected) {
    throw new Error("lab_fixture_alias_mismatch");
  }
  return expected;
}

function readPort(value, fallback) {
  const port = value === undefined ? fallback : Number(value);
  if (!Number.isSafeInteger(port) || port < 1_024 || port > 65_535) {
    throw new Error("lab_port_invalid");
  }
  return port;
}

function readByteLimit(value) {
  const maxReceivedBytes = value === undefined
    ? PRIVACY_BROWSER_BUDGET.receivedBytes
    : Number(value);
  if (
    !Number.isSafeInteger(maxReceivedBytes) ||
    maxReceivedBytes < 1 ||
    maxReceivedBytes > PRIVACY_BROWSER_BUDGET.receivedBytes
  ) {
    throw new Error("lab_byte_limit_invalid");
  }
  return maxReceivedBytes;
}

async function readFixtureCertificate(path, hostname) {
  if (typeof path !== "string" || !isAbsolute(path)) {
    throw new Error("lab_fixture_certificate_path_invalid");
  }
  let metadata;
  try {
    metadata = await lstat(path);
  } catch {
    throw new Error("lab_fixture_certificate_path_invalid");
  }
  if (!metadata.isFile() || metadata.size < 32 || metadata.size > MAX_CERTIFICATE_BYTES) {
    throw new Error("lab_fixture_certificate_path_invalid");
  }

  let certificatePem;
  try {
    certificatePem = await readFile(path, "utf8");
    const certificate = new X509Certificate(certificatePem);
    if (certificate.checkHost(hostname) !== hostname) {
      throw new Error("lab_fixture_certificate_hostname_mismatch");
    }
  } catch (error) {
    if (error instanceof Error && error.message === "lab_fixture_certificate_hostname_mismatch") throw error;
    throw new Error("lab_fixture_certificate_invalid", { cause: error });
  }
  return certificatePem;
}

function writeSafeShutdownFailure() {
  process.stderr.write("lab_privacy_proxy_shutdown_failed\n");
}

function isMainModule() {
  const entrypoint = process.argv[1];
  return typeof entrypoint === "string" &&
    pathToFileURL(entrypoint).href === import.meta.url;
}

if (isMainModule()) {
  startLabPrivacyEgress().catch((error) => {
    const code = error instanceof Error && SAFE_CONFIGURATION_ERRORS.has(error.message)
      ? error.message
      : "lab_privacy_proxy_start_failed";
    process.stderr.write(`${code}\n`);
    process.exitCode = 1;
  });
}

export const LAB_PRIVACY_EGRESS_ENTRYPOINT_PATH = fileURLToPath(import.meta.url);
