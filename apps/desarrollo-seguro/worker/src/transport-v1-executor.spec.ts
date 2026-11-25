import { describe, expect, it, vi } from "vitest";
import type { ClaimedScanJob } from "@desarrolloseguro/persistence";
import { parseTransportV1ExecutorResponse } from "./transport-v1-executor-protocol.js";
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

describe("TransportV1 executors", () => {
  it("preserves domain-v4 privacy evidence across the executor response boundary", () => {
    const discoveredDocuments = [{
      href: "https://vendor.example.net/dpa",
      anchorText: "Data Processing Addendum",
      kind: "legal",
      documentRole: "provider_document",
      sourcePageUrl: "https://example.net/privacy",
      fetchStatus: "fetched",
      sha256: "a".repeat(64),
    }];
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
    const observedAt = "2026-11-24T03:00:00.000Z";
    const controlIds = ["DS-DNS-01", "DS-TLS-01", "DS-TLS-02", "DS-HTTP-01", "DS-HDR-01", "DS-PRIV-04", "DS-PRIV-05", "DS-PRIV-06", "DS-PRIV-07", "DS-QUAL-02"];
    const result = {
      scannerVersion: "domain-v4-network-adapter-7",
      startedAt: observedAt,
      completedAt: observedAt,
      verdict: "inconclusive",
      scope: ["/"],
      checks: controlIds.map((controlId) => ({
        controlId, status: "unknown", required: true, severity: "high", observedAt,
        targetPath: "/", method: "GET", summary: "Fixture observation.", limitation: "Fixture only.", evidence: {},
      })),
      metrics: { requestsCount: 0, bytesCount: 0, durationMs: 0, pagesCount: 0 },
      publicPolicyTransparencyAssessment: {
        policyVersion: "public-policy-v1",
        status: "pass",
        reasonCode: "disclosure_found",
        evidence: { linksFound: 1, pagesInspected: 1, unavailablePages: 0, accessDeniedPages: 0, providerMentions: 1, providersMissingPurpose: 0, categories: ["other"] },
      },
      publicServiceComparison: null,
      publicPolicyDiscoveredDocuments: discoveredDocuments,
      legalCookieFindings: [],
      firstEntryPolicyAccess,
    };

    const response = parseTransportV1ExecutorResponse({ protocolVersion: 1, requestId: JOB.id, result }, JOB.id, "domain-v4");

    expect("result" in response && response.result).toMatchObject({
      publicServiceComparison: null,
      publicPolicyDiscoveredDocuments: discoveredDocuments,
      legalCookieFindings: [],
      firstEntryPolicyAccess,
    });

    expect(() => parseTransportV1ExecutorResponse({
      protocolVersion: 1,
      requestId: JOB.id,
      result: { ...result, publicPolicyDiscoveredDocuments: [{ ...discoveredDocuments[0], sha256: null }] },
    }, JOB.id, "domain-v4")).toThrow("executor_result_invalid");
  });

  it("retains normalized provider-purpose declarations from the public policy", async () => {
    const policyEvidence = {
      publicPolicyLinksFound: 1,
      publicPolicyPagesInspected: 1,
      publicPolicyUnavailablePages: 0,
      publicPolicyAccessDeniedPages: 0,
      publicPolicyProviderMentions: 1,
      publicPolicyProvidersMissingPurpose: 0,
      publicPolicyCategories: "analytics",
      publicPolicyDeclaredServices: JSON.stringify([
        {
          providerId: "google-analytics",
          purposeIds: ["analytics"],
          siteStatements: [{
            factId: "provider_receives_personal_data",
            value: true,
            basis: "explicit_claim",
            source: {
              sourceId: "policy-0123456789abcdef0123456789abcdef",
              version: "public-policy-source-v1",
              title: "Privacy notice",
              url: "https://example.com/privacy",
              capturedAt: "2026-11-24T03:00:00.000Z",
              documentKind: "privacy",
              sourceKind: "audited_site",
              excerpt: "Google Analytics receives personal data from users.",
            },
          }],
          legalEvidenceContext: {
            dataOrigin: {
              value: "obtained_from_subject",
              evidence: [{
                sourceId: "policy-context-0123456789abcdef0123456789abcdef",
                version: "public-policy-source-v1",
                title: "Privacy notice",
                url: "https://example.com/privacy",
                capturedAt: "2026-11-24T03:00:00.000Z",
                documentKind: "privacy",
                sourceKind: "audited_site",
                excerpt: "We collect personal data directly from the data subject.",
              }],
            },
            auditedEntityIsController: {
              evidence: [{
                sourceId: "policy-context-0123456789abcdef0123456789abcdef",
                version: "public-policy-source-v1",
                title: "Privacy notice",
                url: "https://example.com/privacy",
                capturedAt: "2026-11-24T03:00:00.000Z",
                documentKind: "privacy",
                sourceKind: "audited_site",
                excerpt: "We are the data controller.",
              }],
            },
          },
        },
      ]),
      publicPolicyDiscoveredDocuments: JSON.stringify([{
        href: "https://vendor.example.net/dpa",
        anchorText: "Data Processing Addendum",
        kind: "legal",
        documentRole: "provider_document",
        sourcePageUrl: "https://example.com/privacy",
        fetchStatus: "fetched",
        sha256: "b".repeat(64),
      }]),
    };
    const source: TransportV1ObservationSource = {
      sourceKind: "network",
      observeDns: async () => ({ evidence: { addressClass: "public", aRecordCount: 1, aaaaRecordCount: 0 }, requestsCount: 0, bytesCount: 0 }),
      observeTls: async () => ({ evidence: { protocol: "TLSv1.3", certificateValid: true, hostnameMatches: true }, requestsCount: 1, bytesCount: 1 }),
      observeHttp: async () => ({ evidence: { statusCode: 200, redirectedToHttps: true, finalScheme: "https" }, requestsCount: 1, bytesCount: 1 }),
      observeHeaders: async () => ({ evidence: policyEvidence, requestsCount: 1, bytesCount: 100 }),
    };

    const result = await new TransportV1NetworkExecutor(source).execute(
      { ...JOB, profileVersion: "domain-v4" },
      new AbortController().signal,
    );

    expect(result.publicServiceDeclarations).toEqual([
      {
        providerId: "google-analytics",
        purposes: ["analytics"],
        siteStatements: [{
          factId: "provider_receives_personal_data",
          value: true,
          basis: "explicit_claim",
          source: {
            sourceId: "policy-0123456789abcdef0123456789abcdef",
            version: "public-policy-source-v1",
            title: "Privacy notice",
            url: "https://example.com/privacy",
            capturedAt: "2026-11-24T03:00:00.000Z",
            documentKind: "privacy",
            sourceKind: "audited_site",
            excerpt: "Google Analytics receives personal data from users.",
          },
        }],
        legalEvidenceContext: {
          dataOrigin: expect.objectContaining({ value: "obtained_from_subject", evidence: [expect.objectContaining({ sourceKind: "audited_site" })] }),
          auditedEntityIsController: { evidence: [expect.objectContaining({ excerpt: "We are the data controller." })] },
        },
      },
    ]);
    expect(result.publicPolicyDiscoveredDocuments).toEqual([{
      href: "https://vendor.example.net/dpa",
      anchorText: "Data Processing Addendum",
      kind: "legal",
      documentRole: "provider_document",
      sourcePageUrl: "https://example.com/privacy",
      fetchStatus: "fetched",
      sha256: "b".repeat(64),
    }]);
  });

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

  it("records the full TLS version matrix in domain-v3 and fails on legacy protocols", async () => {
    const source = makeSource();
    vi.mocked(source.observeTls).mockResolvedValue({
      protocol: "TLSv1.3",
      certificateValid: true,
      hostnameMatches: true,
      tls10Accepted: false,
      tls11Accepted: false,
      tls12Accepted: true,
      tls13Accepted: true,
    });
    const executor = new TransportV1FixtureExecutor(source);

    const secure = await executor.execute(
      { ...JOB, profileVersion: "domain-v3" },
      new AbortController().signal,
    );
    expect(secure.scannerVersion).toBe("domain-v3-fixture-adapter-1");
    expect(secure.checks).toHaveLength(9);
    expect(secure.checks.find(({ controlId }) => controlId === "DS-TLS-02"))
      .toMatchObject({ status: "pass", evidence: { tls10Accepted: false, tls11Accepted: false, tls12Accepted: true, tls13Accepted: true } });

    vi.mocked(source.observeTls).mockResolvedValue({
      protocol: "TLSv1.3",
      certificateValid: true,
      hostnameMatches: true,
      tls10Accepted: true,
      tls11Accepted: false,
      tls12Accepted: true,
      tls13Accepted: true,
    });
    const weak = await executor.execute(
      { ...JOB, profileVersion: "domain-v3" },
      new AbortController().signal,
    );
    expect(weak.checks.find(({ controlId }) => controlId === "DS-TLS-02"))
      .toMatchObject({ status: "fail", evidence: { tls10Accepted: true } });
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

  it("preserves safe TLS diagnostics when the protocol matrix is incomplete", async () => {
    const source = makeSource();
    vi.mocked(source.observeTls).mockResolvedValue({
      protocol: "TLSv1.3",
      certificateValid: true,
      hostnameMatches: true,
      tls12ProbeError: "connection_failed",
      tls13ProbeError: "request_timeout",
    });
    const executor = new TransportV1FixtureExecutor(source);

    const result = await executor.execute(
      { ...JOB, profileVersion: "domain-v3" },
      new AbortController().signal,
    );

    expect(result.checks.find(({ controlId }) => controlId === "DS-TLS-02"))
      .toMatchObject({
        status: "unknown",
        evidence: { tls12ProbeError: "connection_failed", tls13ProbeError: "request_timeout" },
        summary: "No se pudieron completar todas las pruebas de TLS. TLS 1.2: no se pudo completar la conexión. TLS 1.3: se agotó el tiempo de espera.",
      });
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

  it("scores only a known non-essential cookie observed in the initial response", async () => {
    const source: TransportV1ObservationSource = {
      sourceKind: "network",
      observeDns: vi.fn().mockResolvedValue({
        evidence: { addressClass: "public", aRecordCount: 1, aaaaRecordCount: 0 },
        requestsCount: 0,
        bytesCount: 0,
      }),
      observeTls: vi.fn().mockResolvedValue({
        evidence: { protocol: "TLSv1.3", certificateValid: true, hostnameMatches: true },
        requestsCount: 1,
        bytesCount: 1,
      }),
      observeHttp: vi.fn().mockResolvedValue({
        evidence: { statusCode: 200, redirectedToHttps: true, finalScheme: "https" },
        requestsCount: 1,
        bytesCount: 1,
      }),
      observeHeaders: vi.fn().mockResolvedValue({
        evidence: {
          finalScheme: "https",
          hsts: true,
          nosniff: true,
          frameProtection: true,
          referrerPolicy: true,
          csp: true,
          inspected: true,
          cookieCount: 1,
          insecureCookieCount: 1,
          catalogMatchCount: 1,
          consentPromptDetected: true,
          thirdPartyResourceReferences: 5,
          knownTrackingResourceReferences: 2,
          responseTimeMs: 700,
          responseBytes: 45000,
        },
        requestsCount: 1,
        bytesCount: 1,
      }),
    };

    const result = await new TransportV1NetworkExecutor(source).execute(
      { ...JOB, profileVersion: "domain-v2" },
      new AbortController().signal,
    );
    const cookieCheck = result.checks.find(({ controlId }) => controlId === "DS-PRIV-05");
    const trackingCheck = result.checks.find(({ controlId }) => controlId === "DS-PRIV-06");
    const performanceCheck = result.checks.find(({ controlId }) => controlId === "DS-QUAL-02");

    expect(result.scannerVersion).toBe("domain-v2-network-adapter-1");
    expect(result.checks).toHaveLength(8);
    expect(cookieCheck).toMatchObject({
      status: "fail",
      evidence: {
        inspected: true,
        catalogMatchCount: 1,
        consentPromptDetected: true,
      },
    });
    expect(trackingCheck).toMatchObject({
      status: "fail",
      evidence: { inspected: true, thirdPartyResourceReferences: 5, knownTrackingResourceReferences: 2 },
    });
    expect(performanceCheck).toMatchObject({
      status: "pass",
      evidence: { inspected: true, responseTimeMs: 700, responseBytes: 45000 },
    });
    expect(JSON.stringify(result)).not.toMatch(/cookie.?name|cookie.?value/iu);

    vi.mocked(source.observeHeaders).mockResolvedValue({
      evidence: { finalScheme: "https", hsts: true },
      requestsCount: 1,
      bytesCount: 1,
    });
    const incomplete = await new TransportV1NetworkExecutor(source).execute(
      { ...JOB, profileVersion: "domain-v2" },
      new AbortController().signal,
    );
    expect(incomplete.checks.find(({ controlId }) => controlId === "DS-PRIV-05"))
      .toMatchObject({ status: "unknown", evidence: {} });
    expect(incomplete.checks.find(({ controlId }) => controlId === "DS-PRIV-06"))
      .toMatchObject({ status: "unknown", evidence: { inspected: false } });
    expect(incomplete.checks.find(({ controlId }) => controlId === "DS-QUAL-02"))
      .toMatchObject({ status: "unknown", evidence: { inspected: false } });
  });

  it("preserves only a safe headers-probe error code across page-dependent checks", async () => {
    const source: TransportV1ObservationSource = {
      sourceKind: "network",
      observeDns: vi.fn().mockResolvedValue({
        evidence: { addressClass: "public", aRecordCount: 1, aaaaRecordCount: 0 },
        requestsCount: 0,
        bytesCount: 0,
      }),
      observeTls: vi.fn().mockResolvedValue({
        evidence: { protocol: "TLSv1.3", certificateValid: true, hostnameMatches: true },
        requestsCount: 1,
        bytesCount: 1,
      }),
      observeHttp: vi.fn().mockResolvedValue({
        evidence: { statusCode: 200, redirectedToHttps: true, finalScheme: "https" },
        requestsCount: 1,
        bytesCount: 1,
      }),
      observeHeaders: vi.fn().mockResolvedValue({
        evidence: {},
        requestsCount: 1,
        bytesCount: 11_263,
        errorCode: "request_timeout",
      }),
    };

    const result = await new TransportV1NetworkExecutor(source).execute(
      { ...JOB, profileVersion: "domain-v4" },
      new AbortController().signal,
    );

    for (const controlId of ["DS-HDR-01", "DS-PRIV-04", "DS-PRIV-05", "DS-PRIV-06", "DS-QUAL-02"]) {
      expect(result.checks.find((check) => check.controlId === controlId)).toMatchObject({
        status: "unknown",
        evidence: { probeErrorCode: "request_timeout" },
        summary: "El lector no pudo completar esta comprobación: se agotó el tiempo de espera.",
      });
    }
    expect(result.publicPolicyTransparencyAssessment).toMatchObject({
      status: "unknown",
      reasonCode: "auditor_error",
    });
  });

  it("limits a network executor to two concurrent probes", async () => {
    let active = 0;
    let maxActive = 0;
    const observe = async (evidence: Record<string, boolean | number | string>) => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      await new Promise((resolve) => setTimeout(resolve, 0));
      active -= 1;
      return { evidence, requestsCount: 1, bytesCount: 1 };
    };
    const source: TransportV1ObservationSource = {
      sourceKind: "network",
      observeDns: () => observe({ addressClass: "public", aRecordCount: 1, aaaaRecordCount: 0 }),
      observeTls: () => observe({ protocol: "TLSv1.3", certificateValid: true, hostnameMatches: true }),
      observeHttp: () => observe({ statusCode: 200, redirectedToHttps: true, finalScheme: "https" }),
      observeHeaders: () => observe({
        finalScheme: "https", hsts: true, nosniff: true, frameProtection: true,
        referrerPolicy: true, csp: true,
      }),
    };
    const executor = new TransportV1NetworkExecutor(source);

    const result = await executor.execute(JOB, new AbortController().signal);

    expect(maxActive).toBe(2);
    expect(result.metrics.requestsCount).toBe(5);
    expect(result.metrics.bytesCount).toBe(5);
  });

  it("fails the job instead of saving an all-empty network report", async () => {
    const failedProbe = {
      evidence: {},
      requestsCount: 0,
      bytesCount: 0,
      errorCode: "dns_resolution_failed" as const,
    };
    const source: TransportV1ObservationSource = {
      sourceKind: "network",
      observeDns: vi.fn().mockResolvedValue(failedProbe),
      observeTls: vi.fn().mockResolvedValue({
        ...failedProbe,
        errorCode: "tls_certificate_invalid",
      }),
      observeHttp: vi.fn().mockResolvedValue({
        ...failedProbe,
        errorCode: "connection_failed",
      }),
      observeHeaders: vi.fn().mockResolvedValue({
        ...failedProbe,
        errorCode: "connection_failed",
      }),
    };

    await expect(
      new TransportV1NetworkExecutor(source).execute(
        { ...JOB, profileVersion: "domain-v1" },
        new AbortController().signal,
      ),
    ).rejects.toMatchObject({
      message: "network_observation_unavailable",
      probeFailures: [
        { operation: "dns", code: "dns_resolution_failed" },
        { operation: "tls", code: "tls_certificate_invalid" },
        { operation: "http-head", code: "connection_failed" },
        { operation: "http-get", code: "connection_failed" },
        { operation: "headers", code: "connection_failed" },
      ],
    });
    expect(JSON.stringify(source)).not.toContain("secret");
  });

  it("preserves only allowlisted probe errors and redacts arbitrary exception text", async () => {
    const source: TransportV1ObservationSource = {
      sourceKind: "network",
      observeDns: vi.fn().mockRejectedValue(new Error("dns_resolution_failed")),
      observeTls: vi.fn().mockRejectedValue(new Error("certificate /private/path")),
      observeHttp: vi.fn().mockRejectedValue(new Error("connection_failed")),
      observeHeaders: vi.fn().mockRejectedValue(new Error("connection_failed")),
    };

    await expect(
      new TransportV1NetworkExecutor(source).execute(
        { ...JOB, profileVersion: "domain-v1" },
        new AbortController().signal,
      ),
    ).rejects.toMatchObject({
      message: "network_observation_unavailable",
      probeFailures: [
        { operation: "dns", code: "broker_failed" },
        { operation: "tls", code: "broker_failed" },
        { operation: "http-head", code: "broker_failed" },
        { operation: "http-get", code: "broker_failed" },
        { operation: "headers", code: "broker_failed" },
      ],
    });
    expect(JSON.stringify(source)).not.toContain("/private/path");
  });
});
