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
  it("does not claim a queued scan while the runtime coordinator is unavailable", async () => {
    const store = makeStore(JOB);
    const executor = {
      assertReady: vi.fn().mockRejectedValue(new Error("coordinator_unavailable")),
      execute: vi.fn().mockResolvedValue(RESULT),
    };
    const processor = new ScanJobProcessor(store, executor);

    await expect(processor.processNext()).rejects.toThrow("coordinator_unavailable");

    expect(executor.assertReady).toHaveBeenCalledOnce();
    expect(store.recoverExpiredLeases).not.toHaveBeenCalled();
    expect(store.claimNextScan).not.toHaveBeenCalled();
    expect(executor.execute).not.toHaveBeenCalled();
  });

  it("persists only an allowlisted runtime failure category", async () => {
    const store = makeStore(JOB);
    const executor = {
      execute: vi.fn().mockRejectedValue(new Error("broker_failed")),
    };
    const processor = new ScanJobProcessor(store, executor);

    await expect(processor.processNext()).resolves.toBe("retrying");

    expect(store.failScan).toHaveBeenCalledWith(
      JOB.id,
      JOB.leaseToken,
      "broker_failed",
      3,
      null,
    );
  });

  it("emits bounded operational outcome telemetry without job or target data", async () => {
    const store = makeStore(JOB);
    const telemetry = vi.fn();
    const processor = new ScanJobProcessor(
      store,
      { execute: vi.fn().mockResolvedValue(RESULT) },
      () => new Date(),
      undefined,
      telemetry,
    );

    await expect(processor.processNext()).resolves.toBe("completed");

    expect(telemetry).toHaveBeenCalledOnce();
    const [event] = telemetry.mock.calls[0] ?? [];
    expect(event).toMatchObject({
      type: "scan_job_outcome",
      outcome: "completed",
    });
    expect(event?.durationMs).toEqual(expect.any(Number));
    expect(event?.durationMs).toBeGreaterThanOrEqual(0);
    expect(Object.keys(event ?? {}).sort()).toEqual([
      "durationMs",
      "outcome",
      "type",
    ]);
    expect(JSON.stringify(event)).not.toContain(JOB.hostname);
    expect(JSON.stringify(event)).not.toContain(JOB.id);
  });

  it("does not let telemetry failures affect scan outcomes or leak errors", async () => {
    const store = makeStore(JOB);
    const telemetry = vi.fn(() => {
      throw new Error("private telemetry sink detail");
    });
    const processor = new ScanJobProcessor(
      store,
      { execute: vi.fn().mockResolvedValue(RESULT) },
      () => new Date(),
      undefined,
      telemetry,
    );

    await expect(processor.processNext()).resolves.toBe("completed");
    expect(store.completeScan).toHaveBeenCalledOnce();
  });

  it("does nothing when the queue is empty", async () => {
    const store = makeStore(null);
    const executor = { execute: vi.fn() };
    const processor = new ScanJobProcessor(store, executor);

    await expect(processor.processNext()).resolves.toBe("idle");
    expect(executor.execute).not.toHaveBeenCalled();
  });

  it("recovers expired leases before claiming work", async () => {
    const store = makeStore(null);
    const processor = new ScanJobProcessor(store, { execute: vi.fn() });

    await expect(processor.processNext()).resolves.toBe("idle");

    expect(store.recoverExpiredLeases).toHaveBeenCalledWith(expect.any(Date), 3);
    expect(
      vi.mocked(store.recoverExpiredLeases).mock.invocationCallOrder[0],
    ).toBeLessThan(vi.mocked(store.claimNextScan).mock.invocationCallOrder[0] ?? 0);
  });

  it("throttles lease recovery to the configured interval", async () => {
    const store = makeStore(null);
    let currentTime = new Date("2026-11-10T10:00:00.000Z");
    const processor = new ScanJobProcessor(
      store,
      { execute: vi.fn() },
      () => currentTime,
      undefined,
      undefined,
      5_000,
    );

    await processor.processNext();
    await processor.processNext();
    currentTime = new Date(currentTime.getTime() + 4_999);
    await processor.processNext();
    expect(store.recoverExpiredLeases).toHaveBeenCalledOnce();

    currentTime = new Date(currentTime.getTime() + 1);
    await processor.processNext();
    expect(store.recoverExpiredLeases).toHaveBeenCalledTimes(2);
  });

  it("does not claim work if expired lease recovery fails", async () => {
    const store = makeStore(null);
    vi.mocked(store.recoverExpiredLeases).mockRejectedValue(
      new Error("private database detail"),
    );
    const processor = new ScanJobProcessor(store, { execute: vi.fn() });

    await expect(processor.processNext()).rejects.toThrow("private database detail");

    expect(store.claimNextScan).not.toHaveBeenCalled();
  });

  it("shares an in-flight recovery across concurrent processor calls", async () => {
    const store = makeStore(null);
    let completeRecovery: (() => void) | undefined;
    vi.mocked(store.recoverExpiredLeases).mockImplementation(
      () => new Promise((resolve) => {
        completeRecovery = () => resolve(0);
      }),
    );
    const processor = new ScanJobProcessor(store, { execute: vi.fn() });

    const firstCall = processor.processNext();
    const secondCall = processor.processNext();
    await vi.waitFor(() => expect(store.recoverExpiredLeases).toHaveBeenCalledOnce());
    completeRecovery?.();
    await expect(Promise.all([firstCall, secondCall])).resolves.toEqual([
      "idle",
      "idle",
    ]);

    expect(store.recoverExpiredLeases).toHaveBeenCalledOnce();
    expect(store.claimNextScan).toHaveBeenCalledTimes(2);
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

  it("schedules executor failures for bounded retry without persisting a report", async () => {
    const store = makeStore(JOB);
    const processor = new ScanJobProcessor(store, {
      execute: vi.fn().mockRejectedValue(new Error("sensitive diagnostic")),
    });

    await expect(processor.processNext()).resolves.toBe("retrying");
    expect(store.completeScan).not.toHaveBeenCalled();
    expect(store.failScan).toHaveBeenCalledWith(
      JOB.id,
      JOB.leaseToken,
      "executor_failed",
      3,
      null,
    );
    expect(JSON.stringify(vi.mocked(store.failScan).mock.calls)).not.toContain(
      "sensitive diagnostic",
    );
  });

  it("persists only allowlisted runtime failure diagnostics", async () => {
    const store = makeStore(JOB);
    const error = new Error("private docker output");
    Object.defineProperty(error, "scanFailureDiagnostic", {
      value: {
        stage: "volume_create",
        code: "docker_permission_denied",
        privateMessage: "must not persist",
      },
    });
    const processor = new ScanJobProcessor(store, {
      execute: vi.fn().mockRejectedValue(error),
    });

    await expect(processor.processNext()).resolves.toBe("retrying");
    expect(store.failScan).toHaveBeenCalledWith(
      JOB.id,
      JOB.leaseToken,
      "executor_failed",
      3,
      { stage: "volume_create", code: "docker_permission_denied" },
    );
    expect(JSON.stringify(vi.mocked(store.failScan).mock.calls)).not.toContain("private docker output");
    expect(JSON.stringify(vi.mocked(store.failScan).mock.calls)).not.toContain("must not persist");
  });

  function makeStore(job: ClaimedScanJob | null): ScanJobStore & {
    claimNextScan: ReturnType<typeof vi.fn>;
    recoverExpiredLeases: ReturnType<typeof vi.fn>;
    completeScan: ReturnType<typeof vi.fn>;
  } {
    return {
      claimNextScan: vi.fn().mockResolvedValue(job),
      recoverExpiredLeases: vi.fn().mockResolvedValue(0),
      renewScanLease: vi.fn().mockResolvedValue(true),
      failScan: vi.fn().mockResolvedValue("retrying"),
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
