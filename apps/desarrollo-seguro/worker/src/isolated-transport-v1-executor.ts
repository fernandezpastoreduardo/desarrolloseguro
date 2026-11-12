import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { tmpdir } from "node:os";
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

const DEFAULT_EXECUTOR_TIMEOUT_MS = 35_000;

export type IsolatedTransportV1ExecutorOptions = {
  entrypoint: string;
  timeoutMs?: number;
};

/**
 * Runs the network executor in a child process and passes only a profile and
 * hostname over stdin. The child receives an empty environment and no store,
 * job ID, or lease token.
 */
export class IsolatedTransportV1Executor {
  private readonly timeoutMs: number;

  constructor(private readonly options: IsolatedTransportV1ExecutorOptions) {
    this.timeoutMs = options.timeoutMs ?? DEFAULT_EXECUTOR_TIMEOUT_MS;
    if (!Number.isSafeInteger(this.timeoutMs) || this.timeoutMs < 1) {
      throw new Error("executor_timeout_invalid");
    }
  }

  execute(
    job: TransportV1ScanJob,
    signal: AbortSignal,
  ): Promise<
    Omit<ScanRunInput, "jobId" | "leaseToken" | "hostname" | "profileVersion">
  > {
    if (signal.aborted) return Promise.reject(new Error("request_aborted"));
    if (job.profileVersion !== "transport-v1" && job.profileVersion !== "domain-v1" && job.profileVersion !== "domain-v2" && job.profileVersion !== "domain-v3") {
      return Promise.reject(new Error("unsupported_scan_profile"));
    }

    let request: TransportV1ExecutorRequest;
    try {
      request = parseTransportV1ExecutorRequest({
        protocolVersion: 1,
        requestId: randomUUID(),
        hostname: normalizeHostname(job.hostname),
        profileVersion: job.profileVersion,
      });
    } catch {
      return Promise.reject(new Error("executor_request_invalid"));
    }
    const serializedRequest = JSON.stringify(request);
    if (Buffer.byteLength(serializedRequest) > MAX_EXECUTOR_REQUEST_BYTES) {
      return Promise.reject(new Error("executor_request_invalid"));
    }
    return new Promise((resolve, reject) => {
      let child: ReturnType<typeof spawn>;
      try {
        child = spawn(process.execPath, [this.options.entrypoint], {
          cwd: tmpdir(),
          env: {},
          shell: false,
          windowsHide: true,
          stdio: ["pipe", "pipe", "ignore"],
        });
      } catch {
        reject(new Error("executor_process_failed"));
        return;
      }
      const childStdout = child.stdout;
      const childStdin = child.stdin;
      if (!childStdout || !childStdin) {
        child.kill("SIGKILL");
        reject(new Error("executor_process_failed"));
        return;
      }

      let settled = false;
      let receivedBytes = 0;
      const responseChunks: Buffer[] = [];
      const timer = setTimeout(() => finishWithError("executor_timeout"), this.timeoutMs);
      const onAbort = () => finishWithError("request_aborted");
      const cleanup = () => {
        clearTimeout(timer);
        signal.removeEventListener("abort", onAbort);
      };
      const finishWithError = (code: string) => {
        if (settled) return;
        settled = true;
        cleanup();
        child.kill("SIGKILL");
        reject(new Error(code));
      };

      signal.addEventListener("abort", onAbort, { once: true });
      childStdout.on("data", (chunk: Buffer | string) => {
        const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        receivedBytes += buffer.byteLength;
        if (receivedBytes > MAX_EXECUTOR_RESPONSE_BYTES) {
          finishWithError("executor_response_too_large");
          return;
        }
        responseChunks.push(buffer);
      });
      childStdin.on("error", () => finishWithError("executor_process_failed"));
      child.on("error", () => finishWithError("executor_process_failed"));
      child.on("close", (exitCode) => {
        if (settled) return;
        if (exitCode !== 0) {
          finishWithError("executor_process_failed");
          return;
        }
        try {
          const responseText = Buffer.concat(responseChunks).toString("utf8").trim();
          const response = parseTransportV1ExecutorResponse(
            JSON.parse(responseText) as unknown,
            request.requestId,
            request.profileVersion,
          );
          if ("errorCode" in response) {
            finishWithError(response.errorCode === "request_invalid"
              ? "executor_request_invalid"
              : "executor_failed");
            return;
          }
          settled = true;
          cleanup();
          resolve(response.result);
        } catch {
          finishWithError("executor_response_invalid");
        }
      });
      if (signal.aborted) {
        onAbort();
        return;
      }
      childStdin.end(serializedRequest);
    });
  }
}
