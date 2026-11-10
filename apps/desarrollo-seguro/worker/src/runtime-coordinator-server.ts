import { chmod, lstat, stat, unlink } from "node:fs/promises";
import { createServer, type Server, type Socket } from "node:net";
import { dirname } from "node:path";
import type { ScanRunInput } from "@desarrolloseguro/persistence";
import {
  MAX_EXECUTOR_REQUEST_BYTES,
  MAX_EXECUTOR_RESPONSE_BYTES,
  parseTransportV1ExecutorRequest,
  parseTransportV1ExecutorResponse,
  type TransportV1ExecutorRequest,
} from "./transport-v1-executor-protocol.js";

const MAX_ACTIVE_JOBS = 1;
const REQUEST_TIMEOUT_MS = 5_000;
const EXECUTION_TIMEOUT_MS = 40_000;
const SOCKET_MODE = 0o660;

export type RuntimeCoordinatorRunner = {
  execute(
    request: TransportV1ExecutorRequest,
    signal: AbortSignal,
  ): Promise<
    Omit<ScanRunInput, "jobId" | "leaseToken" | "hostname" | "profileVersion">
  >;
};

export type RuntimeCoordinatorServerOptions = {
  socketPath: string;
  socketUid: number;
  socketGid: number;
};

/** Serves one bounded runtime request over a protected Unix socket. */
export async function listenRuntimeCoordinator(
  options: RuntimeCoordinatorServerOptions,
  runner: RuntimeCoordinatorRunner,
): Promise<{ close: () => Promise<void> }> {
  if (
    process.platform === "win32" ||
    options.socketPath.length === 0 ||
    !Number.isSafeInteger(options.socketUid) ||
    options.socketUid < 0 ||
    !Number.isSafeInteger(options.socketGid) ||
    options.socketGid < 0
  ) {
    throw new Error("runtime_coordinator_config_invalid");
  }
  await assertPrivateSocketDirectory(options.socketPath, options.socketUid, options.socketGid);
  const server = createServer();
  let activeJobs = 0;
  const controllers = new Set<AbortController>();
  const clients = new Set<Socket>();
  const activeTasks = new Set<Promise<void>>();
  server.on("connection", (socket) => {
    if (activeJobs >= MAX_ACTIVE_JOBS) {
      socket.destroy();
      return;
    }
    activeJobs += 1;
    clients.add(socket);
    handleRequest(socket, runner, controllers, activeTasks, () => {
      activeJobs -= 1;
      clients.delete(socket);
    });
  });

  await listen(server, options.socketPath);
  try {
    await chmod(options.socketPath, SOCKET_MODE);
    const socket = await lstat(options.socketPath);
    if (
      !socket.isSocket() ||
      socket.uid !== options.socketUid ||
      socket.gid !== options.socketGid ||
      (socket.mode & 0o007) !== 0
    ) {
      throw new Error("runtime_coordinator_socket_untrusted");
    }
  } catch {
    await closeServer(server);
    await unlink(options.socketPath).catch(() => undefined);
    throw new Error("runtime_coordinator_socket_setup_failed");
  }

  let closing = false;
  return {
    close: async () => {
      if (closing) return;
      closing = true;
      for (const controller of controllers) controller.abort();
      for (const client of clients) client.destroy();
      await closeServer(server);
      await Promise.allSettled([...activeTasks]);
      await unlink(options.socketPath).catch(() => undefined);
    },
  };
}

async function assertPrivateSocketDirectory(
  socketPath: string,
  expectedUid: number,
  expectedGid: number,
): Promise<void> {
  try {
    const directory = await stat(dirname(socketPath));
    if (
      !directory.isDirectory() ||
      directory.uid !== expectedUid ||
      directory.gid !== expectedGid ||
      (directory.mode & 0o027) !== 0
    ) {
      throw new Error("runtime_coordinator_socket_directory_untrusted");
    }
    try {
      await lstat(socketPath);
      throw new Error("runtime_coordinator_socket_already_exists");
    } catch (error) {
      if (error instanceof Error && error.message === "runtime_coordinator_socket_already_exists") {
        throw error;
      }
    }
  } catch {
    throw new Error("runtime_coordinator_socket_directory_untrusted");
  }
}

