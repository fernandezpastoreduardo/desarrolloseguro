import {
  MAX_EXECUTOR_REQUEST_BYTES,
  parseTransportV1ExecutorRequest,
} from "./transport-v1-executor-protocol.js";
import { createUnixSocketObservationSource } from "./transport-v1-egress-ipc.js";
import { TransportV1NetworkExecutor } from "./transport-v1-executor.js";

const EGRESS_BROKER_SOCKET = "/run/development-security-egress/broker.sock";

async function main(): Promise<void> {
  const chunks: Buffer[] = [];
  let receivedBytes = 0;
  for await (const chunk of process.stdin) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    receivedBytes += buffer.byteLength;
    if (receivedBytes > MAX_EXECUTOR_REQUEST_BYTES) {
      writeFailure("", "request_invalid");
      process.exitCode = 1;
      return;
    }
    chunks.push(buffer);
  }

  let requestId = "";
  try {
    const input = JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
    if (isRecord(input) && typeof input.requestId === "string") {
      requestId = input.requestId;
    }
    const request = parseTransportV1ExecutorRequest(input);
    const result = await new TransportV1NetworkExecutor(
      createUnixSocketObservationSource(EGRESS_BROKER_SOCKET),
    ).execute(
      {
        hostname: request.hostname,
        profileVersion: request.profileVersion,
      },
      new AbortController().signal,
    );
    process.stdout.write(
      `${JSON.stringify({ protocolVersion: 1, requestId, result })}\n`,
    );
  } catch (error) {
    writeFailure(
      requestId,
      error instanceof Error && error.message === "executor_request_invalid"
        ? "request_invalid"
        : "executor_failed",
    );
    process.exitCode = 1;
  }
}

function writeFailure(requestId: string, errorCode: "request_invalid" | "executor_failed"): void {
  process.stdout.write(
    `${JSON.stringify({ protocolVersion: 1, requestId, errorCode })}\n`,
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype
  );
}

void main().catch(() => {
  writeFailure("", "executor_failed");
  process.exitCode = 1;
});
