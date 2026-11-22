import { chmod, lstat, stat, unlink } from "node:fs/promises";
import { createServer, type Server, type Socket } from "node:net";
import { dirname } from "node:path";
import { assessProcessorTransparency, type ProcessorTransparencyAssessment } from "@desarrolloseguro/core";
import { createInternalAuditRuntime } from "./internal-audit-runtime.js";

const MAX_REQUEST_BYTES = 1_024;
const MAX_RESPONSE_BYTES = 70 * 1_024;
const REQUEST_TIMEOUT_MS = 8_000;
const SOCKET_MODE = 0o660;
const AUDIT_ENABLED = "true";
const AUDITOR_DISABLED: ProcessorTransparencyAssessment = assessProcessorTransparency({ status: "auditor_error" });

type ProcessorAuditRequest = { protocolVersion: 1; requestId: string; operation: "read_processor_transparency" };
type ProcessorAuditResponse = { protocolVersion: 1; requestId: string; assessment: ProcessorTransparencyAssessment };
type ServerOptions = { socketPath: string; socketUid: number; socketGid: number };
type ReadAssessment = (signal: AbortSignal) => Promise<ProcessorTransparencyAssessment>;

export async function startProcessorAuditor(
  environment: NodeJS.ProcessEnv,
  options: ServerOptions,
  readAssessment?: ReadAssessment,
): Promise<{ close: () => Promise<void> }> {
  const runtime = !readAssessment && environment.AUDIT_ENABLED === AUDIT_ENABLED
    ? createInternalAuditRuntime(environment)
    : null;
  const read = readAssessment ?? (runtime
    ? (signal) => runtime.readProcessorTransparency(signal)
    : async () => AUDITOR_DISABLED);
  await assertSocketDirectory(options.socketPath, options.socketUid, options.socketGid);
  const server = createServer((socket) => handleConnection(socket, read));
  await listen(server, options.socketPath);
  try {
    await chmod(options.socketPath, SOCKET_MODE);
    const socket = await lstat(options.socketPath);
    if (!socket.isSocket() || socket.uid !== options.socketUid || socket.gid !== options.socketGid ||
        (socket.mode & 0o007) !== 0) throw new Error("socket_untrusted");
  } catch {
    await closeServer(server);
    await unlink(options.socketPath).catch(() => undefined);
    throw new Error("processor_auditor_socket_setup_failed");
  }
  return { close: async () => { await closeServer(server); await unlink(options.socketPath).catch(() => undefined); } };
}

function handleConnection(socket: Socket, read: ReadAssessment): void {
  let received = 0;
  let dispatched = false;
  const chunks: Buffer[] = [];
  const controller = new AbortController();
  const timeout = setTimeout(() => {
    controller.abort();
    socket.destroy();
  }, REQUEST_TIMEOUT_MS);
  socket.once("close", () => {
    clearTimeout(timeout);
    controller.abort();
  });
  socket.on("data", (chunk) => {
    if (dispatched) { socket.destroy(); return; }
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    received += buffer.byteLength;
    if (received > MAX_REQUEST_BYTES) { socket.destroy(); return; }
    chunks.push(buffer);
    const bytes = Buffer.concat(chunks);
    const newline = bytes.indexOf(0x0a);
    if (newline < 0) return;
    if (newline !== bytes.byteLength - 1) { socket.destroy(); return; }
    dispatched = true;
    clearTimeout(timeout);
    let request: ProcessorAuditRequest;
    try {
      const value: unknown = JSON.parse(bytes.subarray(0, newline).toString("utf8"));
      if (!isRequest(value)) { socket.destroy(); return; }
      request = value;
    } catch {
      socket.destroy();
      return;
    }
    void read(controller.signal).catch(() => AUDITOR_DISABLED).then((assessment) => {
      if (controller.signal.aborted || socket.destroyed) return;
      const response: ProcessorAuditResponse = { protocolVersion: 1, requestId: request.requestId, assessment };
      const payload = `${JSON.stringify(response)}\n`;
      if (Buffer.byteLength(payload) > MAX_RESPONSE_BYTES) { socket.destroy(); return; }
      socket.end(payload);
    });
  });
}

function isRequest(value: unknown): value is ProcessorAuditRequest {
  if (!isRecord(value)) return false;
  const keys = Object.keys(value);
  return hasExactRequestKeys(keys) &&
    value.protocolVersion === 1 && value.operation === "read_processor_transparency" &&
    typeof value.requestId === "string" && /^[0-9a-f-]{36}$/iu.test(value.requestId);
}

function hasExactRequestKeys(keys: string[]): boolean {
  return keys.length === 3 && ["operation", "protocolVersion", "requestId"].every((key) => keys.includes(key));
}

async function assertSocketDirectory(path: string, uid: number, gid: number): Promise<void> {
  try {
    const directory = await stat(dirname(path));
    if (!directory.isDirectory() || directory.uid !== uid || directory.gid !== gid || (directory.mode & 0o027) !== 0) {
      throw new Error("socket_directory_untrusted");
    }
    try { await lstat(path); throw new Error("socket_already_exists"); } catch (error) {
      if (error instanceof Error && error.message === "socket_already_exists") throw error;
    }
  } catch { throw new Error("processor_auditor_socket_directory_untrusted"); }
}

async function listen(server: Server, path: string): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const onError = (error: Error) => { server.removeListener("listening", onListening); reject(error); };
    const onListening = () => { server.removeListener("error", onError); resolve(); };
    server.once("error", onError);
    server.once("listening", onListening);
    server.listen(path);
  });
}

async function closeServer(server: Server): Promise<void> {
  if (!server.listening) return;
  await new Promise<void>((resolve) => server.close(() => resolve()));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
