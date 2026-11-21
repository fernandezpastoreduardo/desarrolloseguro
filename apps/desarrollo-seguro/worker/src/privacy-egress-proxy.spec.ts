import { createServer, connect as netConnect, type AddressInfo, type Server, type Socket } from "node:net";
import { request as httpRequest } from "node:http";
import { afterEach, describe, expect, it } from "vitest";
import { createPrivacyEgressProxy } from "./privacy-egress-proxy.js";

const proxies: Array<ReturnType<typeof createPrivacyEgressProxy>> = [];
const servers: Server[] = [];
const clients: Socket[] = [];

afterEach(async () => {
  await Promise.all(proxies.splice(0).map((proxy) => proxy.close()));
  await Promise.all(clients.splice(0).map((socket) => new Promise<void>((resolve) => {
    socket.destroy();
    resolve();
  })));
  await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve) => server.close(() => resolve()))));
});

describe("privacy egress proxy", () => {
  it("pins CONNECT traffic and counts response bytes without recording payloads", async () => {
    const target = createServer((socket) => socket.on("data", (chunk) => socket.write(chunk)));
    servers.push(target);
    const targetAddress = await listen(target);
    const proxy = createPrivacyEgressProxy({
      host: "127.0.0.1",
      maxReceivedBytes: 64,
      lookup: async () => [{ address: "8.8.8.8", family: 4 }],
      connectPinned: () => connectLocal(targetAddress.port),
    });
    proxies.push(proxy);
    const proxyAddress = await proxy.listen();

    const response = await connectThroughProxy(proxyAddress, "public.example.net:443", "hello");

    expect(response.statusCode).toBe(200);
    expect(response.payload).toBe("hello");
    expect(proxy.stats()).toMatchObject({ openedConnections: 1, receivedBytes: 5, budgetExceeded: false });
  });

  it("stops tunnels as soon as the aggregate received-byte budget is exceeded", async () => {
    const target = createServer((socket) => socket.on("data", () => socket.write("response-too-large")));
    servers.push(target);
    const targetAddress = await listen(target);
    const proxy = createPrivacyEgressProxy({
      host: "127.0.0.1",
      maxReceivedBytes: 4,
      lookup: async () => [{ address: "8.8.8.8", family: 4 }],
      connectPinned: () => connectLocal(targetAddress.port),
    });
    proxies.push(proxy);
    const proxyAddress = await proxy.listen();

    await connectThroughProxy(proxyAddress, "public.example.net:443", "start");

    expect(proxy.stats().receivedBytes).toBe(4);
    expect(proxy.stats().budgetExceeded).toBe(true);
  });

  it("rejects private DNS answers before opening an upstream connection", async () => {
    let connected = false;
    const target = createServer(() => { connected = true; });
    servers.push(target);
    const targetAddress = await listen(target);
    const proxy = createPrivacyEgressProxy({
      host: "127.0.0.1",
      maxReceivedBytes: 64,
      lookup: async () => [{ address: "169.254.169.254", family: 4 }],
      connectPinned: () => connectLocal(targetAddress.port),
    });
    proxies.push(proxy);
    const proxyAddress = await proxy.listen();

    const response = await connectThroughProxy(proxyAddress, "metadata.example.net:443", "unused");

    expect(response.statusCode).toBe(502);
    expect(connected).toBe(false);
  });

  it("blocks non-read methods on clear HTTP proxy requests", async () => {
    const proxy = createPrivacyEgressProxy({ host: "127.0.0.1", maxReceivedBytes: 64 });
    proxies.push(proxy);
    const proxyAddress = await proxy.listen();

    const statusCode = await new Promise<number>((resolve, reject) => {
      const request = httpRequest({
        host: "127.0.0.1",
        port: proxyAddress.port,
        method: "POST",
        path: "http://public.example.net/consent",
        headers: { Host: "public.example.net" },
      }, (response) => {
        response.resume();
        response.on("end", () => resolve(response.statusCode ?? 0));
      });
      request.once("error", reject);
      request.end();
    });

    expect(statusCode).toBe(405);
  });
});

function listen(server: Server): Promise<AddressInfo> {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.removeListener("error", reject);
      resolve(server.address() as AddressInfo);
    });
  });
}

function connectLocal(port: number): Socket {
  const socket = netConnect({ host: "127.0.0.1", port });
  clients.push(socket);
  return socket;
}

function connectThroughProxy(
  address: AddressInfo,
  authority: string,
  payload: string,
): Promise<{ statusCode: number; payload: string }> {
  return new Promise((resolve, reject) => {
    const request = httpRequest({
      host: "127.0.0.1",
      port: address.port,
      method: "CONNECT",
      path: authority,
    });
    request.once("error", reject);
    request.once("connect", (response, socket, head) => {
      clients.push(socket);
      let received = head.toString();
      const timer = setTimeout(() => {
        socket.destroy();
        reject(new Error("proxy_test_timeout"));
      }, 2_000);
      socket.on("data", (chunk: Buffer) => {
        received += chunk.toString();
        if (received.includes(payload)) {
          clearTimeout(timer);
          resolve({ statusCode: response.statusCode ?? 0, payload: received.slice(received.indexOf(payload)) });
          socket.end();
        }
      });
      socket.on("close", () => {
        clearTimeout(timer);
        if (!received.includes(payload)) resolve({ statusCode: response.statusCode ?? 0, payload: received });
      });
      socket.write(payload);
    });
    request.end();
  });
}
