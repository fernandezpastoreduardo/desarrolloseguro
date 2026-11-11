import { randomUUID } from "node:crypto";
import { chmod, stat } from "node:fs/promises";
import { createConnection, createServer, type Server, type Socket } from "node:net";
import { dirname } from "node:path";
import { normalizeHostname } from "@desarrolloseguro/core";
import {
  createTransportV1EgressBroker,
  type TransportV1BrokerRequest,
  type TransportV1BrokerResponse,
  type TransportV1ProbeOperation,
} from "./transport-v1-egress-broker.js";
import type {
  TransportV1ObservationSource,
  TransportV1ProbeResult,
} from "./transport-v1-executor.js";
import {
  MAX_TRANSPORT_BYTES_PER_SCAN,
  MAX_TRANSPORT_REQUESTS_PER_SCAN,
} from "./transport-v1-executor-protocol.js";

const MAX_IPC_REQUEST_BYTES = 4 * 1024;
const MAX_IPC_RESPONSE_BYTES = 32 * 1024;
// Allow one short-lived connection per bounded probe. Completed client sockets
// can remain open briefly while their close events propagate; the broker still
// limits active network observations to two at a time.
const MAX_IPC_CONNECTIONS = 5;
const IPC_TIMEOUT_MS = 15_000;
const FORBIDDEN_EVIDENCE_KEYS = new Set(["__proto__", "constructor", "prototype"]);
const SAFE_PROBE_ERROR_CODES = new Set([
  "dns_resolution_failed", "connection_failed", "broker_failed",
  "request_aborted", "request_timeout", "response_size_limit_exceeded",
  "https_request_failed", "http_request_failed", "invalid_http_response",
  "redirect_limit_exceeded", "redirect_origin_not_allowlisted",
  "redirect_path_not_allowlisted", "tls_certificate_invalid",
  "tls_handshake_failed", "transport_failed",
]);
/** Starts a per-job broker on a Unix domain socket with restrictive permissions. */
export async function listenTransportV1EgressBroker(
  socketPath: string,
  jobHostnameInput: unknown,
  source: TransportV1ObservationSource,
): Promise<{ close: () => Promise<void> }> {
  if (process.platform === "win32" || socketPath.length === 0) {
    throw new Error("egress_broker_socket_invalid");
  }
  await assertPrivateSocketDirectory(socketPath);
  const jobHostname = normalizeHostname(jobHostnameInput);
  const broker = createTransportV1EgressBroker(jobHostname, source);
  let activeConnections = 0;
  const server = createServer((socket) => {
    if (activeConnections >= MAX_IPC_CONNECTIONS) {
      socket.destroy();
      return;
    }
    activeConnections += 1;
    handleConnection(socket, broker, () => {
      activeConnections -= 1;
    });
  });
  await listen(server, socketPath);
  try {
    await chmod(socketPath, 0o660);
  } catch (error) {
    await closeServer(server);
    throw error;
  }
  return { close: () => closeServer(server) };
}

/** Adapts the fixed probe API to request/response calls over a Unix socket. */
export function createUnixSocketObservationSource(
  socketPath: string,
): TransportV1ObservationSource {
  if (process.platform === "win32" || socketPath.length === 0) {
    throw new Error("egress_broker_socket_invalid");
  }
  return {
    sourceKind: "network",
    observeDns: (hostname, signal) => requestOperation(socketPath, hostname, "dns", signal),
    observeTls: (hostname, signal) => requestOperation(socketPath, hostname, "tls", signal),
    observeHttp: (hostname, method, signal) =>
      requestOperation(socketPath, hostname, method === "HEAD" ? "http-head" : "http-get", signal),
    observeHeaders: (hostname, signal) => requestOperation(socketPath, hostname, "headers", signal),
  };
}

function handleConnection(
  socket: Socket,
  broker: (request: unknown, signal: AbortSignal) => Promise<TransportV1BrokerResponse>,
  onClose: () => void,
): void {
  let receivedBytes = 0;
  const chunks: Buffer[] = [];
  const controller = new AbortController();
  const timeout = setTimeout(() => socket.destroy(), IPC_TIMEOUT_MS);
  socket.once("close", () => {
    clearTimeout(timeout);
    controller.abort();
    onClose();
  });
  socket.on("data", (chunk: Buffer) => {
    receivedBytes += chunk.byteLength;
    if (receivedBytes > MAX_IPC_REQUEST_BYTES) {
      socket.destroy();
      return;
    }
    const newline = chunk.indexOf(0x0a);
    if (newline >= 0) {
      chunks.push(chunk.subarray(0, newline));
      void dispatchRequest(socket, Buffer.concat(chunks), broker, controller.signal, timeout);
      socket.removeAllListeners("data");
      return;
    }
    chunks.push(chunk);
  });
}

async function assertPrivateSocketDirectory(socketPath: string): Promise<void> {
  let directory: Awaited<ReturnType<typeof stat>>;
  try {
    directory = await stat(dirname(socketPath));
  } catch {
    throw new Error("egress_broker_socket_directory_invalid");
  }
  if (
    !directory.isDirectory() ||
    directory.uid !== process.getuid?.() ||
    (directory.mode & 0o077) !== 0
  ) {
    throw new Error("egress_broker_socket_directory_invalid");
  }
}

