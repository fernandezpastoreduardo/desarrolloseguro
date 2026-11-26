import { BadRequestException } from "@nestjs/common";
import { assessPrivacy } from "@desarrolloseguro/core";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PublicScanService } from "./public-scan.service.js";

const REPORT_ID = "8d140e17-68d6-489a-b451-7e87408187ae";
const INTERNAL_STORAGE_ERROR = "postgres password must not escape";
const PRIVATE_RESPONSE_BODY = "<html>customer-private-content</html>";
const FIXED_NOW = new Date("2026-11-03T10:00:00.000Z");
const TARGET_URL = "https://example.com/legal/privacy?lang=es";

afterEach(() => vi.useRealTimers());

describe("PublicScanService", () => {
  it("returns a bounded public history ordered by the store", async () => {
    const reports = [
      makeReport({ id: REPORT_ID, completedAt: new Date("2026-11-03T10:01:00.000Z") }),
      makeReport({ id: "123e4567-e89b-42d3-a456-426614174000", completedAt: new Date("2026-11-02T10:01:00.000Z") }),
    ];
    const readPublicReportHistory = vi.fn().mockResolvedValue(reports);
    const service = new PublicScanService({
      scanStore: {
        readPublicDomainSnapshot: vi.fn(),
        readPublicReport: vi.fn(),
        readPublicReportHistory,
      },
    });

    await expect(service.getReportHistory(" EXAMPLE.COM. ")).resolves.toEqual([
      expect.objectContaining({
        id: REPORT_ID,
        hostname: "example.com",
        profileVersion: "controls-v3",
        globalAssessment: expect.objectContaining({
          policyVersion: "mvp-global-v2",
          status: "not_available",
          score: null,
          legalViolationAccredited: false,
        }),
        score: null,
        assessedCriteria: 0,
        totalCriteria: 8,
      }),
      expect.objectContaining({
        id: "123e4567-e89b-42d3-a456-426614174000",
      }),
    ]);
    expect(readPublicReportHistory).toHaveBeenCalledExactlyOnceWith("example.com", 12);
  });

  it("does not expose storage details when history cannot be read", async () => {
    const readPublicReportHistory = vi.fn().mockRejectedValue(new Error(INTERNAL_STORAGE_ERROR));
    const service = new PublicScanService({
      scanStore: {
        readPublicDomainSnapshot: vi.fn(),
        readPublicReport: vi.fn(),
        readPublicReportHistory,
      },
    });

    await expect(service.getReportHistory("example.com")).rejects.toMatchObject({
      status: 503,
      message: "development_security_unavailable",
    });
  });

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

  it("reads status for the canonical target URL while preserving its query", async () => {
    const readPublicDomainSnapshot = vi.fn().mockResolvedValue(null);
    const service = new PublicScanService({
      scanStore: { readPublicDomainSnapshot, readPublicReport: vi.fn() },
    });

    await service.getDomainStatus(" EXAMPLE.COM. ", `${TARGET_URL}#section`);

    expect(readPublicDomainSnapshot).toHaveBeenCalledExactlyOnceWith(
      "example.com",
      TARGET_URL,
    );
  });

  it("rejects a target URL whose hostname differs from the route", async () => {
    const readPublicDomainSnapshot = vi.fn();
    const service = new PublicScanService({
      scanStore: { readPublicDomainSnapshot, readPublicReport: vi.fn() },
    });

    await expect(
      service.getDomainStatus("example.com", "https://other.example.net/legal"),
    ).rejects.toMatchObject({ status: 400, message: "scan_target_hostname_mismatch" });
    expect(readPublicDomainSnapshot).not.toHaveBeenCalled();
  });

  it("presents the canonical report with separate redirect evidence for the requested alias", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(FIXED_NOW);
    const canonicalReport = makeReport({ hostname: "grumphya.com" });
    const service = new PublicScanService({
      scanStore: {
        readPublicDomainSnapshot: vi.fn().mockResolvedValue({
          hostname: "www.grumphya.com",
          enrollment: "monitored",
          profileVersion: "domain-v3",
          optedOut: false,
          activeJobId: null,
          lastReport: canonicalReport,
          lastFailure: null,
          hostnameResolution: {
            observedReportId: REPORT_ID,
            requestedHostname: "www.grumphya.com",
            canonicalHostname: "grumphya.com",
            statusCode: 301,
            responseStatusCode: 200,
            fromHostname: "www.grumphya.com",
            toHostname: "grumphya.com",
          },
        }),
        readPublicReport: vi.fn(),
      },
    });
    const status = await service.getDomainStatus("www.grumphya.com");
    expect(status.hostnameResolution).toEqual({
      observedReportId: REPORT_ID,
      requestedHostname: "www.grumphya.com",
      canonicalHostname: "grumphya.com",
      statusCode: 301,
      responseStatusCode: 200,
      fromHostname: "www.grumphya.com",
      toHostname: "grumphya.com",
    });
    expect(status.lastReport?.hostname).toBe("grumphya.com");
  });

  it("requires explicit authorization before requesting an on-demand analysis", async () => {
    const requestOnDemandScan = vi.fn().mockResolvedValue({ kind: "queued" });
    const service = new PublicScanService({
      scanStore: { readPublicDomainSnapshot: vi.fn(), readPublicReport: vi.fn(), requestOnDemandScan },
    });

    await expect(
      service.requestAnalysis("example.com", { authorized: false, targetUrl: TARGET_URL }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(requestOnDemandScan).not.toHaveBeenCalled();
  });

  it("requests the canonical target URL without losing its path or query", async () => {
    const requestOnDemandScan = vi.fn().mockResolvedValue({ kind: "queued" });
    const service = new PublicScanService({
      scanStore: {
        readPublicDomainSnapshot: vi.fn(),
        readPublicReport: vi.fn(),
        requestOnDemandScan,
      },
    });
    await expect(service.requestAnalysis("www.grumphya.com", {
      authorized: true,
      targetUrl: "https://www.grumphya.com/politica?lang=es#section",
    })).resolves.toEqual({
      hostname: "www.grumphya.com",
      state: "queued",
      targetUrl: "https://www.grumphya.com/politica?lang=es",
    });
    expect(requestOnDemandScan).toHaveBeenCalledExactlyOnceWith(
      "www.grumphya.com",
      "https://www.grumphya.com/politica?lang=es",
    );
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
        targetUrl: TARGET_URL,
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
      service.requestAnalysis(" EXAMPLE.COM. ", { authorized: true, targetUrl: TARGET_URL }),
    ).resolves.toEqual({ hostname: "example.com", state: "queued", targetUrl: TARGET_URL });
    expect(requestOnDemandScan).toHaveBeenCalledWith("example.com", TARGET_URL);
  });

  it("does not expose storage errors from analysis admission", async () => {
    const requestOnDemandScan = vi.fn().mockRejectedValue(
      new Error("private database credentials"),
    );
    const service = new PublicScanService({
      scanStore: { readPublicDomainSnapshot: vi.fn(), readPublicReport: vi.fn(), requestOnDemandScan },
    });

    await expect(
      service.requestAnalysis("example.com", { authorized: true, targetUrl: TARGET_URL }),
    ).rejects.toMatchObject({
      status: 503,
      message: "development_security_unavailable",
    });
  });

  it("requires a valid target URL with exactly the route hostname for admission", async () => {
    const requestOnDemandScan = vi.fn();
    const service = new PublicScanService({
      scanStore: { readPublicDomainSnapshot: vi.fn(), readPublicReport: vi.fn(), requestOnDemandScan },
    });

    await expect(service.requestAnalysis("example.com", { authorized: true }))
      .rejects.toMatchObject({ status: 400 });
    await expect(service.requestAnalysis("example.com", {
      authorized: true,
      targetUrl: "https://other.example.net/private?token=secret",
    })).rejects.toMatchObject({ status: 400, message: "scan_target_hostname_mismatch" });
    expect(requestOnDemandScan).not.toHaveBeenCalled();
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
          activeProgress: {
            policyVersion: "public-audit-progress-v1",
            aspects: { ethics: "pending", privacy: "running", security: "complete", performance: "pending" },
          },
          lastReport: report,
        }),
        readPublicReport: vi.fn(),
      },
    });

    const status = await service.getDomainStatus(report.hostname);

    expect(status.state).toBe("updating");
    expect(status.activeJobId).toBe("7d140e17-68d6-489a-b451-7e87408187ae");
    expect(status.lastReport?.id).toBe(report.id);
    expect(status.auditProgress?.aspects).toEqual({
      ethics: "pending", privacy: "running", security: "complete", performance: "pending",
    });
  });

  it("projects a terminal scan failure as failed with only a safe stage code", async () => {
    const service = new PublicScanService({
      scanStore: {
        readPublicDomainSnapshot: vi.fn().mockResolvedValue({
          hostname: "example.com",
          enrollment: "on_demand",
          profileVersion: "domain-v1",
          optedOut: false,
          activeJobId: null,
          lastReport: null,
          lastFailure: {
            code: "broker_failed",
            failedAt: FIXED_NOW,
            diagnostic: { stage: "broker_start", code: "docker_daemon_unavailable" },
          },
        }),
        readPublicReport: vi.fn(),
      },
    });

    await expect(service.getDomainStatus("example.com")).resolves.toMatchObject({
      state: "failed",
      failureCode: "broker_failed",
      failureDiagnostic: { stage: "broker_start", code: "docker_daemon_unavailable" },
      lastReport: null,
    });
  });

  it("gives a fresh active request priority over a previous terminal failure", async () => {
    const service = new PublicScanService({
      scanStore: {
        readPublicDomainSnapshot: vi.fn().mockResolvedValue({
          hostname: "example.com",
          enrollment: "on_demand",
          profileVersion: "domain-v1",
          optedOut: false,
          activeJobId: "7d140e17-68d6-489a-b451-7e87408187ae",
          lastReport: null,
          lastFailure: {
            code: "broker_failed",
            failedAt: FIXED_NOW,
          },
        }),
        readPublicReport: vi.fn(),
      },
    });

    await expect(service.getDomainStatus("example.com")).resolves.toMatchObject({
      state: "updating",
      activeJobId: "7d140e17-68d6-489a-b451-7e87408187ae",
      failureCode: null,
    });
  });

  it("projects only bounded public evidence into reports embedded in domain status", async () => {
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
          evidence: { hsts: false, nosniff: true, responseBody: PRIVATE_RESPONSE_BODY },
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

    expect(status.lastReport?.checks[0]).toHaveProperty("evidence", { hsts: false, nosniff: true });
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

  it("projects safe TLS and DNS evidence without exposing raw network data", async () => {
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
          evidence: { addressClass: "public", aRecordCount: 1, rawAddresses: ["203.0.113.5"] },
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
      ethicsAssessment: {
        policyVersion: "domain-ethics-v3",
        score: 100,
        assessedCriteria: 1,
        totalCriteria: 8,
      },
      checks: [
        {
          controlId: "DS-DNS-01",
          method: "DNS",
          status: "pass",
        },
      ],
    });
    expect(publicReport.checks[0]).toHaveProperty("evidence", { addressClass: "public", aRecordCount: 1 });
  });

  it("returns a running internal-audit state on the current Grumphya report URL", async () => {
    const report = makeReport({ hostname: "grumphya.com" });
    const service = new PublicScanService({
      scanStore: {
        readPublicReport: vi.fn().mockResolvedValue(report),
        readPublicDomainSnapshot: vi.fn().mockResolvedValue({
          hostname: "grumphya.com",
          enrollment: "monitored",
          profileVersion: "domain-v3",
          optedOut: false,
          activeJobId: REPORT_ID,
          lastReport: report,
          lastFailure: null,
        }),
      },
    });

    await expect(service.getReport(REPORT_ID)).resolves.toMatchObject({
      internalAuditState: "running",
      internalAuditSummary: { status: "review" },
    });
  });

  it("adds a Beta assessment using only the supported public controls", async () => {
    const report = makeReport({
      checks: [
        {
          controlId: "DS-TLS-01",
          status: "pass",
          required: true,
          severity: "high",
          observedAt: FIXED_NOW,
          targetPath: "/",
          method: "TLS",
          summary: "Comprobación DS-TLS-01: pass.",
          limitation: "Resultado limitado al perfil domain-v3.",
          evidence: { certificateValid: true, hostnameMatches: true, protocol: "TLSv1.3" },
        },
        {
          controlId: "DS-TLS-02",
          status: "pass",
          required: true,
          severity: "high",
          observedAt: FIXED_NOW,
          targetPath: "/",
          method: "TLS",
          summary: "Comprobación DS-TLS-02: pass.",
          limitation: "Resultado limitado al perfil domain-v3.",
          evidence: { tls10Accepted: false, tls11Accepted: false, tls12Accepted: true, tls13Accepted: true },
        },
        {
          controlId: "DS-HDR-01",
          status: "pass",
          required: true,
          severity: "medium",
          observedAt: FIXED_NOW,
          targetPath: "/",
          method: "GET",
          summary: "Comprobación DS-HDR-01: pass.",
          limitation: "Resultado limitado al perfil domain-v3.",
          evidence: { hsts: true, nosniff: true, frameProtection: true, referrerPolicy: true, csp: true },
        },
        {
          controlId: "DS-PRIV-05",
          status: "fail",
          required: true,
          severity: "medium",
          observedAt: FIXED_NOW,
          targetPath: "/",
          method: "GET",
          summary: "Comprobación DS-PRIV-05: fail.",
          limitation: "Resultado limitado al perfil domain-v3.",
          evidence: { inspected: true, cookieCount: 1, insecureCookieCount: 0, catalogMatchCount: 1, consentPromptDetected: true },
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

    expect(publicReport.betaCertification).toMatchObject({
      policyVersion: "beta-0.1",
      score: 70,
      eligibility: "blocked",
      assessedCategories: 3,
      totalCategories: 3,
    });
  });

  it("publishes backend processor transparency as Grumphya declarations", async () => {
    const report = makeReport({
      hostname: "grumphya.com",
      processorTransparencyAssessment: {
        policyVersion: "processor-inventory-v1",
        status: "pass",
        reasonCode: "inventory_complete_and_disclosed",
        inventory: {
          policyVersion: "processor-inventory-v1",
          observedAt: "2026-11-03T10:00:00.000Z",
          validUntil: "2026-11-04T10:00:00.000Z",
          hostname: "grumphya.com",
          deploymentDigest: `sha256:${"a".repeat(64)}`,
          inventoryStatus: "complete",
          privacyPolicy: { url: "https://grumphya.com/politica-de-privacidad", revision: "v5" },
          processors: [{
            providerId: "openai-api",
            displayName: "OpenAI",
            product: "API",
            disclosureStatus: "published",
            purpose: "Procesamiento de solicitudes de IA",
            policyUrl: "https://grumphya.com/politica-de-privacidad#openai-api",
            declaredStatements: ["Grumphya declara que no usa un endpoint regional."],
          }],
          attestation: { verified: true, keyId: "grumphya-release-2026" },
        },
      },
    });
    const service = new PublicScanService({
      scanStore: {
        readPublicDomainSnapshot: vi.fn(),
        readPublicReport: vi.fn().mockResolvedValue(report),
      },
    });

    const result = await service.getReport(REPORT_ID);

    expect(result.ethicsAssessment.policyVersion).toBe("domain-ethics-v4");
    expect(result.ethicsAssessment.criteria).toContainEqual(expect.objectContaining({
      id: "backend-processor-transparency",
      status: "pass",
      weight: 10,
    }));
    expect(result.processorTransparencyAssessment?.inventory?.processors[0]).toMatchObject({
      displayName: "OpenAI",
      declaredStatements: ["Grumphya declara que no usa un endpoint regional."],
    });
    expect(JSON.stringify(result)).not.toContain("signature");
  });

  it("uses the common service comparison for non-clients", async () => {
    const firstEntryPolicyAccess = {
      policyVersion: "first-entry-policy-access-v1",
      status: "fail",
      reasonCode: "consent_link_missing",
      consentPromptDetected: true,
      thirdPartyCookieDetected: true,
      nonEssentialThirdPartyStorageDetected: true,
      linkLocation: "none",
      link: null,
      documentAccess: "not_checked",
    } as const;
    const report = makeReport({
      hostname: "example.com",
      profileVersion: "domain-v5",
      scannerVersion: "domain-v5-network-adapter-2",
      publicPolicyTransparencyAssessment: {
        policyVersion: "public-policy-v1",
        status: "fail",
        reasonCode: "policy_link_missing",
        evidence: {
          linksFound: 0,
          pagesInspected: 0,
          unavailablePages: 0,
          accessDeniedPages: 0,
          providerMentions: 0,
          providersMissingPurpose: 0,
          categories: [],
        },
      },
      publicServiceComparison: {
        policyVersion: "public-service-comparison-v1",
        status: "fail",
        reasonCode: "observed_service_undisclosed",
        items: [{ providerId: "google-analytics", observation: "observed", observedDomains: ["google-analytics.com"], declaredPurposes: [] }],
      },
      firstEntryPolicyAccess,
      providerCatalogVersion: "a".repeat(64),
    });
    const service = new PublicScanService({
      scanStore: {
        readPublicDomainSnapshot: vi.fn(),
        readPublicReport: vi.fn().mockResolvedValue(report),
      },
    });

    const result = await service.getReport(REPORT_ID);

    expect(result.ethicsAssessment.policyVersion).toBe("domain-ethics-v6");
    expect(result.ethicsAssessment.criteria).toContainEqual(expect.objectContaining({
      id: "external-service-transparency",
      status: "fail",
      weight: 10,
    }));
    expect(result.firstEntryPolicyAccess).toEqual(firstEntryPolicyAccess);
    expect(result.providerCatalogVersion).toBe("a".repeat(64));
  });

  it("publishes the equal-weight MVP score only when both dimensions have full coverage", async () => {
    const controlIds = [
      "DS-DNS-01", "DS-TLS-01", "DS-TLS-02", "DS-HTTP-01", "DS-HDR-01",
      "DS-PRIV-04", "DS-PRIV-05", "DS-PRIV-06", "DS-QUAL-02",
    ];
    const checks = controlIds.map((controlId) => ({
      controlId,
      status: "pass",
      required: true,
      severity: "high",
      observedAt: new Date("2026-11-03T10:00:30.000Z"),
      targetPath: "/",
      method: "GET",
      summary: `${controlId} pass`,
      limitation: "Observed public control.",
      evidence: {},
    }));
    const privacyAssessment = assessPrivacy({
      criteria: [
        "preference-before-tracking", "contextual-excess", "choice-parity",
        "rejection-persistence", "vendor-controls",
      ].map((id) => ({ id, status: "evaluated", findings: [] })),
      evidence: { cookieNames: [], providers: [], domains: [] },
    });
    const report = makeReport({ checks, privacyAssessment });
    const service = new PublicScanService({
      scanStore: {
        readPublicDomainSnapshot: vi.fn(),
        readPublicReport: vi.fn().mockResolvedValue(report),
      },
    });

    await expect(service.getReport(REPORT_ID)).resolves.toMatchObject({
      globalAssessment: {
        policyVersion: "mvp-global-v2",
        status: "scored",
        score: 100,
        legalViolationAccredited: false,
        weights: { ethics: 50, privacy: 50 },
        ethicsCoverage: { assessedCriteria: 8, totalCriteria: 8 },
        privacyCoverage: {
          assessedCriteria: 5,
          unknownCriteria: 0,
          notApplicableCriteria: 0,
          totalCriteria: 5,
        },
      },
      ethicsAssessment: { score: 100 },
      privacyAssessment: { score: 100 },
    });
  });

  it("fixes the public global score at zero when a legal cookie finding is accredited", async () => {
    const report = makeReport({
      legalCookieFindings: [{
        ruleId: "lssi-cookie-no-prior-consent-v1",
        ruleVersion: "1.0.0",
        status: "accredited",
        title: "Uso de cookies analíticas o de seguimiento antes del consentimiento",
        description: "El navegador limpio registró una cookie no exenta antes de cualquier elección.",
        jurisdiction: "ES",
        articles: (["22.2", "38.4.g", "39.1.c", "43.1"] as const).map((article) => ({
          law: "LSSI",
          article,
          url: "https://www.boe.es/buscar/act.php?id=BOE-A-2002-13758",
        })),
        infringementClass: "minor",
        sanction: { type: "statutory_maximum", currency: "EUR", maximum: 30000 },
        authority: "Agencia Española de Protección de Datos",
        evidence: [{
          flow: "initial",
          phase: "before_choice",
          capturedAtMs: 250,
          cookieName: "_ga",
          cookieDomain: "example.com",
          provider: "Google Analytics",
          purpose: "analytics",
          attributionRuleId: "google-analytics-ga-v1",
          correlatedRequestHosts: ["www.google-analytics.com"],
        }],
        evidenceComplete: true,
      }],
    });
    const service = new PublicScanService({
      scanStore: {
        readPublicDomainSnapshot: vi.fn(),
        readPublicReport: vi.fn().mockResolvedValue(report),
      },
    });

    await expect(service.getReport(REPORT_ID)).resolves.toMatchObject({
      globalAssessment: {
        policyVersion: "mvp-global-v2",
        status: "scored",
        score: 0,
        legalViolationAccredited: true,
      },
      legalCookieFindings: [{ status: "accredited", ruleId: "lssi-cookie-no-prior-consent-v1" }],
    });
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

  it("marks Grumphya's internal audit as running while the latest report is being renewed", async () => {
    const report = makeReport({ hostname: "grumphya.com" });
    const service = new PublicScanService({
      scanStore: {
        readPublicDomainSnapshot: vi.fn().mockResolvedValue({
          hostname: "grumphya.com",
          enrollment: "monitored",
          profileVersion: "domain-v3",
          optedOut: false,
          activeJobId: REPORT_ID,
          lastReport: report,
          lastFailure: null,
        }),
        readPublicReport: vi.fn(),
      },
    });

    const status = await service.getDomainStatus("grumphya.com");

    expect(status.state).toBe("updating");
    expect(status.lastReport).toMatchObject({
      internalAuditState: "running",
      internalAuditSummary: { status: "review" },
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

  it("does not return raw or non-allowlisted evidence in public report results", async () => {
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
          evidence: { hsts: false, responseBody: PRIVATE_RESPONSE_BODY },
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
    expect(result.checks[0]).toHaveProperty("evidence", { hsts: false });
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
        "globalAssessment",
        "ethicsAssessment",
        "privacyAssessment",
        "processorTransparencyAssessment",
        "publicPolicyTransparencyAssessment",
        "publicServiceComparison",
        "firstEntryPolicyAccess",
        "providerCatalogVersion",
        "betaCertification",
        "internalAuditState",
        "internalAuditSummary",
        "certification",
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
        "evidence",
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
    processorTransparencyAssessment: null,
    publicPolicyTransparencyAssessment: null,
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
