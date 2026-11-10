import { describe, expect, it, vi } from "vitest";
import { ScanJobProcessor } from "./scan-job-processor.js";
import {
  TransportV1NetworkExecutor,
  type TransportV1ObservationSource,
} from "./transport-v1-executor.js";
import {
  ScanLeaseLostError,
  type ClaimedScanJob,
  type ScanCheck,
  type ScanJobStore,
  type ScanRunInput,
} from "@desarrolloseguro/persistence";

const LEASE_TOKEN = "fixture-lease-token";
const JOB: ClaimedScanJob = {
  id: "d1d1d1d1-d1d1-41d1-81d1-d1d1d1d1d1d1",
  hostname: "sample.example.net",
  profileVersion: "controls-v1",
  trigger: "requested",
  attempts: 1,
  leaseToken: LEASE_TOKEN,
  leaseUntil: new Date("2026-11-02T10:01:00.000Z"),
};

const RESULT: Omit<
  ScanRunInput,
  "jobId" | "leaseToken" | "hostname" | "profileVersion"
> = {
  scannerVersion: "scanner-test-version",
  startedAt: new Date("2026-11-02T10:00:00.000Z"),
  completedAt: new Date("2026-11-02T10:00:30.000Z"),
  verdict: "inconclusive",
  scope: ["/"],
  checks: [
    {
      controlId: "DS-DNS-01",
      status: "unknown",
      required: true,
      severity: "high",
      observedAt: new Date("2026-11-02T10:00:30.000Z"),
      targetPath: "/",
      method: "DNS",
      summary: "Prueba de almacenamiento sin conexión externa.",
      limitation: "No es un resultado operativo.",
      evidence: {},
    },
  ],
  metrics: {
    requestsCount: 0,
    bytesCount: 0,
    durationMs: 0,
    pagesCount: 0,
  },
};

const TRANSPORT_V1_FIXTURE_RESULT = {
  ...RESULT,
  scannerVersion: "fixture-transport-v1",
  verdict: "pass" as const,
  metrics: {
    requestsCount: 2,
    bytesCount: 0,
    durationMs: 12,
    pagesCount: 1,
  },
  checks: [
    makeFixtureCheck("DS-DNS-01", "DNS", {
      addressClass: "public",
      aRecordCount: 1,
      aaaaRecordCount: 0,
    }),
    makeFixtureCheck("DS-TLS-01", "TLS", {
      protocol: "TLSv1.3",
      certificateValid: true,
      hostnameMatches: true,
    }),
    makeFixtureCheck("DS-HTTP-01", "HEAD", {
      statusCode: 200,
      redirectedToHttps: true,
      finalScheme: "https",
    }),
    makeFixtureCheck("DS-HTTP-01", "GET", {
      statusCode: 200,
      redirectedToHttps: true,
      finalScheme: "https",
    }),
    makeFixtureCheck("DS-HDR-01", "GET", {
      finalScheme: "https",
      hsts: true,
      nosniff: true,
      frameProtection: true,
      referrerPolicy: true,
      csp: true,
    }),
  ],
};

