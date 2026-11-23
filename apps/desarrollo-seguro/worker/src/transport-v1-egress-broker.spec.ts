import { randomUUID } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import type { TransportV1ObservationSource } from "./transport-v1-executor.js";
import { createTransportV1EgressBroker } from "./transport-v1-egress-broker.js";

const HOSTNAME = "sample.example.net";

function makeSource(): TransportV1ObservationSource {
  const result = {
    evidence: { ok: true },
    requestsCount: 1,
    bytesCount: 4,
  };
  return {
    sourceKind: "network",
    observeDns: vi.fn().mockResolvedValue(result),
    observeTls: vi.fn().mockResolvedValue(result),
    observeHttp: vi.fn().mockResolvedValue(result),
    observeHeaders: vi.fn().mockResolvedValue(result),
  };
}

function request(operation: string, overrides: Record<string, unknown> = {}) {
  return {
    protocolVersion: 1,
    requestId: randomUUID(),
    hostname: HOSTNAME,
    operation,
    ...overrides,
  };
}

describe("createTransportV1EgressBroker", () => {
  it("exposes only the five fixed profile operations for the authorized host", async () => {
    const source = makeSource();
    const broker = createTransportV1EgressBroker(HOSTNAME, source);
    const signal = new AbortController().signal;

    for (const operation of ["dns", "tls", "http-head", "http-get", "headers"]) {
      const brokerRequest = request(operation);
      await expect(broker(brokerRequest, signal)).resolves.toEqual({
        protocolVersion: 1,
        requestId: brokerRequest.requestId,
        result: { evidence: { ok: true }, requestsCount: 1, bytesCount: 4 },
      });
    }

    expect(source.observeDns).toHaveBeenCalledExactlyOnceWith(HOSTNAME, signal);
    expect(source.observeTls).toHaveBeenCalledExactlyOnceWith(HOSTNAME, signal);
    expect(source.observeHttp).toHaveBeenNthCalledWith(1, HOSTNAME, "HEAD", signal);
    expect(source.observeHttp).toHaveBeenNthCalledWith(2, HOSTNAME, "GET", signal);
    expect(source.observeHeaders).toHaveBeenCalledExactlyOnceWith(HOSTNAME, signal);
  });

  it.each([
    ["different host", request("dns", { hostname: "other.example.net" })],
    ["unsupported operation", request("connect")],
    ["arbitrary path", request("http-get", { path: "/admin" })],
    ["alternate method", request("http-get", { method: "POST" })],
    ["extra field", request("dns", { port: 443 })],
    ["bad request id", request("dns", { requestId: "invalid" })],
  ])("rejects %s without invoking the observer", async (_label, input) => {
    const source = makeSource();
    const broker = createTransportV1EgressBroker(HOSTNAME, source);

    await expect(broker(input, new AbortController().signal)).rejects.toThrow(
      "egress_broker_request_invalid",
    );
    expect(source.observeDns).not.toHaveBeenCalled();
    expect(source.observeTls).not.toHaveBeenCalled();
    expect(source.observeHttp).not.toHaveBeenCalled();
    expect(source.observeHeaders).not.toHaveBeenCalled();
  });

  it("rejects duplicate operations for the same job", async () => {
    const source = makeSource();
    const broker = createTransportV1EgressBroker(HOSTNAME, source);
    const signal = new AbortController().signal;

    const brokerRequest = request("dns");
    await broker(brokerRequest, signal);
    await expect(broker(brokerRequest, signal)).rejects.toThrow(
      "egress_broker_request_invalid",
    );
    expect(source.observeDns).toHaveBeenCalledTimes(1);
  });

  it("rejects replaying a request id for a different operation", async () => {
    const source = makeSource();
    const broker = createTransportV1EgressBroker(HOSTNAME, source);
    const signal = new AbortController().signal;
    const dnsRequest = request("dns");

    await broker(dnsRequest, signal);
    await expect(
      broker({ ...dnsRequest, operation: "tls" }, signal),
    ).rejects.toThrow("egress_broker_request_invalid");
    expect(source.observeTls).not.toHaveBeenCalled();
  });

  it("returns empty evidence for invalid or over-budget observer results", async () => {
    const source = makeSource();
    vi.mocked(source.observeDns).mockResolvedValueOnce({
      evidence: { body: "x".repeat(257) },
      requestsCount: 1,
      bytesCount: 4,
    });
    vi.mocked(source.observeTls).mockResolvedValueOnce({
      evidence: { valid: true },
      requestsCount: 24,
      bytesCount: 4,
    });
    const pollutedEvidence = Object.defineProperty(
      { safe: true },
      "__proto__",
      { value: true, enumerable: true },
    );
    vi.mocked(source.observeHeaders).mockResolvedValueOnce({
      evidence: pollutedEvidence,
      requestsCount: 0,
      bytesCount: 0,
    });
    vi.mocked(source.observeHttp).mockResolvedValueOnce({
      evidence: { statusCode: 200 },
      requestsCount: 301,
      bytesCount: 4,
    });
    const broker = createTransportV1EgressBroker(HOSTNAME, source);
    const signal = new AbortController().signal;

    await expect(broker(request("dns"), signal)).resolves.toMatchObject({
      result: { evidence: {}, requestsCount: 0, bytesCount: 0 },
    });
    await expect(broker(request("tls"), signal)).resolves.toMatchObject({
      result: { evidence: { valid: true }, requestsCount: 24, bytesCount: 4 },
    });
    await expect(broker(request("headers"), signal)).resolves.toMatchObject({
      result: { evidence: {}, requestsCount: 0, bytesCount: 0 },
    });
    await expect(broker(request("http-head"), signal)).resolves.toMatchObject({
      result: { evidence: {}, requestsCount: 0, bytesCount: 0 },
    });
    await expect(broker(request("http-get"), signal)).resolves.toMatchObject({
      result: { evidence: { ok: true }, requestsCount: 1, bytesCount: 4 },
    });
  });
});
