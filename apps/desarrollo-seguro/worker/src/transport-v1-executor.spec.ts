import { describe, expect, it, vi } from "vitest";
import type { ClaimedScanJob } from "@desarrolloseguro/persistence";
import {
  TransportV1FixtureExecutor,
  TransportV1NetworkExecutor,
  type TransportV1FixtureObservationSource,
  type TransportV1ObservationSource,
} from "./transport-v1-executor.js";

const JOB: ClaimedScanJob = {
  id: "d1d1d1d1-d1d1-41d1-81d1-d1d1d1d1d1d1",
  hostname: "sample.example.net",
  profileVersion: "transport-v1",
  trigger: "requested",
  attempts: 1,
  leaseToken: "fixture-lease-token",
  leaseUntil: new Date("2026-11-02T10:01:00.000Z"),
};

function makeSource(): TransportV1FixtureObservationSource {
  return {
    sourceKind: "fixture",
    observeDns: vi.fn().mockResolvedValue({
      addressClass: "public",
      aRecordCount: 1,
      aaaaRecordCount: 0,
    }),
    observeTls: vi.fn().mockResolvedValue({
      protocol: "TLSv1.3",
      certificateValid: true,
      hostnameMatches: true,
    }),
    observeHttp: vi.fn().mockResolvedValue({
      statusCode: 200,
      redirectedToHttps: true,
      finalScheme: "https",
    }),
    observeHeaders: vi.fn().mockResolvedValue({
      finalScheme: "https",
      hsts: true,
      nosniff: true,
      frameProtection: true,
      referrerPolicy: true,
      csp: true,
    }),
  };
}

describe("TransportV1FixtureExecutor", () => {
  it("assembles the exact reduced profile from observed evidence", async () => {
    const source = makeSource();
    const executor = new TransportV1FixtureExecutor(source);

    const result = await executor.execute(JOB, new AbortController().signal);

    expect(result.scope).toEqual(["/"]);
    expect(result.verdict).toBe("pass");
    expect(result.checks.map(({ controlId, method }) => [controlId, method])).toEqual([
      ["DS-DNS-01", "DNS"],
      ["DS-TLS-01", "TLS"],
      ["DS-HTTP-01", "HEAD"],
      ["DS-HTTP-01", "GET"],
      ["DS-HDR-01", "GET"],
    ]);
    expect(result.checks.every(({ status }) => status === "pass")).toBe(true);
    expect(source.observeHttp).toHaveBeenCalledTimes(2);
    expect(result.metrics.requestsCount).toBe(0);
  });

  it("keeps failed observations unknown and still returns full coverage", async () => {
    const source = makeSource();
    vi.mocked(source.observeTls).mockRejectedValue(new Error("sensitive detail"));
    const executor = new TransportV1FixtureExecutor(source);

    const result = await executor.execute(JOB, new AbortController().signal);

    expect(result.verdict).toBe("inconclusive");
    expect(result.checks).toHaveLength(5);
    expect(result.checks.find(({ controlId }) => controlId === "DS-TLS-01"))
      .toMatchObject({ status: "unknown", evidence: {} });
    expect(JSON.stringify(result)).not.toContain("sensitive detail");
  });

  it("does not run probes for an unsupported profile", async () => {
    const source = makeSource();
    const executor = new TransportV1FixtureExecutor(source);

    await expect(
      executor.execute(
        { ...JOB, profileVersion: "controls-v3" },
        new AbortController().signal,
      ),
    ).rejects.toThrow("unsupported_scan_profile");
    expect(source.observeDns).not.toHaveBeenCalled();
  });

  it("marks every observation unknown when already aborted", async () => {
    const source = makeSource();
    const controller = new AbortController();
    controller.abort();
    const executor = new TransportV1FixtureExecutor(source);

    const result = await executor.execute(JOB, controller.signal);

    expect(result.verdict).toBe("inconclusive");
    expect(result.checks.every(({ status }) => status === "unknown")).toBe(true);
    expect(source.observeDns).not.toHaveBeenCalled();
  });

  it("assembles network observations and exact transport metrics", async () => {
    const source: TransportV1ObservationSource = {
      sourceKind: "network",
      observeDns: vi.fn().mockResolvedValue({
        evidence: { addressClass: "public", aRecordCount: 1, aaaaRecordCount: 1 },
        requestsCount: 0,
        bytesCount: 0,
      }),
      observeTls: vi.fn().mockResolvedValue({
        evidence: {
          protocol: "TLSv1.3",
          certificateValid: true,
          hostnameMatches: true,
        },
        requestsCount: 1,
        bytesCount: 4,
      }),
      observeHttp: vi
        .fn()
        .mockResolvedValueOnce({
          evidence: {
            statusCode: 200,
            redirectedToHttps: true,
            finalScheme: "https",
          },
          requestsCount: 2,
          bytesCount: 5,
        })
        .mockResolvedValueOnce({
          evidence: {
            statusCode: 200,
            redirectedToHttps: true,
            finalScheme: "https",
          },
          requestsCount: 2,
          bytesCount: 6,
        }),
      observeHeaders: vi.fn().mockResolvedValue({
        evidence: {
          finalScheme: "https",
          hsts: true,
          nosniff: true,
          frameProtection: true,
          referrerPolicy: true,
          csp: true,
        },
        requestsCount: 1,
        bytesCount: 7,
      }),
    };
    const executor = new TransportV1NetworkExecutor(source);

    const result = await executor.execute(JOB, new AbortController().signal);

    expect(result.verdict).toBe("pass");
    expect(result.checks).toHaveLength(5);
    expect(result.metrics).toMatchObject({
      requestsCount: 6,
      bytesCount: 22,
      pagesCount: 0,
    });
  });

  it("limits a network executor to two concurrent probes", async () => {
    let active = 0;
    let maxActive = 0;
    const observe = async () => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      await new Promise((resolve) => setTimeout(resolve, 0));
      active -= 1;
      return { evidence: {}, requestsCount: 1, bytesCount: 1 };
    };
    const source: TransportV1ObservationSource = {
      sourceKind: "network",
      observeDns: observe,
      observeTls: observe,
      observeHttp: observe,
      observeHeaders: observe,
    };
    const executor = new TransportV1NetworkExecutor(source);

    const result = await executor.execute(JOB, new AbortController().signal);

    expect(maxActive).toBe(2);
    expect(result.metrics.requestsCount).toBe(5);
    expect(result.metrics.bytesCount).toBe(5);
  });
});