describe("ScanJobProcessor", () => {
  it("does nothing when the queue is empty", async () => {
    const store = makeStore(null);
    const executor = { execute: vi.fn() };
    const processor = new ScanJobProcessor(store, executor);

    await expect(processor.processNext()).resolves.toBe("idle");
    expect(executor.execute).not.toHaveBeenCalled();
  });

  it("commits the executor result under the claimed lease", async () => {
    const store = makeStore(JOB);
    const executor = { execute: vi.fn().mockResolvedValue(RESULT) };
    const processor = new ScanJobProcessor(store, executor);

    await expect(processor.processNext()).resolves.toBe("completed");
    expect(store.completeScan).toHaveBeenCalledWith({
      ...RESULT,
      checks: [
        {
          ...RESULT.checks[0],
          summary: "Comprobación DS-DNS-01: unknown.",
          limitation:
            "Resultado limitado a las rutas públicas declaradas del perfil controls-v1.",
        },
      ],
      jobId: JOB.id,
      leaseToken: LEASE_TOKEN,
      hostname: JOB.hostname,
      profileVersion: JOB.profileVersion,
    });
  });

  it("does not persist executor results outside the profile scope", async () => {
    const store = makeStore(JOB);
    const executor = {
      execute: vi.fn().mockResolvedValue({
        ...RESULT,
        scope: ["/precios?token=secret"],
      }),
    };
    const processor = new ScanJobProcessor(store, executor);

    await expect(processor.processNext()).rejects.toThrow(
      "scan_scope_not_allowlisted",
    );
    expect(store.completeScan).not.toHaveBeenCalled();
  });

  it("does not persist controls-v2 results with incomplete route coverage", async () => {
    const v2Job = { ...JOB, profileVersion: "controls-v2" };
    const store = makeStore(v2Job);
    const executor = { execute: vi.fn().mockResolvedValue(RESULT) };
    const processor = new ScanJobProcessor(store, executor);

    await expect(processor.processNext()).rejects.toThrow(
      "scan_check_coverage_incomplete",
    );
    expect(store.completeScan).not.toHaveBeenCalled();
  });

  it("persists the complete controls-v2 check matrix", async () => {
    const v2Job = { ...JOB, profileVersion: "controls-v2" };
    const result = {
      ...RESULT,
      checks: makeControlsV2Checks(["/"]),
    };
    const store = makeStore(v2Job);
    const executor = { execute: vi.fn().mockResolvedValue(result) };
    const processor = new ScanJobProcessor(store, executor);

    await expect(processor.processNext()).resolves.toBe("completed");
    expect(store.completeScan).toHaveBeenCalledWith(
      expect.objectContaining({
        profileVersion: "controls-v2",
        checks: expect.arrayContaining([
          expect.objectContaining({
            controlId: "DS-HTTP-01",
            targetPath: "/",
            method: "HEAD",
          }),
          expect.objectContaining({
            controlId: "DS-HTTP-01",
            targetPath: "/",
            method: "GET",
          }),
        ]),
      }),
    );
    const completed = vi.mocked(store.completeScan).mock.calls[0]?.[0];
    expect(completed?.checks).toHaveLength(10);
  });

  it("connects transport-v1 fixture observations to a sanitized report", async () => {
    const transportJob = { ...JOB, profileVersion: "transport-v1" };
    const store = makeStore(transportJob);
    const processor = new ScanJobProcessor(store, {
      execute: vi.fn().mockResolvedValue(TRANSPORT_V1_FIXTURE_RESULT),
    });

    await expect(processor.processNext()).resolves.toBe("completed");

    const savedReport = vi.mocked(store.completeScan).mock.calls[0]?.[0];
    expect(savedReport).toMatchObject({
      profileVersion: "transport-v1",
      scope: ["/"],
      verdict: "pass",
      scannerVersion: "fixture-transport-v1",
    });
    expect(savedReport?.checks).toHaveLength(5);
    expect(savedReport?.checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          controlId: "DS-DNS-01",
          method: "DNS",
          status: "pass",
        }),
        expect.objectContaining({
          controlId: "DS-TLS-01",
          method: "TLS",
          status: "pass",
        }),
        expect.objectContaining({
          controlId: "DS-HDR-01",
          method: "GET",
          status: "pass",
          limitation:
            "Resultado limitado a las rutas públicas declaradas del perfil transport-v1.",
        }),
      ]),
    );
  });

  it("persists network probe evidence and aggregated transport metrics through the processor", async () => {
    const transportJob = { ...JOB, profileVersion: "transport-v1" };
    const store = makeStore(transportJob);
    const source: TransportV1ObservationSource = {
      sourceKind: "network",
      observeDns: vi.fn().mockResolvedValue({
        evidence: { addressClass: "public", aRecordCount: 1, aaaaRecordCount: 0 },
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
        bytesCount: 8,
      }),
      observeHttp: vi
        .fn()
        .mockResolvedValue({
          evidence: {
            statusCode: 200,
            redirectedToHttps: true,
            finalScheme: "https",
          },
          requestsCount: 2,
          bytesCount: 0,
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
        bytesCount: 16,
      }),
    };
    const executor = new TransportV1NetworkExecutor(source);
    const processor = new ScanJobProcessor(store, executor);

    await expect(processor.processNext()).resolves.toBe("completed");

    const savedReport = vi.mocked(store.completeScan).mock.calls[0]?.[0];
    expect(savedReport).toMatchObject({
      profileVersion: "transport-v1",
      verdict: "pass",
      scannerVersion: "transport-v1-network-adapter-1",
      metrics: { requestsCount: 6, bytesCount: 24 },
    });
    expect(savedReport?.checks).toHaveLength(5);
    expect(JSON.stringify(savedReport)).not.toContain("93.184.216.34");
  });

  it("validates the claimed hostname before invoking the executor", async () => {
    const unsafeJob = { ...JOB, hostname: "127.0.0.1" };
    const store = makeStore(unsafeJob);
    const executor = { execute: vi.fn().mockResolvedValue(RESULT) };
    const processor = new ScanJobProcessor(store, executor);

    await expect(processor.processNext()).rejects.toThrow("invalid_hostname");
    expect(executor.execute).not.toHaveBeenCalled();
  });

  it("does not persist a verdict that contradicts the required checks", async () => {
    const store = makeStore(JOB);
    const executor = {
      execute: vi.fn().mockResolvedValue({ ...RESULT, verdict: "pass" }),
    };
    const processor = new ScanJobProcessor(store, executor);

    await expect(processor.processNext()).rejects.toThrow(
      "scan_verdict_does_not_match_checks",
    );
    expect(store.completeScan).not.toHaveBeenCalled();
  });

  it("drops results from a worker whose lease has been replaced", async () => {
    const store = makeStore(JOB);
    vi.mocked(store.completeScan).mockRejectedValue(new ScanLeaseLostError());
    const processor = new ScanJobProcessor(store, {
      execute: vi.fn().mockResolvedValue(RESULT),
    });

    await expect(processor.processNext()).resolves.toBe("lease_lost");
  });

  it("aborts work when it can no longer renew the lease", async () => {
    const store = makeStore(JOB);
    vi.mocked(store.renewScanLease).mockResolvedValue(false);
    let receivedSignal: AbortSignal | undefined;
    const executor = {
      execute: vi.fn(async (_job: ClaimedScanJob, signal: AbortSignal) => {
        receivedSignal = signal;
        await new Promise((resolve) => setTimeout(resolve, 10));
        return RESULT;
      }),
    };
    const processor = new ScanJobProcessor(
      store,
      executor,
      () => new Date(),
      1,
    );

    await expect(processor.processNext()).resolves.toBe("lease_lost");
    expect(receivedSignal?.aborted).toBe(true);
    expect(store.completeScan).not.toHaveBeenCalled();
  });

  it("aborts work and discards results when lease renewal errors", async () => {
    const store = makeStore(JOB);
    vi.mocked(store.renewScanLease).mockRejectedValue(new Error("database"));
    let receivedSignal: AbortSignal | undefined;
    const executor = {
      execute: vi.fn(async (_job: ClaimedScanJob, signal: AbortSignal) => {
        receivedSignal = signal;
        await new Promise<void>((resolve) => {
          signal.addEventListener("abort", () => resolve(), { once: true });
        });
        return RESULT;
      }),
    };
    const processor = new ScanJobProcessor(
      store,
      executor,
      () => new Date(),
      1,
    );

    await expect(processor.processNext()).resolves.toBe("lease_lost");
    expect(receivedSignal?.aborted).toBe(true);
    expect(store.completeScan).not.toHaveBeenCalled();
  });

  it("propagates executor failures without attempting to persist a report", async () => {
    const store = makeStore(JOB);
    const processor = new ScanJobProcessor(store, {
      execute: vi.fn().mockRejectedValue(new Error("probe_failed")),
    });

    await expect(processor.processNext()).rejects.toThrow("probe_failed");
    expect(store.completeScan).not.toHaveBeenCalled();
  });

  function makeStore(job: ClaimedScanJob | null): ScanJobStore & {
    claimNextScan: ReturnType<typeof vi.fn>;
    completeScan: ReturnType<typeof vi.fn>;
  } {
    return {
      claimNextScan: vi.fn().mockResolvedValue(job),
      renewScanLease: vi.fn().mockResolvedValue(true),
      completeScan: vi.fn().mockResolvedValue("run-id"),
    };
  }
});

