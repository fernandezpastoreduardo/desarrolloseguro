import { Buffer } from "node:buffer";
import { lstat, readFile, unlink } from "node:fs/promises";
import { isAbsolute, relative } from "node:path";
import { X509Certificate } from "node:crypto";
import process from "node:process";
import { pathToFileURL } from "node:url";

export const LAB_BROKER_SOCKET = "/run/development-security-egress/broker.sock";
export const LAB_FIXTURE_HOST = "public-audit-fixture";
export const MAX_LAB_STARTUP_REQUEST_BYTES = 4 * 1024;
const MAX_LAB_CA_BYTES = 16 * 1024;
const LAB_CA_MOUNT = "/run/public-audit-lab";
const RUN_ID_PATTERN = /^[a-z0-9](?:[a-z0-9-]{0,46}[a-z0-9])?$/u;
const FIXTURE_HOSTNAME_PATTERN = /^scan-[a-z0-9-]{1,48}\.example\.net$/u;
const SUPPORTED_PROFILE = "domain-v5";

function parsePort(value) {
  if (typeof value !== "string" || !/^\d{1,5}$/u.test(value)) {
    throw new Error("lab_egress_port_invalid");
  }
  const port = Number(value);
  if (!Number.isSafeInteger(port) || port < 1 || port > 65_535) {
    throw new Error("lab_egress_port_invalid");
  }
  return port;
}

/** Validates the lab-only environment and already-parsed runtime startup request. */
export function parseLabEgressConfiguration(environment, request) {
  const runId = environment.DS_LAB_RUN_ID;
  if (typeof runId !== "string" || !RUN_ID_PATTERN.test(runId)) {
    throw new Error("lab_egress_run_id_invalid");
  }
  const normalizedRunId = runId.toLowerCase();
  const expectedHostname = `scan-${normalizedRunId}.example.net`;
  if (
    typeof request !== "object" ||
    request === null ||
    request.hostname !== expectedHostname ||
    !FIXTURE_HOSTNAME_PATTERN.test(request.hostname)
  ) {
    throw new Error("lab_egress_hostname_mismatch");
  }
  if (
    request.profileVersion !== SUPPORTED_PROFILE ||
    !isSafeDomainV5TargetPath(request.targetPath)
  ) {
    throw new Error("lab_egress_request_invalid");
  }
  const fixtureHost = `${LAB_FIXTURE_HOST}-${normalizedRunId}`;
  if (environment.DS_LAB_FIXTURE_HOST !== fixtureHost) {
    throw new Error("lab_fixture_alias_invalid");
  }
  const httpsPort = parsePort(environment.DS_LAB_HTTPS_PORT);
  const httpPort = parsePort(environment.DS_LAB_HTTP_PORT);
  if (httpsPort === httpPort) throw new Error("lab_egress_port_invalid");
  const certificatePath = environment.DS_LAB_CA_FILE;
  if (
    typeof certificatePath !== "string" ||
    !isAbsolute(certificatePath) ||
    relative(LAB_CA_MOUNT, certificatePath).startsWith("..") ||
    relative(LAB_CA_MOUNT, certificatePath) === ""
  ) {
    throw new Error("lab_fixture_ca_not_mounted");
  }
  return Object.freeze({
    runId: normalizedRunId,
    hostname: expectedHostname,
    fixtureHost,
    httpsPort,
    httpPort,
    certificatePath,
    profileVersion: SUPPORTED_PROFILE,
    targetPath: request.targetPath,
    brokerSocket: LAB_BROKER_SOCKET,
  });
}

function isSafeDomainV5TargetPath(value) {
  return typeof value === "string" &&
    value.length >= 1 &&
    value.length <= 2_048 &&
    value.startsWith("/") &&
    !value.startsWith("//") &&
    ![...value].some((character) => {
      const code = character.codePointAt(0) ?? 0;
      return character === "#" || character === "\\" || code < 0x20 || code === 0x7f;
    });
}

