import { randomUUID } from "node:crypto";
import { lstat, stat } from "node:fs/promises";
import { createConnection } from "node:net";
import { dirname } from "node:path";
import { normalizeHostname } from "@desarrolloseguro/core";
import type { ScanRunInput } from "@desarrolloseguro/persistence";
import {
  MAX_EXECUTOR_REQUEST_BYTES,
  MAX_EXECUTOR_RESPONSE_BYTES,
  parseTransportV1ExecutorRequest,
  parseTransportV1ExecutorResponse,
  type TransportV1ExecutorRequest,
} from "./transport-v1-executor-protocol.js";
import type { TransportV1ScanJob } from "./transport-v1-executor.js";
import type { ScanExecutor } from "./scan-job-processor.js";

const DEFAULT_COORDINATOR_TIMEOUT_MS = 40_000;

export type RuntimeCoordinatorExecutorOptions = {
  socketPath: string;
  expectedSocketUid: number;
  expectedSocketGid: number;
  timeoutMs?: number;
};

/**
 * Calls a separately managed runtime supervisor over a protected Unix socket.
 * The worker sends only a hostname and profile; it never receives Docker access.
 */
export class RuntimeCoordinatorExecutor implements ScanExecutor {
  private readonly timeoutMs: number;

  constructor(private readonly options: RuntimeCoordinatorExecutorOptions) {
    this.timeoutMs = options.timeoutMs ?? DEFAULT_COORDINATOR_TIMEOUT_MS;
    if (
      options.socketPath.length === 0 ||
      !Number.isSafeInteger(options.expectedSocketUid) ||
      options.expectedSocketUid < 0 ||
      !Number.isSafeInteger(options.expectedSocketGid) ||
      options.expectedSocketGid < 0 ||
      !Number.isSafeInteger(this.timeoutMs) ||
      this.timeoutMs < 1
    ) {
      throw new Error("runtime_coordinator_config_invalid");
    }
  }

  async execute(
    job: TransportV1ScanJob,
    signal: AbortSignal,
  ): Promise<
    Omit<ScanRunInput, "jobId" | "leaseToken" | "hostname" | "profileVersion">
  > {
    if (signal.aborted) throw new Error("request_aborted");
    let request: TransportV1ExecutorRequest;
    try {
      request = parseTransportV1ExecutorRequest({
        protocolVersion: 1,
        requestId: randomUUID(),
        hostname: normalizeHostname(job.hostname),
        profileVersion: job.profileVersion,
      });
    } catch {
      throw new Error("executor_request_invalid");
    }
    const serializedRequest = `${JSON.stringify(request)}\n`;
    if (Buffer.byteLength(serializedRequest) > MAX_EXECUTOR_REQUEST_BYTES) {
      throw new Error("executor_request_invalid");
    }

    await this.assertReady();
    return this.exchange(request, serializedRequest, signal);
  }

  async assertReady(): Promise<void> {
    let socket;
    let directory;
    try {
      socket = await lstat(this.options.socketPath);
      directory = await stat(dirname(this.options.socketPath));
    } catch {
      throw new Error("coordinator_unavailable");
    }
    if (
      !socket.isSocket() ||
      socket.uid !== this.options.expectedSocketUid ||
      socket.gid !== this.options.expectedSocketGid ||
      (socket.mode & 0o007) !== 0 ||
      !directory.isDirectory() ||
      directory.uid !== this.options.expectedSocketUid ||
      directory.gid !== this.options.expectedSocketGid ||
      (directory.mode & 0o027) !== 0
    ) {
      throw new Error("coordinator_socket_untrusted");
    }
  }

  private exchange(
    request: TransportV1ExecutorRequest,
    serializedRequest: string,
    signal: AbortSignal,
  ): Promise<
    Omit<ScanRunInput, "jobId" | "leaseToken" | "hostname" | "profileVersion">
  > {
    return new Promise((resolve, reject) => {
      const socket = createConnection(this.options.socketPath);
      let settled = false;
      let receivedBytes = 0;
      const chunks: Buffer[] = [];
      const timer = setTimeout(() => finishWithError("coordinator_unavailable"), this.timeoutMs);
      const onAbort = () => finishWithError("request_aborted");
      const cleanup = () => {
        clearTimeout(timer);
        signal.removeEventListener("abort", onAbort);
      };
      const finishWithError = (code: string) => {
        if (settled) return;
        settled = true;
        cleanup();
        socket.destroy();
        reject(new Error(code));
      };

      signal.addEventListener("abort", onAbort, { once: true });
      socket.once("connect", () => socket.write(serializedRequest));
      socket.on("data", (chunk: Buffer) => {
        receivedBytes += chunk.byteLength;
        if (receivedBytes > MAX_EXECUTOR_RESPONSE_BYTES) {
          finishWithError("transport_failed");
          return;
        }
        chunks.push(chunk);
      });
      socket.once("error", () => finishWithError("coordinator_unavailable"));
      socket.once("end", () => {
        if (settled) return;
        try {
          const responseText = Buffer.concat(chunks).toString("utf8").trim();
          const response = parseTransportV1ExecutorResponse(
            JSON.parse(responseText) as unknown,
            request.requestId,
            request.profileVersion,
          );
          if ("errorCode" in response) {
            finishWithError(
              response.errorCode === "request_invalid"
                ? "transport_failed"
                : response.errorCode,
            );
            return;
          }
          settled = true;
          cleanup();
          resolve(response.result);
        } catch {
          finishWithError("transport_failed");
        }
      });
      if (signal.aborted) {
        onAbort();
        return;
      }
    });
  }
}