function makeFixtureCheck(
  controlId: string,
  method: string,
  evidence: Record<string, unknown>,
): ScanCheck {
  return {
    controlId,
    status: "pass",
    required: true,
    severity: "high",
    observedAt: new Date("2026-11-09T10:00:30.000Z"),
    targetPath: "/",
    method,
    summary: "Fixture observation; replaced by sanitizer.",
    limitation: "Fixture only.",
    evidence,
  };
}

function makeControlsV2Checks(scope: readonly string[]): ScanCheck[] {
  const hostChecks = [
    ["DS-DNS-01", "DNS"],
    ["DS-TLS-01", "TLS"],
    ["DS-TLS-02", "TLS"],
  ] as const;
  const routeChecks = [
    ["DS-HTTP-01", "HEAD"],
    ["DS-HTTP-01", "GET"],
    ["DS-HDR-01", "GET"],
    ["DS-PRIV-01", "GET"],
    ["DS-PRIV-02", "GET"],
    ["DS-PRIV-03", "GET"],
    ["DS-QUAL-01", "GET"],
  ] as const;
  const makeCheck = (
    controlId: string,
    targetPath: string,
    method: string,
  ): ScanCheck => ({
    controlId,
    status: "unknown",
    required: true,
    severity: "high",
    observedAt: RESULT.completedAt,
    targetPath,
    method,
    summary: "Test fixture",
    limitation: "Test fixture",
    evidence: {},
  });

  return [
    ...hostChecks.map(([controlId, method]) =>
      makeCheck(controlId, "/", method),
    ),
    ...scope.flatMap((targetPath) =>
      routeChecks.map(([controlId, method]) =>
        makeCheck(controlId, targetPath, method),
      ),
    ),
  ];
}
