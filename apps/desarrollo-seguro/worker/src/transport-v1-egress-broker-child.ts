import { unlink } from "node:fs/promises";
import { parseTransportV1EgressBrokerStartupRequest } from "./transport-v1-egress-broker-startup.js";
import { listenTransportV1EgressBroker } from "./transport-v1-egress-ipc.js";
import { createTransportV1NetworkObserver } from "./transport-v1-network-observer.js";

const EGRESS_BROKER_SOCKET = "/run/development-security-egress/broker.sock";
const MAX_STARTUP_REQUEST_BYTES = 4 * 1024;
const SAFE_STARTUP_FAILURES = new Set([
  "egress_broker_startup_invalid",
  "egress_broker_socket_invalid",
  "egress_broker_socket_directory_invalid",
  "egress_broker_socket_setup_failed",
  "egress_broker_socket_listen_failed",
]);

async function main(): Promise<void> {
  const chunks: Buffer[] = [];
  let receivedBytes = 0;
  for await (const chunk of process.stdin) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    receivedBytes += buffer.byteLength;
    if (receivedBytes > MAX_STARTUP_REQUEST_BYTES) {
      throw new Error("egress_broker_startup_invalid");
    }
    chunks.push(buffer);
  }

  const request = parseTransportV1EgressBrokerStartupRequest(
    JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown,
  );
  const broker = await listenTransportV1EgressBroker(
    EGRESS_BROKER_SOCKET,
    request.hostname,
    createTransportV1NetworkObserver({
      inspectPage: request.profileVersion === "domain-v1" || request.profileVersion === "domain-v2" || request.profileVersion === "domain-v3" || request.profileVersion === "domain-v4" || request.profileVersion === "domain-v5",
      probeTlsVersions: request.profileVersion === "domain-v3" || request.profileVersion === "domain-v4" || request.profileVersion === "domain-v5",
      inspectPublicPolicies: request.profileVersion === "domain-v4" || request.profileVersion === "domain-v5",
      allowCustomTargetPath: request.profileVersion === "domain-v5",

    }),
    request.profileVersion,
    request.targetPath,
  );
  process.stdout.write('{"protocolVersion":1,"state":"ready"}\n');

  let closing = false;
  const close = async () => {
    if (closing) return;
    closing = true;
    await broker.close();
    await unlink(EGRESS_BROKER_SOCKET).catch(() => undefined);
  };
  process.once("SIGTERM", () => void close().then(() => process.exit(0)));
  process.once("SIGINT", () => void close().then(() => process.exit(0)));
}

void main().catch((error: unknown) => {
  const code = error instanceof Error && SAFE_STARTUP_FAILURES.has(error.message)
    ? error.message
    : "egress_broker_startup_failed";
  process.stderr.write(`${code}\n`);
  process.exitCode = 1;
});
