import { createServer, request as httpRequest, type IncomingMessage, type ServerResponse } from "node:http";
import { connect as tcpConnect, type Socket } from "node:net";
import type { AddressInfo } from "node:net";
import { resolvePinnedPublicIpv4, type PrivacyDnsLookup } from "./privacy-egress-policy.js";

const MAX_AUTHORITY_BYTES = 512;
const MAX_ACTIVE_CONNECTIONS = 32;
const TARGET_CONNECT_TIMEOUT_MS = 5_000;
const HOP_BY_HOP_HEADERS = new Set([
  "connection", "keep-alive", "proxy-authenticate", "proxy-authorization",
  "proxy-connection", "te", "trailer", "transfer-encoding", "upgrade",
]);

export type PrivacyEgressProxyStats = {
  activeConnections: number;
  openedConnections: number;
  receivedBytes: number;
  budgetExceeded: boolean;
};

export type PrivacyEgressProxyOptions = {
  host?: string;
  port?: number;
  maxReceivedBytes: number;
  maxConnections?: number;
  lookup?: PrivacyDnsLookup;
  connectPinned?: (address: string, port: number) => Socket;
};

/** A per-analysis forward proxy: pinned public IPv4 only, web ports, GET/HEAD cleartext, capped download bytes. */
export function createPrivacyEgressProxy(options: PrivacyEgressProxyOptions) {
  const maxConnections = options.maxConnections ?? MAX_ACTIVE_CONNECTIONS;
  if (!Number.isSafeInteger(options.maxReceivedBytes) || options.maxReceivedBytes < 1 ||
      !Number.isSafeInteger(maxConnections) || maxConnections < 1 || maxConnections > 128) {
    throw new Error("privacy_proxy_configuration_invalid");
  }

  const clients = new Set<Socket>();
  let openedConnections = 0;
  let receivedBytes = 0;
  let budgetExceeded = false;

  const server = createServer({ maxHeaderSize: 16 * 1024 }, (request, response) => {
    void handleHttpRequest(request, response);
  });
  server.on("connect", (request, clientStream, head) => {
    void handleTunnel(request, clientStream as Socket, head);
  });
  server.on("upgrade", (_request, socket) => rejectSocket(socket as Socket, 405));
  server.on("clientError", (_error, socket) => rejectSocket(socket as Socket, 400));

  async function handleTunnel(request: IncomingMessage, client: Socket, head: Buffer) {
    const endpoint = parseAuthority(request.url, 443);
    if (!endpoint || !admitConnection(client)) return;
    try {
      const address = await resolvePinnedPublicIpv4(endpoint.hostname, options.lookup);
      const upstream = connect(endpoint.port, address);
      clients.add(upstream);
      upstream.once("close", () => clients.delete(upstream));
      await waitForConnect(upstream);
      client.write("HTTP/1.1 200 Connection Established\r\nProxy-Agent: ds-privacy-egress\r\n\r\n");
      if (head.length > 0) upstream.write(head);
      tunnel(client, upstream);
    } catch {
      rejectSocket(client, 502);
    }
  }

  async function handleHttpRequest(request: IncomingMessage, response: ServerResponse) {
    if (request.method !== "GET" && request.method !== "HEAD") {
      rejectResponse(response, 405);
      return;
    }
    if (request.headers.authorization || request.headers["content-length"] && request.headers["content-length"] !== "0" || request.headers["transfer-encoding"]) {
      rejectResponse(response, 403);
      return;
    }
    let target: URL;
    try {
      target = new URL(request.url ?? "");
    } catch {
      rejectResponse(response, 400);
      return;
    }
    if (target.protocol !== "http:" || target.port !== "" && target.port !== "80" || target.username || target.password) {
      rejectResponse(response, 403);
      return;
    }
    const expectedHost = target.port ? `${target.hostname}:80` : target.hostname;
    if (request.headers.host?.toLowerCase() !== expectedHost.toLowerCase()) {
      rejectResponse(response, 400);
      return;
    }
    if (!admitRequest()) {
      rejectResponse(response, 509);
      return;
    }
    let address: string;
    try {
      address = await resolvePinnedPublicIpv4(target.hostname, options.lookup);
    } catch {
      rejectResponse(response, 502);
      return;
    }
    const headers = copySafeHeaders(request.headers);
    headers.host = target.host;
    const upstream = httpRequest({
      host: address,
      family: 4,
      port: 80,
      method: request.method,
      path: `${target.pathname}${target.search}`,
      headers,
      agent: false,
      timeout: TARGET_CONNECT_TIMEOUT_MS,
    }, (upstreamResponse) => {
      const safeHeaders = copySafeHeaders(upstreamResponse.headers);
      response.writeHead(upstreamResponse.statusCode ?? 502, safeHeaders);
      upstreamResponse.on("data", (chunk: Buffer) => {
        const result = writeReceived(response, chunk);
        if (!result.withinBudget) upstreamResponse.destroy();
        else if (!result.writable) upstreamResponse.pause();
      });
      response.on("drain", () => upstreamResponse.resume());
      upstreamResponse.on("end", () => response.end());
      upstreamResponse.on("error", () => response.destroy());
    });
    upstream.on("timeout", () => upstream.destroy(new Error("privacy_proxy_target_timeout")));
    upstream.on("error", () => {
      if (!response.headersSent) rejectResponse(response, 502);
      else response.destroy();
    });
    request.on("aborted", () => upstream.destroy());
    upstream.end();
  }

  function admitConnection(client: Socket): boolean {
    if (budgetExceeded || clients.size >= maxConnections || openedConnections >= (options.maxConnections ?? 300)) {
      rejectSocket(client, 509);
      return false;
    }
    openedConnections += 1;
    clients.add(client);
    client.once("close", () => clients.delete(client));
    return true;
  }

  function admitRequest(): boolean {
    if (budgetExceeded || openedConnections >= (options.maxConnections ?? 300)) return false;
    openedConnections += 1;
    return true;
  }

  function connect(port: number, address: string): Socket {
    return options.connectPinned?.(address, port) ?? tcpConnect({ host: address, port, family: 4 });
  }

  function tunnel(client: Socket, upstream: Socket) {
    client.setTimeout(TARGET_CONNECT_TIMEOUT_MS, () => closePair(client, upstream));
    upstream.setTimeout(TARGET_CONNECT_TIMEOUT_MS, () => closePair(client, upstream));
    client.on("data", (chunk) => {
      if (!upstream.write(chunk)) client.pause();
    });
    upstream.on("drain", () => client.resume());
    upstream.on("data", (chunk: Buffer | string) => {
      const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      const result = writeReceived(client, bytes);
      if (!result.withinBudget) closePair(client, upstream);
      else if (!result.writable) upstream.pause();
    });
    client.on("drain", () => upstream.resume());
    client.once("end", () => upstream.end());
    upstream.once("end", () => client.end());
    client.once("error", () => closePair(client, upstream));
    upstream.once("error", () => closePair(client, upstream));
    client.once("close", () => upstream.destroy());
    upstream.once("close", () => client.destroy());
  }

  function writeReceived(destination: Socket | ServerResponse, chunk: Buffer): { withinBudget: boolean; writable: boolean } {
    const remaining = Math.max(0, options.maxReceivedBytes - receivedBytes);
    const allowed = chunk.subarray(0, remaining);
    receivedBytes += allowed.byteLength;
    const writable = allowed.length === 0 || destination.write(allowed);
    if (allowed.byteLength !== chunk.byteLength) {
      budgetExceeded = true;
      for (const socket of clients) socket.destroy();
      server.close();
      return { withinBudget: false, writable };
    }
    return { withinBudget: true, writable };
  }

  function listen(): Promise<AddressInfo> {
    return new Promise((resolve, reject) => {
      server.once("error", reject);
      server.listen(options.port ?? 0, options.host ?? "0.0.0.0", () => {
        server.removeListener("error", reject);
        resolve(server.address() as AddressInfo);
      });
    });
  }

  async function close(): Promise<void> {
    for (const socket of clients) socket.destroy();
    if (!server.listening) return;
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }

  return {
    listen,
    close,
    stats: (): PrivacyEgressProxyStats => ({
      activeConnections: clients.size,
      openedConnections,
      receivedBytes,
      budgetExceeded,
    }),
  };

  function rejectSocket(socket: Socket, statusCode: number) {
    if (!socket.destroyed) socket.end(`HTTP/1.1 ${statusCode} ${statusText(statusCode)}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);
  }

  function rejectResponse(response: ServerResponse, statusCode: number) {
    if (response.headersSent) response.destroy();
    else response.writeHead(statusCode, { Connection: "close", "Content-Length": "0" }).end();
  }
}

function parseAuthority(authority: string | undefined, requiredPort: number): { hostname: string; port: number } | null {
  if (!authority || authority.length > MAX_AUTHORITY_BYTES) return null;
  const match = /^([^:]+):(\d{1,5})$/u.exec(authority);
  if (!match || Number(match[2]) !== requiredPort) return null;
  const hostname = match[1]!.toLowerCase().replace(/\.$/u, "");
  if (!/^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/u.test(hostname)) return null;
  return { hostname, port: requiredPort };
}

function waitForConnect(socket: Socket): Promise<void> {
  return new Promise((resolve, reject) => {
    socket.setTimeout(TARGET_CONNECT_TIMEOUT_MS);
    socket.once("connect", () => {
      socket.setTimeout(0);
      resolve();
    });
    socket.once("error", () => reject(new Error("privacy_proxy_target_unavailable")));
    socket.once("timeout", () => socket.destroy(new Error("privacy_proxy_target_timeout")));
  });
}

function copySafeHeaders(headers: IncomingMessage["headers"]): Record<string, string | string[]> {
  return Object.fromEntries(Object.entries(headers)
    .filter(([name, value]) => value !== undefined && !HOP_BY_HOP_HEADERS.has(name.toLowerCase()))
    .map(([name, value]) => [name, value!]));
}

function closePair(client: Socket, upstream: Socket) {
  client.destroy();
  upstream.destroy();
}

function statusText(statusCode: number): string {
  if (statusCode === 400) return "Bad Request";
  if (statusCode === 403) return "Forbidden";
  if (statusCode === 405) return "Method Not Allowed";
  if (statusCode === 509) return "Bandwidth Limit Exceeded";
  return "Bad Gateway";
}
