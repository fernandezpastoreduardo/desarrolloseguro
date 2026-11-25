import {
  MAX_EXECUTOR_REQUEST_BYTES,
  parseTransportV1ExecutorRequest,
} from "./transport-v1-executor-protocol.js";
import { createUnixSocketObservationSource } from "./transport-v1-egress-ipc.js";
import {
  NetworkObservationUnavailableError,
  TransportV1NetworkExecutor,
} from "./transport-v1-executor.js";
import { parseScanFailureDiagnostic } from "@desarrolloseguro/core";

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
      createUnixSocketObservationSource(EGRESS_BROKER_SOCKET, request.profileVersion),
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
    if (error instanceof NetworkObservationUnavailableError) {
      writeFailure(requestId, "executor_failed", {
        category: "network_observation_unavailable",
        probeFailures: error.probeFailures,
      });
    } else {
      const failureDiagnostic = readFailureDiagnostic(error);
      writeFailure(
        requestId,
        error instanceof Error && error.message === "executor_request_invalid"
          ? "request_invalid"
          : "executor_failed",
        undefined,
        failureDiagnostic ?? { stage: "executor", code: "executor_application_failed" },
      );
    }
    process.exitCode = 1;
  }
}

function writeFailure(
  requestId: string,
  errorCode: "request_invalid" | "executor_failed",
  diagnostic?: { category: "network_observation_unavailable"; probeFailures: NetworkObservationUnavailableError["probeFailures"] },
  failureDiagnostic?: ReturnType<typeof parseScanFailureDiagnostic>,
): void {
  process.stdout.write(
    `${JSON.stringify({ protocolVersion: 1, requestId, errorCode, ...(diagnostic ? { diagnostic } : {}), ...(failureDiagnostic ? { failureDiagnostic } : {}) })}\n`,
  );
}

function readFailureDiagnostic(error: unknown): ReturnType<typeof parseScanFailureDiagnostic> {
  if (!(error instanceof Error) || !("scanFailureDiagnostic" in error)) return null;
  return parseScanFailureDiagnostic(error.scanFailureDiagnostic);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype
  );
}

void main().catch((error: unknown) => {
  writeFailure("", "executor_failed", undefined, {
    ...(readFailureDiagnostic(error) ?? { stage: "executor", code: "executor_application_failed" }),
  });
  process.exitCode = 1;
});
