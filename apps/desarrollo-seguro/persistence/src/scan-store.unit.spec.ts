import type { Pool } from "pg";
import { describe, expect, it, vi } from "vitest";
import { PostgresScanStore, type ScanRunInput } from "./scan-store.js";

const VALID_REPORT: ScanRunInput = {
  jobId: "job-id",
  leaseToken: "lease-token",
  hostname: "example.com",
  profileVersion: "controls-v1",
  scannerVersion: "scanner-v1",
  startedAt: new Date("2026-11-02T10:00:00.000Z"),
  completedAt: new Date("2026-11-02T10:01:00.000Z"),
  verdict: "pass",
  scope: ["/"],
  checks: [
    {
      controlId: "DS-HTTP-01",
      status: "pass",
      required: true,
      severity: "high",
      observedAt: new Date("2026-11-02T10:01:00.000Z"),
      targetPath: "/",
      method: "HEAD",
      summary: "Respuesta recibida.",
      limitation: "Prueba de unidad.",
      evidence: {
        statusCode: 200,
        redirectedToHttps: true,
        finalScheme: "https",
      },
    },
  ],
  metrics: {
    requestsCount: 1,
    bytesCount: 0,
    durationMs: 1,
    pagesCount: 1,
  },
};

describe("PostgresScanStore unit behavior", () => {
  it("reports storage health as false when the database query fails", async () => {
    const pool = makePool({
      query: vi.fn().mockRejectedValue(new Error("db")),
    });
    const store = new PostgresScanStore(pool);

    await expect(store.healthCheck()).resolves.toBe(false);
  });

  it("projects public reports without selecting raw evidence", async () => {
    const query = vi.fn().mockResolvedValue({
      rows: [
        makePublicReportRow({
          checks: [
            {
              ...makePublicReportCheck(),
              evidence: { html: "<private response body>" },
              internalTrace: "database-detail",
            },
          ],
        }),
      ],
    });
    const store = new PostgresScanStore(makePool({ query }));

    const report = await store.readPublicReport(
      "8d140e17-68d6-489a-b451-7e87408187ae",
    );

    expect(report?.checks[0]).not.toHaveProperty("evidence");
    expect(report?.checks[0].controlId).toBe("DS-HDR-01");
    expect(JSON.stringify(report)).not.toContain("<private response body>");
    expect(JSON.stringify(report)).not.toContain("database-detail");
    expect(query.mock.calls[0][0]).not.toMatch(/SELECT\s+evidence_json/iu);
  });

  it("projects status snapshots without selecting raw evidence", async () => {
    const query = vi.fn().mockResolvedValue({
      rows: [
        makePublicReportRow({
          hostname: "example.com",
          enrollment: "monitored",
          profile_version: "controls-v3",
          opted_out_at: null,
          active_job_id: null,
          checks: [
            {
              ...makePublicReportCheck(),
              evidence: { cookie: "session=private" },
            },
          ],
        }),
      ],
    });
    const store = new PostgresScanStore(makePool({ query }));

    const snapshot = await store.readPublicDomainSnapshot("example.com");

    expect(snapshot?.lastReport?.checks[0]).not.toHaveProperty("evidence");
    expect(JSON.stringify(snapshot)).not.toContain("session=private");
    expect(query.mock.calls[0][0]).not.toMatch(/SELECT\s+evidence_json/iu);
  });

  it("rejects malformed persisted public report rows", async () => {
    const query = vi.fn().mockResolvedValue({
      rows: [makePublicReportRow({ report_scope: ["/", 4] })],
    });
    const store = new PostgresScanStore(makePool({ query }));

    await expect(
      store.readPublicReport("8d140e17-68d6-489a-b451-7e87408187ae"),
    ).rejects.toThrow("invalid_public_report_row");
  });

  it.each([
    ["vantage", { report_vantage: "third_party" }],
    ["profile", { report_profile_version: "controls-v99" }],
    ["trigger", { report_trigger: "external" }],
    ["verdict", { report_verdict: "approved" }],
    ["timestamp", { report_completed_at: "not-a-date" }],
    [
      "check status",
      { checks: [{ ...makePublicReportCheck(), status: "private" }] },
    ],
    [
      "check timestamp",
      { checks: [{ ...makePublicReportCheck(), observedAt: "not-a-date" }] },
    ],
  ])(
    "rejects persisted public report rows with invalid %s",
    async (_field, overrides) => {
      const query = vi.fn().mockResolvedValue({
        rows: [makePublicReportRow(overrides)],
      });
      const store = new PostgresScanStore(makePool({ query }));

      await expect(
        store.readPublicReport("8d140e17-68d6-489a-b451-7e87408187ae"),
      ).rejects.toThrow("invalid_public_report_row");
    },
  );

  it("filters reports belonging to opted-out domains", async () => {
    const query = vi.fn().mockResolvedValue({ rows: [] });
    const store = new PostgresScanStore(makePool({ query }));

    await expect(
      store.readPublicReport("8d140e17-68d6-489a-b451-7e87408187ae"),
    ).resolves.toBeNull();
    expect(query.mock.calls[0][0]).toContain("domains.opted_out_at IS NULL");
  });

  it.each([0, -1, 5 * 60 * 1000 + 1, 1.5, Number.NaN])(
    "rejects invalid lease duration %s before querying the database",
    async (leaseDurationMs) => {
      const query = vi.fn();
      const store = new PostgresScanStore(makePool({ query }));

      await expect(
        store.claimNextScan(new Date(), leaseDurationMs),
      ).rejects.toThrow("invalid_scan_lease_duration");
      expect(query).not.toHaveBeenCalled();
    },
  );

  it("rejects invalid retry limits before querying the database", async () => {
    const query = vi.fn();
    const store = new PostgresScanStore(makePool({ query }));

    await expect(store.recoverExpiredLeases(new Date(), 0)).rejects.toThrow(
      "invalid_scan_max_attempts",
    );
    expect(query).not.toHaveBeenCalled();
  });

  it("rejects unsafe failure categories and retry limits before querying", async () => {
    const query = vi.fn();
    const store = new PostgresScanStore(makePool({ query }));

    await expect(
      store.failScan("job-id", "lease-token", "executor_failed", 0),
    ).rejects.toThrow("invalid_scan_max_attempts");
    await expect(
      store.failScan("job-id", "lease-token", "executor_failed", 11),
    ).rejects.toThrow("invalid_scan_max_attempts");
    await expect(
      store.failScan(
        "job-id",
        "lease-token",
        "private_error_message" as "executor_failed",
        3,
      ),
    ).rejects.toThrow("invalid_scan_failure_code");
    expect(query).not.toHaveBeenCalled();
  });

  it("calls only the guarded failure transition with a fixed category", async () => {
    const query = vi.fn().mockResolvedValue({
      rows: [{ ds_fail_scan: "retrying" }],
    });
    const store = new PostgresScanStore(makePool({ query }));

    await expect(
      store.failScan("job-id", "lease-token", "executor_failed", 3),
    ).resolves.toBe("retrying");
    expect(query).toHaveBeenCalledWith("SELECT ds_fail_scan($1, $2, $3, $4)", [
      "job-id",
      "lease-token",
      "executor_failed",
      3,
    ]);
  });

  it("rejects a report whose verdict does not match required controls before opening a transaction", async () => {
    const connect = vi.fn();
    const store = new PostgresScanStore(makePool({ connect }));

    await expect(
      store.completeScan({ ...VALID_REPORT, verdict: "fail" }),
    ).rejects.toThrow("scan_verdict_does_not_match_checks");
    expect(connect).not.toHaveBeenCalled();
  });

  it("persists only allowlisted evidence and generated summaries", async () => {
    const query = vi.fn().mockResolvedValue({
      rows: [{ ds_complete_scan: "run-id" }],
    });
    const store = new PostgresScanStore(makePool({ query }));
    const report = {
      ...VALID_REPORT,
      verdict: "inconclusive" as const,
      checks: [
        {
          ...VALID_REPORT.checks[0],
          summary: "<html>private page contents</html>",
          limitation: "Cookie: session=secret-value",
          evidence: {
            requestCount: 1,
            html: "private page contents",
            cookie: "session=secret-value",
          },
        },
      ],
    };

    await expect(store.completeScan(report)).resolves.toBe("run-id");

    const persistedChecks = JSON.parse(query.mock.calls[0][1][7] as string) as [
      {
        summary: string;
        limitation: string;
        evidence: Record<string, unknown>;
      },
    ];
    expect(persistedChecks[0].summary).not.toContain("private page contents");
    expect(persistedChecks[0].limitation).not.toContain("secret-value");
    expect(persistedChecks[0].evidence).toEqual({});
  });

  it("rejects an unknown profile before writing to the database", async () => {
    const query = vi.fn();
    const store = new PostgresScanStore(makePool({ query }));

    await expect(
      store.completeScan({ ...VALID_REPORT, profileVersion: "controls-v4" }),
    ).rejects.toThrow("scan_profile_not_allowlisted");
    expect(query).not.toHaveBeenCalled();
  });

  it("rejects incomplete controls-v2 coverage before writing to the database", async () => {
    const query = vi.fn();
    const store = new PostgresScanStore(makePool({ query }));

    await expect(
      store.completeScan({ ...VALID_REPORT, profileVersion: "controls-v2" }),
    ).rejects.toThrow("scan_check_coverage_incomplete");
    expect(query).not.toHaveBeenCalled();
  });

  it.each([
    { scope: ["/"], expectedCount: 10 },
    { scope: ["/", "/precios"], expectedCount: 17 },
    {
      scope: ["/", "/precios", "/informe"],
      expectedCount: 24,
    },
  ])(
    "submits exact controls-v2 coverage for $expectedCount checks",
    async ({ scope, expectedCount }) => {
      const query = vi.fn().mockResolvedValue({
        rows: [{ ds_complete_scan: "run-id" }],
      });
      const store = new PostgresScanStore(makePool({ query }));

      await expect(
        store.completeScan({
          ...VALID_REPORT,
          profileVersion: "controls-v2",
          verdict: "inconclusive",
          scope,
          checks: makeControlsV2Checks(scope),
        }),
      ).resolves.toBe("run-id");

      const persistedChecks = JSON.parse(
        query.mock.calls[0][1][7] as string,
      ) as unknown[];
      expect(persistedChecks).toHaveLength(expectedCount);
    },
  );

  it.each([
    { scope: ["/"], expectedCount: 10 },
    { scope: ["/", "/precios"], expectedCount: 17 },
    {
      scope: ["/", "/precios", "/informe"],
      expectedCount: 24,
    },
  ])(
    "submits exact controls-v3 coverage for $expectedCount checks",
    async ({ scope, expectedCount }) => {
      const query = vi.fn().mockResolvedValue({
        rows: [{ ds_complete_scan: "run-id" }],
      });
      const store = new PostgresScanStore(makePool({ query }));

      await expect(
        store.completeScan({
          ...VALID_REPORT,
          profileVersion: "controls-v3",
          verdict: "inconclusive",
          scope,
          checks: makeControlsV3Checks(scope),
        }),
      ).resolves.toBe("run-id");

      const persistedChecks = JSON.parse(
        query.mock.calls[0][1][7] as string,
      ) as unknown[];
      expect(persistedChecks).toHaveLength(expectedCount);
    },
  );

  it("rejects an out-of-scope path and method before writing to the database", async () => {
    const query = vi.fn();
    const store = new PostgresScanStore(makePool({ query }));

    await expect(
      store.completeScan({ ...VALID_REPORT, scope: ["/", "/admin"] }),
    ).rejects.toThrow("scan_scope_not_allowlisted");
    await expect(
      store.completeScan({
        ...VALID_REPORT,
        checks: [{ ...VALID_REPORT.checks[0], method: "POST" }],
      }),
    ).rejects.toThrow("scan_check_scope_not_allowlisted");
    expect(query).not.toHaveBeenCalled();
  });

  it("rejects invalid structured evidence before writing to the database", async () => {
    const query = vi.fn();
    const store = new PostgresScanStore(makePool({ query }));

    await expect(
      store.completeScan({
        ...VALID_REPORT,
        checks: [
          {
            ...VALID_REPORT.checks[0],
            evidence: { statusCode: 99 },
          },
        ],
      }),
    ).rejects.toThrow("scan_evidence_invalid");
    expect(query).not.toHaveBeenCalled();
  });

  it.each([
    ["DS-DNS-01", "DNS", {}],
    [
      "DS-DNS-01",
      "DNS",
      { addressClass: "private", aRecordCount: 1, aaaaRecordCount: 0 },
    ],
    [
      "DS-TLS-01",
      "TLS",
      { protocol: "TLSv1.3", certificateValid: false, hostnameMatches: true },
    ],
    [
      "DS-TLS-02",
      "TLS",
      {
        tls10Accepted: true,
        tls11Accepted: false,
        tls12Accepted: true,
        tls13Accepted: true,
      },
    ],
    [
      "DS-HTTP-01",
      "GET",
      { statusCode: 500, redirectedToHttps: true, finalScheme: "https" },
    ],
    [
      "DS-HTTP-01",
      "GET",
      { statusCode: 200, redirectedToHttps: true, finalScheme: "http" },
    ],
    ["DS-PRIV-01", "GET", { thirdPartyAttempts: 1, blockedRequests: 1 }],
    [
      "DS-PRIV-02",
      "GET",
      {
        cookieCount: 1,
        insecureCookieCount: 1,
        thirdPartyCookieCount: 0,
        inspected: true,
      },
    ],
    ["DS-PRIV-03", "GET", { mixedContentCount: 1, insecureNavigationCount: 0 }],
    [
      "DS-QUAL-01",
      "GET",
      { documentStatusCode: 200, failedEssentialResourceCount: 1 },
    ],
  ])(
    "does not submit a pass with insufficient or contradictory %s evidence",
    async (controlId, method, evidence) => {
      const query = vi.fn();
      const store = new PostgresScanStore(makePool({ query }));

      await expect(
        store.completeScan({
          ...VALID_REPORT,
          checks: [{ ...VALID_REPORT.checks[0], controlId, method, evidence }],
        }),
      ).rejects.toThrow();
      expect(query).not.toHaveBeenCalled();
    },
  );

  it("drops TLS expiry metadata because it is outside the evidence contract", async () => {
    const query = vi.fn().mockResolvedValue({
      rows: [{ ds_complete_scan: "run-id" }],
    });
    const store = new PostgresScanStore(makePool({ query }));

    await store.completeScan({
      ...VALID_REPORT,
      verdict: "pass",
      checks: [
        {
          ...VALID_REPORT.checks[0],
          controlId: "DS-TLS-01",
          method: "TLS",
          evidence: {
            protocol: "TLSv1.3",
            certificateValid: true,
            hostnameMatches: true,
            expiresAt: "2027-04-05T06:07:08.000Z",
          },
        },
      ],
    });

    const persistedChecks = JSON.parse(query.mock.calls[0][1][7] as string) as [
      { evidence: Record<string, unknown> },
    ];
    expect(persistedChecks[0].evidence).toEqual({
      protocol: "TLSv1.3",
      certificateValid: true,
      hostnameMatches: true,
    });
  });

  it("persists an HTTP status at the maximum allowed boundary", async () => {
    const query = vi.fn().mockResolvedValue({
      rows: [{ ds_complete_scan: "run-id" }],
    });
    const store = new PostgresScanStore(makePool({ query }));

    await store.completeScan({
      ...VALID_REPORT,
      verdict: "fail",
      checks: [
        {
          ...VALID_REPORT.checks[0],
          evidence: {
            statusCode: 599,
            redirectedToHttps: true,
            finalScheme: "https",
          },
        },
      ],
    });

    const persistedChecks = JSON.parse(query.mock.calls[0][1][7] as string) as [
      { evidence: Record<string, unknown> },
    ];
    expect(persistedChecks[0].evidence.statusCode).toBe(599);
  });

  it("closes the underlying connection pool", async () => {
    const end = vi.fn().mockResolvedValue(undefined);
    const store = new PostgresScanStore(makePool({ end }));

    await store.close();

    expect(end).toHaveBeenCalledOnce();
  });

  function makePool(overrides: Record<string, unknown>): Pool {
    return {
      query: vi.fn(),
      connect: vi.fn(),
      end: vi.fn(),
      ...overrides,
    } as unknown as Pool;
  }

  function makePublicReportRow(overrides: Record<string, unknown> = {}) {
    return {
      report_id: "8d140e17-68d6-489a-b451-7e87408187ae",
      report_hostname: "example.com",
      report_profile_version: "controls-v3",
      report_scanner_version: "scanner-v1",
      report_vantage: "same_vps",
      report_trigger: "scheduled",
      report_started_at: new Date("2026-11-03T10:00:00.000Z"),
      report_completed_at: new Date("2026-11-03T10:01:00.000Z"),
      report_expires_at: new Date("2026-11-03T11:01:00.000Z"),
      report_verdict: "inconclusive",
      report_scope: ["/"],
      checks: [],
      ...overrides,
    };
  }

  function makePublicReportCheck() {
    return {
      controlId: "DS-HDR-01",
      status: "unknown",
      required: true,
      severity: "high",
      observedAt: "2026-11-03T10:00:30.000Z",
      targetPath: "/",
      method: "GET",
      summary: "Comprobación DS-HDR-01: unknown.",
      limitation: "Resultado limitado al perfil controls-v3.",
    };
  }
});

function makeControlsV2Checks(scope: readonly string[]) {
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
  const commonCheck = VALID_REPORT.checks[0];

  return [
    ...hostChecks.map(([controlId, method]) => ({
      ...commonCheck,
      controlId,
      status: "unknown" as const,
      targetPath: "/",
      method,
      evidence: {},
    })),
    ...scope.flatMap((targetPath) =>
      routeChecks.map(([controlId, method]) => ({
        ...commonCheck,
        controlId,
        status: "unknown" as const,
        targetPath,
        method,
        evidence: {},
      })),
    ),
  ];
}

function makeControlsV3Checks(scope: readonly string[]) {
  return makeControlsV2Checks(scope).map((check) => {
    if (check.controlId !== "DS-HDR-01") return check;
    return {
      ...check,
      evidence: { finalScheme: "https" },
    };
  });
}