async function dispatchRequest(
  socket: Socket,
  bytes: Buffer,
  broker: (request: unknown, signal: AbortSignal) => Promise<TransportV1BrokerResponse>,
  signal: AbortSignal,
  timeout: ReturnType<typeof setTimeout>,
): Promise<void> {
  let requestId = "";
  try {
    const request: unknown = JSON.parse(bytes.toString("utf8"));
    if (isRecord(request) && typeof request.requestId === "string") {
      requestId = request.requestId;
    }
    const response = await broker(request, signal);
    const payload = Buffer.from(`${JSON.stringify(response)}\n`, "utf8");
    if (payload.byteLength > MAX_IPC_RESPONSE_BYTES) {
      socket.destroy();
      return;
    }
    socket.end(payload);
  } catch {
    socket.end(`${JSON.stringify({ protocolVersion: 1, requestId, errorCode: "request_invalid" })}\n`);
  } finally {
    clearTimeout(timeout);
  }
}

async function requestOperation(
  socketPath: string,
  hostnameInput: string,
  operation: TransportV1ProbeOperation,
  signal: AbortSignal,
): Promise<TransportV1ProbeResult> {
  const hostname = normalizeHostname(hostnameInput);
  const request: TransportV1BrokerRequest = {
    protocolVersion: 1,
    requestId: randomUUID(),
    hostname,
    operation,
  };
  const response = await exchange(socketPath, request, signal);
  if (
    isRecord(response) &&
    Reflect.ownKeys(response).length === 3 &&
    response.protocolVersion === 1 &&
    response.requestId === request.requestId &&
    response.errorCode === "request_invalid"
  ) {
    throw new Error("egress_broker_request_invalid");
  }
  if (
    !isRecord(response) ||
    Reflect.ownKeys(response).length !== 3 ||
    response.protocolVersion !== 1 ||
    response.requestId !== request.requestId ||
    !isRecord(response.result) ||
    (Reflect.ownKeys(response.result).length !== 3 &&
      Reflect.ownKeys(response.result).length !== 4) ||
    !isRecord(response.result.evidence) ||
    !Number.isSafeInteger(response.result.requestsCount) ||
    (response.result.requestsCount as number) < 0 ||
    (response.result.requestsCount as number) > MAX_TRANSPORT_REQUESTS_PER_SCAN ||
    !Number.isSafeInteger(response.result.bytesCount) ||
    (response.result.bytesCount as number) < 0 ||
    (response.result.bytesCount as number) > MAX_TRANSPORT_BYTES_PER_SCAN ||
    (Object.hasOwn(response.result, "errorCode") &&
      (typeof response.result.errorCode !== "string" ||
        !SAFE_PROBE_ERROR_CODES.has(response.result.errorCode))) ||
    Object.keys(response.result.evidence).length > 32 ||
    Object.entries(response.result.evidence).some(
      ([key, value]) =>
        key.length > 64 ||
        FORBIDDEN_EVIDENCE_KEYS.has(key) ||
        (typeof value !== "boolean" && typeof value !== "string" && typeof value !== "number") ||
        (typeof value === "string" && value.length > 256) ||
        (typeof value === "number" && !Number.isFinite(value)),
    )
  ) {
    throw new Error("egress_broker_response_invalid");
  }
  return {
    evidence: response.result.evidence as TransportV1ProbeResult["evidence"],
    requestsCount: response.result.requestsCount as number,
    bytesCount: response.result.bytesCount as number,
    ...(typeof response.result.errorCode === "string"
      ? { errorCode: response.result.errorCode as TransportV1ProbeResult["errorCode"] }
      : {}),
  };
}

function exchange(
  socketPath: string,
  request: TransportV1BrokerRequest,
  signal: AbortSignal,
): Promise<unknown> {
  if (signal.aborted) return Promise.reject(new Error("egress_broker_aborted"));
  return new Promise((resolve, reject) => {
    const socket = createConnection(socketPath);
    let receivedBytes = 0;
    const chunks: Buffer[] = [];
    const timeout = setTimeout(() => socket.destroy(new Error("egress_broker_timeout")), IPC_TIMEOUT_MS);
    const onAbort = () => socket.destroy(new Error("egress_broker_aborted"));
    signal.addEventListener("abort", onAbort, { once: true });
    const cleanup = () => {
      clearTimeout(timeout);
      signal.removeEventListener("abort", onAbort);
    };
    socket.once("connect", () => socket.write(`${JSON.stringify(request)}\n`));
    socket.on("data", (chunk: Buffer) => {
      receivedBytes += chunk.byteLength;
      if (receivedBytes > MAX_IPC_RESPONSE_BYTES) {
        socket.destroy(new Error("egress_broker_response_invalid"));
        return;
      }
      const newline = chunk.indexOf(0x0a);
      if (newline >= 0) {
        chunks.push(chunk.subarray(0, newline));
        try {
          resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown);
        } catch {
          reject(new Error("egress_broker_response_invalid"));
        }
        socket.end();
      } else {
        chunks.push(chunk);
      }
    });
    socket.once("error", (error) => reject(error));
    socket.once("close", cleanup);
  });
}

function listen(server: Server, socketPath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(socketPath, () => {
      server.removeListener("error", reject);
      resolve();
    });
  });
}

function closeServer(server: Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype
  );
}