function handleRequest(
  socket: Socket,
  runner: RuntimeCoordinatorRunner,
  controllers: Set<AbortController>,
  activeTasks: Set<Promise<void>>,
  onClose: () => void,
): void {
  let receivedBytes = 0;
  const chunks: Buffer[] = [];
  const controller = new AbortController();
  controllers.add(controller);
  let completed = false;
  let dispatched = false;
  let executionSettled = false;
  const timeout = setTimeout(() => {
    controller.abort();
    socket.destroy();
  }, REQUEST_TIMEOUT_MS);
  const finish = () => {
    if (completed) return;
    completed = true;
    clearTimeout(timeout);
    controllers.delete(controller);
    onClose();
  };
  socket.once("close", () => {
    if (!completed) controller.abort();
    if (!dispatched || executionSettled) finish();
  });
  socket.on("data", (chunk) => {
    if (dispatched) {
      socket.destroy();
      return;
    }
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    receivedBytes += buffer.byteLength;
    if (receivedBytes > MAX_EXECUTOR_REQUEST_BYTES) {
      socket.destroy();
      return;
    }
    chunks.push(buffer);
    const requestBytes = Buffer.concat(chunks);
    const newline = requestBytes.indexOf(0x0a);
    if (newline < 0) return;
    if (newline !== requestBytes.byteLength - 1) {
      socket.destroy();
      return;
    }
    chunks.length = 0;
    chunks.push(requestBytes.subarray(0, newline));
    dispatchRequest();
  });
  socket.once("end", () => {
    if (!dispatched && !completed) socket.destroy();
  });

  function dispatchRequest(): void {
    if (dispatched || completed) return;
    dispatched = true;
    clearTimeout(timeout);
    let request: TransportV1ExecutorRequest;
    let input: unknown;
    try {
      input = JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
      request = parseTransportV1ExecutorRequest(input);
    } catch {
      const requestId = getRequestId(input);
      if (requestId) sendFailure(socket, requestId, "request_invalid");
      else socket.destroy();
      return;
    }
    const executionTimer = setTimeout(() => {
      controller.abort();
      sendFailure(socket, request.requestId);
    }, EXECUTION_TIMEOUT_MS);
    let execution: ReturnType<RuntimeCoordinatorRunner["execute"]>;
    try {
      execution = runner.execute(request, controller.signal);
    } catch {
      sendFailure(socket, request.requestId);
      finish();
      return;
    }
    const task = execution.then(
      (result) => {
        executionSettled = true;
        clearTimeout(executionTimer);
        if (!controller.signal.aborted && !socket.destroyed) {
          const response = parseTransportV1ExecutorResponse(
            {
              protocolVersion: 1,
              requestId: request.requestId,
              result: JSON.parse(JSON.stringify(result)) as unknown,
            },
            request.requestId,
          );
          sendResponse(socket, response);
        }
        finish();
      },
      () => {
        executionSettled = true;
        clearTimeout(executionTimer);
        if (!controller.signal.aborted && !socket.destroyed) {
          sendFailure(socket, request.requestId);
        }
        finish();
      },
    ).catch(() => {
      executionSettled = true;
      clearTimeout(executionTimer);
      if (!socket.destroyed) sendFailure(socket, request.requestId);
      finish();
    }).finally(() => {
      activeTasks.delete(task);
    });
    activeTasks.add(task);
  }
}

function sendResponse(
  socket: Socket,
  response: ReturnType<typeof parseTransportV1ExecutorResponse>,
): void {
  const payload = Buffer.from(JSON.stringify(response));
  if (payload.byteLength > MAX_EXECUTOR_RESPONSE_BYTES) {
    sendFailure(socket, response.requestId);
    return;
  }
  socket.end(payload);
}

function sendFailure(
  socket: Socket,
  requestId: string,
  errorCode: "request_invalid" | "executor_failed" = "executor_failed",
): void {
  socket.end(JSON.stringify({
    protocolVersion: 1,
    requestId,
    errorCode,
  }));
}

function getRequestId(input: unknown): string | null {
  if (
    typeof input !== "object" ||
    input === null ||
    Array.isArray(input) ||
    Object.getPrototypeOf(input) !== Object.prototype
  ) {
    return null;
  }
  const requestId = (input as Record<string, unknown>).requestId;
  return typeof requestId === "string" && /^[0-9a-f-]{36}$/iu.test(requestId)
    ? requestId
    : null;
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
    server.close((error) => {
      if (error) reject(error);
      else resolve();
    });
  });
}