export async function readMountedLabCertificate(configuration) {
  let metadata;
  try {
    metadata = await lstat(configuration.certificatePath);
  } catch {
    throw new Error("lab_fixture_ca_not_mounted");
  }
  if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.size < 64 || metadata.size > MAX_LAB_CA_BYTES) {
    throw new Error("lab_fixture_ca_invalid");
  }
  const certificatePem = await readFile(configuration.certificatePath, "utf8");
  try {
    const certificate = new X509Certificate(certificatePem);
    if (certificate.checkHost(configuration.hostname) !== configuration.hostname) {
      throw new Error("lab_fixture_ca_hostname_mismatch");
    }
  } catch {
    throw new Error("lab_fixture_ca_invalid");
  }
  return certificatePem;
}

export async function readBoundedRuntimeRequest(input, maxBytes = MAX_LAB_STARTUP_REQUEST_BYTES) {
  const chunks = [];
  let receivedBytes = 0;
  for await (const chunk of input) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    receivedBytes += bytes.byteLength;
    if (receivedBytes > maxBytes) throw new Error("lab_egress_request_invalid");
    chunks.push(bytes);
  }
  if (receivedBytes === 0) throw new Error("lab_egress_request_invalid");
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new Error("lab_egress_request_invalid");
  }
}

export async function startLabEgressBroker(configuration, certificatePem) {
  const [
    { createEgressAuthorizedLookup, createEgressDestinationAuthorizer },
    { listenTransportV1EgressBroker },
    { createTransportV1NetworkObserver },
    { createLabEgressAdapters },
  ] = await Promise.all([
    import("../../dist/egress-destination-policy.js"),
    import("../../dist/transport-v1-egress-ipc.js"),
    import("../../dist/transport-v1-network-observer.js"),
    import("./egress-adapters.mjs"),
  ]);

  const adapters = createLabEgressAdapters({
    hostname: configuration.hostname,
    fixtureHost: configuration.fixtureHost,
    httpsPort: configuration.httpsPort,
    httpPort: configuration.httpPort,
    certificatePem,
  });
  const observer = createTransportV1NetworkObserver({
    dnsResolver: adapters.dnsResolver,
    lookupFactory: (hostname, port) => createEgressAuthorizedLookup(
      hostname,
      port,
      createEgressDestinationAuthorizer(hostname, adapters.dnsResolver),
    ),
    httpRequestFactory: adapters.httpRequestFactory,
    httpsRequestFactory: adapters.httpsRequestFactory,
    httpsCa: certificatePem,
    inspectPage: true,
    probeTlsVersions: true,
    inspectPublicPolicies: true,
    allowCustomTargetPath: true,
  });
  const broker = await listenTransportV1EgressBroker(
    configuration.brokerSocket,
    configuration.hostname,
    observer,
    configuration.profileVersion,
    configuration.targetPath,
  );
  return {
    async close() {
      await broker.close();
      await unlink(configuration.brokerSocket).catch(() => undefined);
    },
  };
}

async function main() {
  const rawRequest = await readBoundedRuntimeRequest(process.stdin);
  const { parseTransportV1EgressBrokerStartupRequest } =
    await import("../../dist/transport-v1-egress-broker-startup.js");
  const request = parseTransportV1EgressBrokerStartupRequest(rawRequest);
  const configuration = parseLabEgressConfiguration(process.env, request);
  const certificatePem = await readMountedLabCertificate(configuration);
  const broker = await startLabEgressBroker(configuration, certificatePem);
  process.stdout.write('{"protocolVersion":1,"state":"ready"}\n');

  let stopping = false;
  const stop = async () => {
    if (stopping) return;
    stopping = true;
    await broker.close();
    process.exit(0);
  };
  process.once("SIGTERM", () => void stop());
  process.once("SIGINT", () => void stop());
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void main().catch(() => {
    process.stderr.write("lab_egress_broker_startup_failed\n");
    process.exitCode = 1;
  });
}
