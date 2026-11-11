import { BadRequestException } from "@nestjs/common";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PublicScanService } from "./public-scan.service.js";

const REPORT_ID = "8d140e17-68d6-489a-b451-7e87408187ae";
const INTERNAL_STORAGE_ERROR = "postgres password must not escape";
const PRIVATE_RESPONSE_BODY = "<html>customer-private-content</html>";
const FIXED_NOW = new Date("2026-11-03T10:00:00.000Z");

afterEach(() => vi.useRealTimers());

describe("PublicScanService", () => {
  it("returns a truthful not-scanned status without starting work", async () => {
    const readPublicDomainSnapshot = vi.fn().mockResolvedValue(null);
    const readPublicReport = vi.fn();
    const service = new PublicScanService({
      scanStore: { readPublicDomainSnapshot, readPublicReport },
    });

    const status = await service.getDomainStatus("example.com");

    expect(status).toMatchObject({
      hostname: "example.com",
      enrollment: "on_demand",
      state: "not_scanned",
      activeJobId: null,
      lastReport: null,
    });
    expect(status.checkedAt).toMatch(/^\d{4}-\d\d-\d\dT/u);
    expect(readPublicDomainSnapshot).toHaveBeenCalledWith("example.com");
    expect(readPublicReport).not.toHaveBeenCalled();
  });

  it("normalizes hostnames before reading status", async () => {
    const readPublicDomainSnapshot = vi.fn().mockResolvedValue(null);
    const service = new PublicScanService({
      scanStore: {
        readPublicDomainSnapshot,
        readPublicReport: vi.fn(),
      },
    });

    await service.getDomainStatus(" EXAMPLE.COM. ");

    expect(readPublicDomainSnapshot).toHaveBeenCalledWith("example.com");
  });

  it("requires explicit authorization before requesting an on-demand analysis", async () => {
    const requestOnDemandScan = vi.fn().mockResolvedValue({ kind: "queued" });
    const service = new PublicScanService({
      scanStore: { readPublicDomainSnapshot: vi.fn(), readPublicReport: vi.fn(), requestOnDemandScan },
    });

    await expect(
      service.requestAnalysis("example.com", { authorized: false }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(requestOnDemandScan).not.toHaveBeenCalled();
  });

  it("does not accept client-selected scan profiles or options", async () => {
    const requestOnDemandScan = vi.fn();
    const service = new PublicScanService({
      scanStore: {
        readPublicDomainSnapshot: vi.fn(),
        readPublicReport: vi.fn(),
        requestOnDemandScan,
      },
    });

    await expect(
      service.requestAnalysis("example.com", {
        authorized: true,
        profileVersion: "controls-v1",
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(requestOnDemandScan).not.toHaveBeenCalled();
  });

  it("normalizes authorized analysis requests and returns only the public state", async () => {
    const requestOnDemandScan = vi.fn(function (this: object) {
      expect(this).toBe(scanStore);
      return Promise.resolve({ kind: "queued" as const, jobId: "internal-job-id" });
    });
    const scanStore = {
      readPublicDomainSnapshot: vi.fn(),
      readPublicReport: vi.fn(),
      requestOnDemandScan,
    };
    const service = new PublicScanService({
      scanStore,
    });

    await expect(
      service.requestAnalysis(" EXAMPLE.COM. ", { authorized: true }),
    ).resolves.toEqual({ hostname: "example.com", state: "queued" });
    expect(requestOnDemandScan).toHaveBeenCalledWith("example.com");
  });

  it("does not expose storage errors from analysis admission", async () => {
    const requestOnDemandScan = vi.fn().mockRejectedValue(
      new Error("private database credentials"),
    );
    const service = new PublicScanService({
      scanStore: { readPublicDomainSnapshot: vi.fn(), readPublicReport: vi.fn(), requestOnDemandScan },
    });

    await expect(
      service.requestAnalysis("example.com", { authorized: true }),
    ).rejects.toMatchObject({
      status: 503,
      message: "development_security_unavailable",
    });
  });

  it("marks active work as updating while keeping its prior report historical", async () => {
    const report = makeReport();
    const service = new PublicScanService({
      scanStore: {
        readPublicDomainSnapshot: vi.fn().mockResolvedValue({
          hostname: report.hostname,
          enrollment: "monitored",
          profileVersion: report.profileVersion,
          optedOut: false,
          activeJobId: "7d140e17-68d6-489a-b451-7e87408187ae",
          lastReport: report,
        }),
        readPublicReport: vi.fn(),
      },
    });

    const status = await service.getDomainStatus(report.hostname);

    expect(status.state).toBe("updating");
    expect(status.activeJobId).toBe("7d140e17-68d6-489a-b451-7e87408187ae");
    expect(status.lastReport?.id).toBe(report.id);
  });

  it("keeps internal evidence out of reports embedded in domain status", async () => {
    const report = makeReport({
      metrics: { requestsCount: 99 },
      checks: [
        {
          controlId: "DS-HDR-01",
          status: "unknown",
          required: true,
          severity: "high",
          observedAt: new Date("2026-11-03T10:00:30.000Z"),
          targetPath: "/",
          method: "GET",
          summary: "Comprobación DS-HDR-01: unknown.",
          limitation: "Resultado limitado al perfil controls-v3.",
          evidence: { responseBody: PRIVATE_RESPONSE_BODY },
          trace: INTERNAL_STORAGE_ERROR,
        },
      ],
    });
    const service = new PublicScanService({
      scanStore: {
        readPublicDomainSnapshot: vi.fn().mockResolvedValue({
          hostname: report.hostname,
          enrollment: "monitored",
          profileVersion: report.profileVersion,
          optedOut: false,
          activeJobId: null,
          lastReport: report,
        }),
        readPublicReport: vi.fn(),
      },
    });

    const status = await service.getDomainStatus(report.hostname);

    expect(status.lastReport?.checks[0]).not.toHaveProperty("evidence");
    expect(JSON.stringify(status)).not.toContain(PRIVATE_RESPONSE_BODY);
    expect(JSON.stringify(status)).not.toContain(INTERNAL_STORAGE_ERROR);
    expect(JSON.stringify(status)).not.toContain("requestsCount");
  });

  it("marks an expired report stale", async () => {
    const report = makeReport({
      expiresAt: new Date("2026-01-01T00:00:00.000Z"),
    });
    const service = new PublicScanService({
      scanStore: {
        readPublicDomainSnapshot: vi.fn().mockResolvedValue({
          hostname: report.hostname,
          enrollment: "monitored",
          profileVersion: report.profileVersion,
          optedOut: false,
          activeJobId: null,
          lastReport: report,
        }),
        readPublicReport: vi.fn(),
      },
    });

    await expect(
      service.getDomainStatus(report.hostname),
    ).resolves.toMatchObject({
      state: "stale",
      lastReport: { id: report.id },
    });
  });

  it("marks a report fresh only while its server expiry is in the future", async () => {
    const report = makeReport({
      expiresAt: new Date(Date.now() + 60_000),
    });
    const service = new PublicScanService({
      scanStore: {
        readPublicDomainSnapshot: vi.fn().mockResolvedValue({
          hostname: report.hostname,
          enrollment: "monitored",
          profileVersion: report.profileVersion,
          optedOut: false,
          activeJobId: null,
          lastReport: report,
        }),
        readPublicReport: vi.fn(),
      },
    });

    await expect(
      service.getDomainStatus(report.hostname),
    ).resolves.toMatchObject({
      state: "fresh",
      lastReport: { id: report.id },
    });
  });

  it("projects a transport-v1 fixture report without exposing evidence", async () => {
    const report = makeReport({
      profileVersion: "transport-v1",
      checks: [
        {
          controlId: "DS-DNS-01",
          status: "pass",
          required: true,
          severity: "high",
          observedAt: FIXED_NOW,
          targetPath: "/",
          method: "DNS",
          summary: "Comprobación DS-DNS-01: pass.",
          limitation:
            "Resultado limitado a las rutas públicas declaradas del perfil transport-v1.",
          evidence: { addressClass: "public", aRecordCount: 1 },
        },
      ],
    });
    const service = new PublicScanService({
      scanStore: {
        readPublicDomainSnapshot: vi.fn(),
        readPublicReport: vi.fn().mockResolvedValue(report),
      },
    });

    const publicReport = await service.getReport(REPORT_ID);

    expect(publicReport).toMatchObject({
      profileVersion: "transport-v1",
      checks: [
        {
          controlId: "DS-DNS-01",
          method: "DNS",
          status: "pass",
        },
      ],
    });
    expect(publicReport.checks[0]).not.toHaveProperty("evidence");
  });

  it.each([
    { expiresAt: "2026-11-03T10:00:00.001Z", expectedState: "fresh" },
    { expiresAt: "2026-11-03T10:00:00.000Z", expectedState: "stale" },
  ])(
    "classifies freshness at the exact expiry boundary as $expectedState",
    async ({ expiresAt, expectedState }) => {
      vi.useFakeTimers();
      vi.setSystemTime(FIXED_NOW);
      const report = makeReport({ expiresAt: new Date(expiresAt) });
      const service = new PublicScanService({
        scanStore: {
          readPublicDomainSnapshot: vi.fn().mockResolvedValue({
            hostname: report.hostname,
            enrollment: "monitored",
            profileVersion: report.profileVersion,
            optedOut: false,
            activeJobId: null,
            lastReport: report,
          }),
          readPublicReport: vi.fn(),
        },
      });

      await expect(
        service.getDomainStatus(report.hostname),
      ).resolves.toMatchObject({
        state: expectedState,
        checkedAt: FIXED_NOW.toISOString(),
      });
    },
  );

  it("marks active work as updating when there is no prior report", async () => {
    const readPublicDomainSnapshot = vi.fn().mockResolvedValue({
      hostname: "example.com",
      enrollment: "monitored",
      profileVersion: "controls-v3",
      optedOut: false,
      activeJobId: REPORT_ID,
      lastReport: null,
    });
    const service = new PublicScanService({
      scanStore: {
        readPublicDomainSnapshot,
        readPublicReport: vi.fn(),
      },
    });

    await expect(
      service.getDomainStatus("example.com"),
    ).resolves.toMatchObject({
      state: "updating",
      activeJobId: REPORT_ID,
      lastReport: null,
    });
  });

  it("maps status storage errors to a generic service unavailable response", async () => {
    const service = new PublicScanService({
      scanStore: {
        readPublicDomainSnapshot: vi
          .fn()
          .mockRejectedValue(new Error(INTERNAL_STORAGE_ERROR)),
        readPublicReport: vi.fn(),
      },
    });

    await expect(service.getDomainStatus("example.com")).rejects.toMatchObject(
      {
        status: 503,
        message: "development_security_unavailable",
      },
    );
  });

  it("hides active jobs and reports for an opted-out domain", async () => {
    const report = makeReport();
    const service = new PublicScanService({
      scanStore: {
        readPublicDomainSnapshot: vi.fn().mockResolvedValue({
          hostname: report.hostname,
          enrollment: "monitored",
          profileVersion: report.profileVersion,
          optedOut: true,
          activeJobId: "7d140e17-68d6-489a-b451-7e87408187ae",
          lastReport: report,
        }),
        readPublicReport: vi.fn(),
      },
    });

    await expect(
      service.getDomainStatus(report.hostname),
    ).resolves.toMatchObject({
      enrollment: "on_demand",
      state: "unavailable",
      activeJobId: null,
      lastReport: null,
    });
  });

  it.each(["http://127.0.0.1/path", "127.0.0.1", "service.local", null])(
    "rejects malformed hostname %s before querying storage",
    async (hostname) => {
      const readPublicDomainSnapshot = vi.fn();
      const service = new PublicScanService({
        scanStore: {
          readPublicDomainSnapshot,
          readPublicReport: vi.fn(),
        },
      });

      await expect(service.getDomainStatus(hostname)).rejects.toBeInstanceOf(
        BadRequestException,
      );
      expect(readPublicDomainSnapshot).not.toHaveBeenCalled();
    },
  );

  it("does not return raw evidence in public report results", async () => {
    const report = makeReport({
      privateDiagnostic: INTERNAL_STORAGE_ERROR,
      metrics: { requestCount: 100 },
      checks: [
        {
          controlId: "DS-HDR-01",
          status: "unknown",
          required: true,
          severity: "high",
          observedAt: new Date("2026-11-03T10:00:30.000Z"),
          targetPath: "/",
          method: "GET",
          summary: "Comprobación DS-HDR-01: unknown.",
          limitation: "Resultado limitado al perfil controls-v3.",
          evidence: { responseBody: PRIVATE_RESPONSE_BODY },
          internalTrace: INTERNAL_STORAGE_ERROR,
        },
      ],
    });
    const service = new PublicScanService({
      scanStore: {
        readPublicDomainSnapshot: vi.fn(),
        readPublicReport: vi.fn().mockResolvedValue(report),
      },
    });

    const result = await service.getReport(report.id);

    expect(result).toMatchObject({ id: report.id, verdict: "inconclusive" });
    expect(result.checks[0]).not.toHaveProperty("evidence");
    expect(Object.keys(result).sort()).toEqual(
      [
        "id",
        "hostname",
        "profileVersion",
        "scannerVersion",
        "vantage",
        "trigger",
        "startedAt",
        "completedAt",
        "expiresAt",
        "verdict",
        "scope",
        "checks",
      ].sort(),
    );
    expect(Object.keys(result.checks[0]).sort()).toEqual(
      [
        "controlId",
        "status",
        "required",
        "severity",
        "observedAt",
        "targetPath",
        "method",
        "summary",
        "limitation",
      ].sort(),
    );
    expect(JSON.stringify(result)).not.toContain(PRIVATE_RESPONSE_BODY);
    expect(JSON.stringify(result)).not.toContain(INTERNAL_STORAGE_ERROR);
    expect(JSON.stringify(result)).not.toContain("requestCount");
  });

  it.each([
    "not-a-uuid",
    "' OR 1=1 --",
    "00000000-0000-0000-0000-000000000000",
  ])(
    "returns not found for invalid report identifier %s without reading storage",
    async (reportId) => {
      const readPublicReport = vi.fn();
      const service = new PublicScanService({
        scanStore: {
          readPublicDomainSnapshot: vi.fn(),
          readPublicReport,
        },
      });

      await expect(service.getReport(reportId)).rejects.toMatchObject({
        status: 404,
      });
      expect(readPublicReport).not.toHaveBeenCalled();
    },
  );

  it("returns not found when a valid report identifier has no public report", async () => {
    const readPublicReport = vi.fn().mockResolvedValue(null);
    const service = new PublicScanService({
      scanStore: {
        readPublicDomainSnapshot: vi.fn(),
        readPublicReport,
      },
    });

    await expect(service.getReport(REPORT_ID)).rejects.toMatchObject({
      status: 404,
      message: "development_security_report_not_found",
    });
    expect(readPublicReport).toHaveBeenCalledExactlyOnceWith(REPORT_ID);
  });

  it("maps report storage errors to a generic service unavailable response", async () => {
    const service = new PublicScanService({
      scanStore: {
        readPublicDomainSnapshot: vi.fn(),
        readPublicReport: vi
          .fn()
          .mockRejectedValue(new Error(INTERNAL_STORAGE_ERROR)),
      },
    });

    await expect(service.getReport(REPORT_ID)).rejects.toMatchObject({
      status: 503,
      message: "development_security_unavailable",
    });
  });
});

function makeReport(overrides: Record<string, unknown> = {}) {
  return {
    id: "8d140e17-68d6-489a-b451-7e87408187ae",
    hostname: "example.com",
    profileVersion: "controls-v3",
    scannerVersion: "scanner-v1",
    vantage: "same_vps",
    trigger: "scheduled",
    startedAt: new Date("2026-11-03T10:00:00.000Z"),
    completedAt: new Date("2026-11-03T10:01:00.000Z"),
    expiresAt: new Date(Date.now() + 60_000),
    verdict: "inconclusive",
    scope: ["/"],
    checks: [
      {
        controlId: "DS-HDR-01",
        status: "unknown",
        required: true,
        severity: "high",
        observedAt: new Date("2026-11-03T10:00:30.000Z"),
        targetPath: "/",
        method: "GET",
        summary: "Comprobación DS-HDR-01: unknown.",
        limitation: "Resultado limitado al perfil controls-v3.",
      },
    ],
    ...overrides,
  };
}
