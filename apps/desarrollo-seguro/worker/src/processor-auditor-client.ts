import { randomUUID } from "node:crypto";
import { lstat, stat } from "node:fs/promises";
import { createConnection } from "node:net";
import { dirname } from "node:path";
import { assessProcessorTransparency, parseProcessorTransparencyAssessment, type ProcessorTransparencyAssessment } from "@desarrolloseguro/core";

const MAX_REQUEST_BYTES = 1_024;
const MAX_RESPONSE_BYTES = 70 * 1_024;
const DEFAULT_TIMEOUT_MS = 8_000;
const AUDITOR_ERROR = assessProcessorTransparency({ status: "auditor_error" });

export type ProcessorAuditorClientOptions = {
  socketPath: string;
  expectedSocketUid: number;
  expectedSocketGid: number;
  timeoutMs?: number;
};

export class ProcessorAuditorClient {
  private readonly timeoutMs: number;

  constructor(private readonly options: ProcessorAuditorClientOptions) {
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    if (!options.socketPath || !Number.isSafeInteger(options.expectedSocketUid) || options.expectedSocketUid < 0 ||
        !Number.isSafeInteger(options.expectedSocketGid) || options.expectedSocketGid < 0 ||
        !Number.isSafeInteger(this.timeoutMs) || this.timeoutMs < 1 || this.timeoutMs > 30_000) {
      throw new Error("processor_auditor_client_config_invalid");
    }
  }

  async read(signal?: AbortSignal): Promise<ProcessorTransparencyAssessment> {
    if (signal?.aborted) return AUDITOR_ERROR;
    try { await this.assertReady(); } catch { return AUDITOR_ERROR; }
    const requestId = randomUUID();
    const request = `${JSON.stringify({ protocolVersion: 1, requestId, operation: "read_processor_transparency" })}\n`;
    if (Buffer.byteLength(request) > MAX_REQUEST_BYTES) return AUDITOR_ERROR;
    return new Promise((resolve) => {
      const socket = createConnection(this.options.socketPath);
      let settled = false;
      let received = 0;
      const chunks: Buffer[] = [];
      const timer = setTimeout(() => finish(AUDITOR_ERROR), this.timeoutMs);
      const onAbort = () => finish(AUDITOR_ERROR);
      const finish = (assessment: ProcessorTransparencyAssessment) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        signal?.removeEventListener("abort", onAbort);
        socket.destroy();
        resolve(assessment);
      };
      signal?.addEventListener("abort", onAbort, { once: true });
      socket.once("connect", () => socket.write(request));
      socket.on("data", (chunk) => {
        const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        received += buffer.byteLength;
        if (received > MAX_RESPONSE_BYTES) { finish(AUDITOR_ERROR); return; }
        chunks.push(buffer);
      });
      socket.once("error", () => finish(AUDITOR_ERROR));
      socket.once("end", () => {
        if (settled) return;
        const bytes = Buffer.concat(chunks);
        const newline = bytes.indexOf(0x0a);
        if (newline !== bytes.byteLength - 1 || newline < 1) { finish(AUDITOR_ERROR); return; }
        try {
          const value: unknown = JSON.parse(bytes.subarray(0, newline).toString("utf8"));
          if (!isRecord(value) || !hasExactKeys(value, ["protocolVersion", "requestId", "assessment"]) ||
              value.protocolVersion !== 1 || value.requestId !== requestId) { finish(AUDITOR_ERROR); return; }
          const assessment = parseProcessorTransparencyAssessment(value.assessment);
          finish(assessment ?? AUDITOR_ERROR);
        } catch { finish(AUDITOR_ERROR); }
      });
      if (signal?.aborted) onAbort();
    });
  }

  private async assertReady(): Promise<void> {
    const [socket, directory] = await Promise.all([
      lstat(this.options.socketPath),
      stat(dirname(this.options.socketPath)),
    ]);
    if (!socket.isSocket() || socket.uid !== this.options.expectedSocketUid || socket.gid !== this.options.expectedSocketGid ||
        (socket.mode & 0o007) !== 0 || !directory.isDirectory() ||
        directory.uid !== this.options.expectedSocketUid || directory.gid !== this.options.expectedSocketGid ||
        (directory.mode & 0o027) !== 0) throw new Error("processor_auditor_socket_untrusted");
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasExactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const compareKeys = (left: string, right: string) => left.localeCompare(right, "en");
  const actual = Object.keys(value).sort(compareKeys);
  const expected = [...keys].sort(compareKeys);
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}
