import { describe, expect, it } from "vitest";
import { sanitizeScanObservations } from "./scan-ingestion-policy.js";

const ALLOWED_PATHS = ["/", "/precios", "/informe"];
const MONITORED_HOSTNAME = "example.com";
const NEXT_PROFILE_VERSION = "controls-v2";
const OBSERVED_AT = "2026-11-02T10:00:00.000Z";
const MAX_ACCEPTED_EVIDENCE_COUNT = 100_000;
const MAX_ACCEPTED_CHECK_COUNT = 32;

const SAFE_DNS_CHECK = {
  controlId: "DS-DNS-01",
  status: "unknown",
  required: true,
  severity: "high",
  observedAt: "2026-11-02T10:00:00.000Z",
  targetPath: "/",
  method: "DNS",
  summary: "texto externo que no debe persistir",
  limitation: "límite externo que no debe persistir",
  evidence: {
    addressClass: "public",
    aRecordCount: 1,
    aaaaRecordCount: 0,
    html: "<html>contenido privado</html>",
    cookie: "session=secreto",
  },
};

describe("sanitizeScanObservations", () => {
  it("accepts exact root-only transport-v1 coverage", () => {
    const result = sanitizeScanObservations(
      MONITORED_HOSTNAME,
      "transport-v1",
      ["/"],
      makeTransportV1Checks(),
    );

    expect(result.checks).toHaveLength(5);
    expect(result.checks.map(({ controlId, method }) => `${controlId}:${method}`))
      .toEqual([
        "DS-DNS-01:DNS",
        "DS-TLS-01:TLS",
        "DS-HTTP-01:HEAD",
        "DS-HTTP-01:GET",
        "DS-HDR-01:GET",
      ]);
    expect(result.checks.every((check) => check.status === "pass")).toBe(true);
  });

  it("preserves a bounded permanent Grumphya hostname redirect in public evidence", () => {
    const checks = makeTransportV1Checks().map((check) =>
      check.controlId === "DS-HTTP-01" && check.method === "GET"
        ? {
            ...check,
            evidence: {
              ...check.evidence,
              requestedHostname: "www.grumphya.com",
              finalHostname: "grumphya.com",
              redirectStatusCode: 301,
              redirectFromHostname: "www.grumphya.com",
              redirectToHostname: "grumphya.com",
              canonicalHostname: "grumphya.com",
            },
          }
        : check,
    );
    const result = sanitizeScanObservations("www.grumphya.com", "domain-v3", ["/"], [
      ...checks,
      makeUnknownCheck("DS-PRIV-05", "/", "GET"),
      makeUnknownCheck("DS-PRIV-06", "/", "GET"),
      makeUnknownCheck("DS-QUAL-02", "/", "GET"),
      makeUnknownCheck("DS-TLS-02", "/", "TLS"),
    ]);
    expect(result.checks.find((check) => check.controlId === "DS-HTTP-01" && check.method === "GET")?.evidence)
      .toMatchObject({
        requestedHostname: "www.grumphya.com",
        finalHostname: "grumphya.com",
        redirectStatusCode: 301,
        canonicalHostname: "grumphya.com",
      });
  });

  it("rejects a canonical hostname claim without permanent redirect evidence", () => {
    const checks = makeTransportV1Checks().map((check) =>
      check.controlId === "DS-HTTP-01" && check.method === "GET"
        ? {
            ...check,
            evidence: {
              ...check.evidence,
              requestedHostname: "www.grumphya.com",
              finalHostname: "grumphya.com",
              redirectStatusCode: 302,
              redirectFromHostname: "www.grumphya.com",
              redirectToHostname: "grumphya.com",
              canonicalHostname: "grumphya.com",
            },
          }
        : check,
    );
    expect(() => sanitizeScanObservations("www.grumphya.com", "transport-v1", ["/"], checks))
      .toThrow("scan_evidence_invalid");
  });

  it("rejects non-root scope and any unmeasured control in transport-v1", () => {
    expect(() =>
      sanitizeScanObservations(
        MONITORED_HOSTNAME,
        "transport-v1",
        ["/", "/precios"],
        makeTransportV1Checks(),
      ),
    ).toThrow("scan_scope_not_allowlisted");

    expect(() =>
      sanitizeScanObservations(
        MONITORED_HOSTNAME,
        "transport-v1",
        ["/"],
        [
          ...makeTransportV1Checks(),
          makeUnknownCheck("DS-PRIV-01", "/", "GET"),
        ],
      ),
    ).toThrow("scan_control_not_allowlisted");
  });

  it("keeps transport-v1 headers unknown unless evidence says HTTPS", () => {
    const checks = makeTransportV1Checks().map((check) =>
      check.controlId === "DS-HDR-01"
        ? {
            ...check,
            evidence: { ...check.evidence, finalScheme: "http" },
          }
        : check,
    );

    const result = sanitizeScanObservations(
      MONITORED_HOSTNAME,
      "transport-v1",
      ["/"],
      checks,
    );

    expect(
      result.checks.find((check) => check.controlId === "DS-HDR-01")?.status,
    ).toBe("unknown");
  });

  it("accepts domain-v1 with an explicit initial cookie observation and root-only scope", () => {
    const checks = [
      ...makeTransportV1Checks(),
      {
        ...makeUnknownCheck("DS-PRIV-05", "/", "GET"),
        status: "pass",
        evidence: {
          inspected: true,
          cookieCount: 1,
          insecureCookieCount: 0,
          catalogMatchCount: 0,
          consentPromptDetected: true,
        },
      },
    ];

    const result = sanitizeScanObservations(
      MONITORED_HOSTNAME,
      "domain-v1",
      ["/"],
      checks,
    );

    expect(result.scope).toEqual(["/"]);
    expect(result.checks).toHaveLength(6);
    expect(result.checks.find(({ controlId }) => controlId === "DS-PRIV-05"))
      .toMatchObject({
        status: "pass",
        evidence: { cookieCount: 1 },
        summary: "Cookies en respuesta inicial: 1; coincidencias con la tabla local Analytics/Marketing: 0; sin atributo Secure: 0. No se interactuó con el banner de consentimiento.",
      });
    expect(() =>
      sanitizeScanObservations(
        MONITORED_HOSTNAME,
        "domain-v1",
        ["/", "/precios"],
        checks,
      ),
    ).toThrow("scan_scope_not_allowlisted");
  });

  it("accepts domain-v2 with bounded tracker references and initial response metrics", () => {
    const checks = [
      ...makeTransportV1Checks(),
      {
        ...makeUnknownCheck("DS-PRIV-05", "/", "GET"),
        status: "pass",
        evidence: { inspected: true, cookieCount: 0, insecureCookieCount: 0, catalogMatchCount: 0, consentPromptDetected: false },
      },
      {
        ...makeUnknownCheck("DS-PRIV-06", "/", "GET"),
        status: "pass",
        evidence: { inspected: true, thirdPartyResourceReferences: 3, knownTrackingResourceReferences: 0 },
      },
      {
        ...makeUnknownCheck("DS-QUAL-02", "/", "GET"),
        status: "pass",
        evidence: { inspected: true, responseTimeMs: 900, responseBytes: 45_000 },
      },
    ];

    const result = sanitizeScanObservations(MONITORED_HOSTNAME, "domain-v2", ["/"], checks);

    expect(result.checks).toHaveLength(8);
    expect(result.checks.find(({ controlId }) => controlId === "DS-PRIV-06")?.status).toBe("pass");
    expect(result.checks.find(({ controlId }) => controlId === "DS-QUAL-02")?.status).toBe("pass");

    const slowChecks = checks.map((check) => check.controlId === "DS-QUAL-02"
      ? { ...check, evidence: { inspected: true, responseTimeMs: 2_501, responseBytes: 45_000 } }
      : check);
    const slowResult = sanitizeScanObservations(MONITORED_HOSTNAME, "domain-v2", ["/"], slowChecks);
    expect(slowResult.checks.find(({ controlId }) => controlId === "DS-QUAL-02")?.status).toBe("fail");
  });

  it("accepts domain-v3 with an independently measured TLS version matrix", () => {
    const checks = [
      ...makeTransportV1Checks(),
      {
        ...makeUnknownCheck("DS-TLS-02", "/", "TLS"),
        status: "pass",
        evidence: {
          tls10Accepted: false,
          tls11Accepted: false,
          tls12Accepted: true,
          tls13Accepted: true,
        },
      },
      {
        ...makeUnknownCheck("DS-PRIV-05", "/", "GET"),
        status: "pass",
        evidence: { inspected: true, cookieCount: 0, insecureCookieCount: 0, catalogMatchCount: 0, consentPromptDetected: false },
      },
      {
        ...makeUnknownCheck("DS-PRIV-06", "/", "GET"),
        status: "pass",
        evidence: { inspected: true, thirdPartyResourceReferences: 0, knownTrackingResourceReferences: 0 },
      },
      {
        ...makeUnknownCheck("DS-QUAL-02", "/", "GET"),
        status: "pass",
        evidence: { inspected: true, responseTimeMs: 900, responseBytes: 45_000 },
      },
    ];

    const result = sanitizeScanObservations(MONITORED_HOSTNAME, "domain-v3", ["/"], checks);

    expect(result.checks).toHaveLength(9);
    expect(result.checks.find(({ controlId }) => controlId === "DS-TLS-02"))
      .toMatchObject({ status: "pass", evidence: { tls10Accepted: false, tls11Accepted: false, tls12Accepted: true, tls13Accepted: true } });

    const weakTlsChecks = checks.map((check) => check.controlId === "DS-TLS-02"
      ? { ...check, status: "fail", evidence: { tls10Accepted: true, tls11Accepted: false, tls12Accepted: true, tls13Accepted: true } }
      : check);
    const weakTlsResult = sanitizeScanObservations(MONITORED_HOSTNAME, "domain-v3", ["/"], weakTlsChecks);
    expect(weakTlsResult.checks.find(({ controlId }) => controlId === "DS-TLS-02")?.status).toBe("fail");
  });

  it("scores public-policy transparency as fail only with observed missing information and keeps auditor failures unknown", () => {
    const existingChecks = [
      ...makeTransportV1Checks(),
      {
        ...makeUnknownCheck("DS-TLS-02", "/", "TLS"),
        status: "pass",
        evidence: {
          tls10Accepted: false,
          tls11Accepted: false,
          tls12Accepted: true,
          tls13Accepted: true,
        },
      },
      {
        ...makeUnknownCheck("DS-PRIV-05", "/", "GET"),
        status: "pass",
        evidence: { inspected: true, cookieCount: 0, insecureCookieCount: 0, catalogMatchCount: 0, consentPromptDetected: false },
      },
      {
        ...makeUnknownCheck("DS-PRIV-06", "/", "GET"),
        status: "pass",
        evidence: { inspected: true, thirdPartyResourceReferences: 0, knownTrackingResourceReferences: 0 },
      },
      {
        ...makeUnknownCheck("DS-QUAL-02", "/", "GET"),
        status: "pass",
        evidence: { inspected: true, responseTimeMs: 900, responseBytes: 45_000 },
      },
    ];
    const policyEvidence = {
      inspected: true,
      privacyPolicyLinksFound: 1,
      policyLinksFound: 1,
      sitePrivacyPolicyFetched: true,
      policyPagesFetched: 1,
      policyPagesMissing: 0,
      policyPagesDenied: 0,
      policyRecipientsMentioned: true,
      policyPurposesMentioned: true,
      policyTextBlocked: false,
      policyProbeFailed: false,
      policyLanguageCatalogVersion: "public-policy-language-eea-v1",
    };
    const accepted = sanitizeScanObservations(MONITORED_HOSTNAME, "domain-v4", ["/"], [
      ...existingChecks,
      { ...makeUnknownCheck("DS-PRIV-04", "/", "GET"), status: "pass", evidence: policyEvidence },
    ]);
    expect(accepted.checks).toHaveLength(10);
    expect(accepted.checks.find(({ controlId }) => controlId === "DS-PRIV-04")?.status).toBe("pass");

    const missingPolicy = sanitizeScanObservations(MONITORED_HOSTNAME, "domain-v4", ["/"], [
      ...existingChecks,
      {
        ...makeUnknownCheck("DS-PRIV-04", "/", "GET"),
        status: "fail",
        evidence: { ...policyEvidence, privacyPolicyLinksFound: 0, policyLinksFound: 0, sitePrivacyPolicyFetched: false },
      },
    ]);
    expect(missingPolicy.checks.find(({ controlId }) => controlId === "DS-PRIV-04")?.status).toBe("fail");

    const auditorError = sanitizeScanObservations(MONITORED_HOSTNAME, "domain-v4", ["/"], [
      ...existingChecks,
      {
        ...makeUnknownCheck("DS-PRIV-04", "/", "GET"),
        evidence: {
          ...policyEvidence,
          inspected: false,
          policyProbeFailed: true,
          probeErrorCode: "request_timeout",
        },
      },
    ]);
    expect(auditorError.checks.find(({ controlId }) => controlId === "DS-PRIV-04"))
      .toMatchObject({
        status: "unknown",
        evidence: { probeErrorCode: "request_timeout" },
        summary: "El lector no pudo completar esta comprobación: se agotó el tiempo de espera.",
      });
  });

  it("retains safe TLS probe failure categories to explain incomplete results", () => {
    const checks = [
      ...makeTransportV1Checks(),
      {
        ...makeUnknownCheck("DS-TLS-02", "/", "TLS"),
        evidence: { tls12ProbeError: "connection_failed", tls13ProbeError: "request_timeout" },
      },
      {
        ...makeUnknownCheck("DS-PRIV-05", "/", "GET"),
        status: "pass",
        evidence: { inspected: true, cookieCount: 0, insecureCookieCount: 0, catalogMatchCount: 0, consentPromptDetected: false },
      },
      {
        ...makeUnknownCheck("DS-PRIV-06", "/", "GET"),
        status: "pass",
        evidence: { inspected: true, thirdPartyResourceReferences: 0, knownTrackingResourceReferences: 0 },
      },
      {
        ...makeUnknownCheck("DS-QUAL-02", "/", "GET"),
        status: "pass",
        evidence: { inspected: true, responseTimeMs: 900, responseBytes: 45_000 },
      },
    ];

    const result = sanitizeScanObservations(MONITORED_HOSTNAME, "domain-v3", ["/"], checks);
    const tlsCheck = result.checks.find(({ controlId }) => controlId === "DS-TLS-02");

    expect(tlsCheck).toMatchObject({
      status: "unknown",
      evidence: { tls12ProbeError: "connection_failed", tls13ProbeError: "request_timeout" },
      summary: "No se pudieron completar todas las pruebas de TLS. TLS 1.2: no se pudo completar la conexión. TLS 1.3: se agotó el tiempo de espera.",
    });
  });

  it("does not persist collector error details as public evidence", () => {
    const checks = makeTransportV1Checks().map((check) =>
      check.controlId === "DS-DNS-01"
        ? {
            ...check,
            status: "pass",
            evidence: {
              probeErrorCode: "dns_resolution_failed",
              privateDetail: "user supplied sensitive error text",
            },
          }
        : check,
    );

    const result = sanitizeScanObservations(
      MONITORED_HOSTNAME,
      "transport-v1",
      ["/"],
      checks,
    );
    const dnsCheck = result.checks.find(({ controlId }) => controlId === "DS-DNS-01");

    expect(dnsCheck).toMatchObject({
      status: "unknown",
      evidence: {},
      summary: "Comprobación DS-DNS-01: unknown.",
    });
    expect(JSON.stringify(result)).not.toContain("user supplied sensitive error text");
  });

  it("requires complete control, route, and method coverage for controls-v2", () => {
    const checks = makeControlsV2Checks(["/", "/precios"]).filter(
      (check) =>
        !(
          check.controlId === "DS-HTTP-01" &&
          check.targetPath === "/precios" &&
          check.method === "HEAD"
        ),
    );

    expect(() =>
      sanitizeScanObservations(
        MONITORED_HOSTNAME,
        NEXT_PROFILE_VERSION,
        ["/", "/precios"],
        checks,
      ),
    ).toThrow("scan_check_coverage_incomplete");
  });

  it("accepts complete controls-v2 coverage for all declared routes", () => {
    const result = sanitizeScanObservations(
      MONITORED_HOSTNAME,
      NEXT_PROFILE_VERSION,
      ALLOWED_PATHS,
      makeControlsV2Checks(ALLOWED_PATHS),
    );

    expect(result.checks).toHaveLength(24);
    expect(
      result.checks.filter((check) => check.controlId === "DS-HTTP-01"),
    ).toHaveLength(6);
  });

  it.each([
    { scope: ["/"], expectedCount: 10 },
    { scope: ["/", "/precios"], expectedCount: 17 },
    { scope: ALLOWED_PATHS, expectedCount: 24 },
  ])(
    "requires the exact v2 check count for scope $scope",
    ({ scope, expectedCount }) => {
      const result = sanitizeScanObservations(
        MONITORED_HOSTNAME,
        NEXT_PROFILE_VERSION,
        scope,
        makeControlsV2Checks(scope),
      );

      expect(result.checks).toHaveLength(expectedCount);
    },
  );

  it("accepts controls-v3 complete route coverage with HTTPS header evidence", () => {
    const result = sanitizeScanObservations(
      MONITORED_HOSTNAME,
      "controls-v3",
      ALLOWED_PATHS,
      makeControlsV3Checks(ALLOWED_PATHS),
    );

    expect(result.checks).toHaveLength(24);
    expect(
      result.checks
        .filter((check) => check.controlId === "DS-HDR-01")
        .every((check) => check.evidence.finalScheme === "https"),
    ).toBe(true);
  });

  it("does not add controls-v3 HTTPS evidence to earlier profiles", () => {
    const checks = makeControlsV2Checks(["/"]).map((check) => {
      if (check.controlId !== "DS-HDR-01") return check;
      return {
        ...check,
        status: "pass",
        evidence: {
          finalScheme: "https",
          hsts: true,
          nosniff: true,
          frameProtection: true,
          referrerPolicy: true,
          csp: true,
        },
      };
    });

    const result = sanitizeScanObservations(
      MONITORED_HOSTNAME,
      NEXT_PROFILE_VERSION,
      ["/"],
      checks,
    );
    const headerCheck = result.checks.find(
      (check) => check.controlId === "DS-HDR-01",
    );

    expect(headerCheck?.status).toBe("pass");
    expect(headerCheck?.evidence).toEqual({
      hsts: true,
      nosniff: true,
      frameProtection: true,
      referrerPolicy: true,
      csp: true,
    });
  });

  it.each([
    { profileVersion: "controls-v3", finalScheme: "https", expectedStatus: "pass" },
    { profileVersion: "controls-v3", finalScheme: "http", expectedStatus: "unknown" },
    { profileVersion: "controls-v3", finalScheme: undefined, expectedStatus: "unknown" },
    { profileVersion: "domain-v4", finalScheme: "https", expectedStatus: "pass" },
    { profileVersion: "domain-v4", finalScheme: "http", expectedStatus: "unknown" },
    { profileVersion: "domain-v4", finalScheme: undefined, expectedStatus: "unknown" },
  ] as const)(
    "only accepts a $profileVersion header pass for HTTPS responses ($finalScheme)",
    ({ profileVersion, finalScheme, expectedStatus }) => {
      const sourceChecks = profileVersion === "controls-v3"
        ? makeControlsV3Checks(["/"])
        : makeDomainV4Checks();
      const checks = sourceChecks.map((check) => {
        if (check.controlId !== "DS-HDR-01") return check;
        return {
          ...check,
          status: "pass",
          evidence: {
            ...(finalScheme ? { finalScheme } : {}),
            hsts: true,
            nosniff: true,
            frameProtection: true,
            referrerPolicy: true,
            csp: true,
          },
        };
      });
      const result = sanitizeScanObservations(
        MONITORED_HOSTNAME,
        profileVersion,
        ["/"],
        checks,
      );

      const headerCheck = result.checks.find((check) => check.controlId === "DS-HDR-01");
      expect(headerCheck?.status).toBe(expectedStatus);
      expect(headerCheck?.evidence.finalScheme).toBe(finalScheme);
    },
  );

  it.each([
    { profileVersion: "controls-v2", statusCode: 405 },
    { profileVersion: "controls-v2", statusCode: 501 },
    { profileVersion: "controls-v3", statusCode: 405 },
    { profileVersion: "controls-v3", statusCode: 501 },
    { profileVersion: "domain-v4", statusCode: 405 },
    { profileVersion: "domain-v4", statusCode: 501 },
  ])(
    "treats unsupported HEAD status $statusCode as unknown in $profileVersion",
    ({ profileVersion, statusCode }) => {
      const makeChecks = profileVersion === "domain-v4"
        ? () => makeDomainV4Checks()
        : profileVersion === "controls-v3"
          ? makeControlsV3Checks
          : makeControlsV2Checks;
      const checks = makeChecks(["/"]).map((check) => {
        if (check.controlId !== "DS-HTTP-01" || check.method !== "HEAD") {
          return check;
        }
        return {
          ...check,
          status: "pass",
          evidence: {
            statusCode,
            redirectedToHttps: true,
            finalScheme: "https",
          },
        };
      });
      const result = sanitizeScanObservations(
        MONITORED_HOSTNAME,
        profileVersion,
        ["/"],
        checks,
      );

      const headCheck = result.checks.find(
        (check) => check.controlId === "DS-HTTP-01" && check.method === "HEAD",
      );
      expect(headCheck?.status).toBe("unknown");
    },
  );

  it("keeps only allowlisted scope and structured evidence, replacing free text", () => {
    const result = sanitizeScanObservations(
      MONITORED_HOSTNAME,
      "controls-v1",
      ALLOWED_PATHS,
      [SAFE_DNS_CHECK],
    );

    expect(result.scope).toEqual(ALLOWED_PATHS);
    expect(result.checks[0]).toMatchObject({
      controlId: "DS-DNS-01",
      status: "unknown",
      required: true,
      severity: "high",
      targetPath: "/",
      method: "DNS",
      summary: expect.not.stringContaining("texto externo"),
      limitation: expect.not.stringContaining("límite externo"),
      evidence: {
        addressClass: "public",
        aRecordCount: 1,
        aaaaRecordCount: 0,
      },
    });
    expect(JSON.stringify(result)).not.toContain("contenido privado");
    expect(JSON.stringify(result)).not.toContain("session=secreto");
  });

  it.each([
    ["/precios?token=secret"],
    ["//evil.example/"],
    ["/../admin"],
    ["https://example.com/"],
  ])("rejects scope outside the exact profile allowlist: %s", (scope) => {
    expect(() =>
      sanitizeScanObservations(MONITORED_HOSTNAME, "controls-v1", scope, [
        SAFE_DNS_CHECK,
      ]),
    ).toThrow("scan_scope_not_allowlisted");
  });

  it.each([
    { targetPath: "/precios?key=x", method: "GET" },
    { targetPath: "/", method: "POST" },
    { targetPath: "https://example.com/", method: "GET" },
    { targetPath: "/admin", method: "GET" },
  ])("rejects a check path or method outside its contract: %s", (change) => {
    expect(() =>
      sanitizeScanObservations(
        MONITORED_HOSTNAME,
        "controls-v1",
        ALLOWED_PATHS,
        [{ ...SAFE_DNS_CHECK, ...change }],
      ),
    ).toThrow("scan_check_scope_not_allowlisted");
  });

  it.each([
    ["DS-DNS-01", "DNS"],
    ["DS-TLS-01", "TLS"],
    ["DS-TLS-02", "TLS"],
    ["DS-HTTP-01", "HEAD"],
    ["DS-HTTP-01", "GET"],
    ["DS-HDR-01", "GET"],
    ["DS-PRIV-01", "GET"],
    ["DS-PRIV-02", "GET"],
    ["DS-PRIV-03", "GET"],
    ["DS-QUAL-01", "GET"],
  ])("accepts the registered method %s/%s", (controlId, method) => {
    expect(() =>
      sanitizeScanObservations(
        MONITORED_HOSTNAME,
        "controls-v1",
        ["/"],
        [{ ...SAFE_DNS_CHECK, controlId, method }],
      ),
    ).not.toThrow();
  });

  it("rejects unknown profiles and controls without logging their contents", () => {
    expect(() =>
      sanitizeScanObservations(
        MONITORED_HOSTNAME,
        "controls-v4",
        ALLOWED_PATHS,
        [SAFE_DNS_CHECK],
      ),
    ).toThrow("scan_profile_not_allowlisted");
    expect(() =>
      sanitizeScanObservations(
        MONITORED_HOSTNAME,
        "controls-v1",
        ALLOWED_PATHS,
        [{ ...SAFE_DNS_CHECK, controlId: "DS-UNKNOWN-99" }],
      ),
    ).toThrow("scan_control_not_allowlisted");
  });

  it("rejects malformed evidence rather than persisting raw values", () => {
    expect(() =>
      sanitizeScanObservations(
        MONITORED_HOSTNAME,
        "controls-v1",
        ALLOWED_PATHS,
        [
          {
            ...SAFE_DNS_CHECK,
            evidence: { addressClass: "<script>alert(1)</script>" },
          },
        ],
      ),
    ).toThrow("scan_evidence_invalid");
  });

  it("drops expiresAt because it is outside the current TLS evidence contract", () => {
    const result = sanitizeScanObservations(
      MONITORED_HOSTNAME,
      "controls-v1",
      ["/"],
      [
        {
          ...SAFE_DNS_CHECK,
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
    );

    expect(result.checks[0].evidence).toEqual({
      protocol: "TLSv1.3",
      certificateValid: true,
      hostnameMatches: true,
    });
  });

  it.each([
    ["DS-DNS-01", "DNS"],
    ["DS-TLS-01", "TLS"],
    ["DS-TLS-02", "TLS"],
    ["DS-HTTP-01", "GET"],
    ["DS-HDR-01", "GET"],
    ["DS-PRIV-01", "GET"],
    ["DS-PRIV-02", "GET"],
    ["DS-PRIV-03", "GET"],
    ["DS-QUAL-01", "GET"],
  ])(
    "converts pass with empty evidence for %s to unknown",
    (controlId, method) => {
      const result = sanitizeScanObservations(
        MONITORED_HOSTNAME,
        "controls-v1",
        ["/"],
        [
          {
            ...SAFE_DNS_CHECK,
            controlId,
            method,
            status: "pass",
            evidence: {},
          },
        ],
      );

      expect(result.checks[0].status).toBe("unknown");
    },
  );

  it.each([
    ["DS-DNS-01", "DNS", { addressClass: "private" }],
    ["DS-DNS-01", "DNS", { addressClass: "reserved" }],
  ])(
    "rejects pass evidence that reports a prohibited DNS class",
    (controlId, method, evidence) => {
      expect(() =>
        sanitizeScanObservations(
          MONITORED_HOSTNAME,
          "controls-v1",
          ["/"],
          [{ ...SAFE_DNS_CHECK, controlId, method, status: "pass", evidence }],
        ),
      ).toThrow();
    },
  );

  it.each([
    [
      "DS-TLS-01",
      "TLS",
      { protocol: "TLSv1.3", certificateValid: false, hostnameMatches: true },
    ],
    [
      "DS-TLS-01",
      "TLS",
      { protocol: "TLSv1.3", certificateValid: true, hostnameMatches: false },
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
      { statusCode: 200, redirectedToHttps: false, finalScheme: "https" },
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
    [
      "DS-PRIV-02",
      "GET",
      {
        cookieCount: 1,
        insecureCookieCount: 0,
        thirdPartyCookieCount: 1,
        inspected: true,
      },
    ],
    ["DS-PRIV-03", "GET", { mixedContentCount: 1, insecureNavigationCount: 0 }],
    ["DS-PRIV-03", "GET", { mixedContentCount: 0, insecureNavigationCount: 1 }],
    [
      "DS-QUAL-01",
      "GET",
      { documentStatusCode: 500, failedEssentialResourceCount: 0 },
    ],
    [
      "DS-QUAL-01",
      "GET",
      { documentStatusCode: 200, failedEssentialResourceCount: 1 },
    ],
  ])(
    "does not preserve pass when %s evidence contradicts it",
    (controlId, method, evidence) => {
      const result = sanitizeScanObservations(
        MONITORED_HOSTNAME,
        "controls-v1",
        ["/"],
        [{ ...SAFE_DNS_CHECK, controlId, method, status: "pass", evidence }],
      );

      expect(result.checks[0].status).toBe("fail");
    },
  );

  it.each([
    [
      "DS-DNS-01",
      "DNS",
      { addressClass: "public", aRecordCount: 1, aaaaRecordCount: 0 },
    ],
    [
      "DS-TLS-01",
      "TLS",
      { protocol: "TLSv1.3", certificateValid: true, hostnameMatches: true },
    ],
    [
      "DS-TLS-02",
      "TLS",
      {
        tls10Accepted: false,
        tls11Accepted: false,
        tls12Accepted: true,
        tls13Accepted: true,
      },
    ],
    [
      "DS-HTTP-01",
      "GET",
      { statusCode: 200, redirectedToHttps: true, finalScheme: "https" },
    ],
    [
      "DS-HDR-01",
      "GET",
      {
        hsts: true,
        nosniff: true,
        frameProtection: true,
        referrerPolicy: true,
        csp: true,
      },
    ],
    ["DS-PRIV-01", "GET", { thirdPartyAttempts: 0, blockedRequests: 0 }],
    [
      "DS-PRIV-02",
      "GET",
      {
        cookieCount: 0,
        insecureCookieCount: 0,
        thirdPartyCookieCount: 0,
        inspected: true,
      },
    ],
    ["DS-PRIV-03", "GET", { mixedContentCount: 0, insecureNavigationCount: 0 }],
    [
      "DS-QUAL-01",
      "GET",
      { documentStatusCode: 200, failedEssentialResourceCount: 0 },
    ],
  ])(
    "preserves pass only with complete, non-failing %s evidence",
    (controlId, method, evidence) => {
      const result = sanitizeScanObservations(
        MONITORED_HOSTNAME,
        "controls-v1",
        ["/"],
        [{ ...SAFE_DNS_CHECK, controlId, method, status: "pass", evidence }],
      );

      expect(result.checks[0].status).toBe("pass");
    },
  );

  it("converts not-applicable to unknown because controls-v1 has no justification contract", () => {
    const result = sanitizeScanObservations(
      MONITORED_HOSTNAME,
      "controls-v1",
      ["/"],
      [
        {
          ...SAFE_DNS_CHECK,
          status: "not_applicable",
          evidence: { addressClass: "public" },
        },
      ],
    );

    expect(result.checks[0].status).toBe("unknown");
  });

  it.each([100, 200, 599])("accepts HTTP status code %s", (statusCode) => {
    expect(() =>
      sanitizeScanObservations(
        MONITORED_HOSTNAME,
        "controls-v1",
        ["/"],
        [
          {
            ...SAFE_DNS_CHECK,
            controlId: "DS-HTTP-01",
            method: "GET",
            evidence: { statusCode },
          },
        ],
      ),
    ).not.toThrow();
  });

  it.each([99, 600, 200.5])(
    "rejects invalid HTTP status code %s",
    (statusCode) => {
      expect(() =>
        sanitizeScanObservations(
          MONITORED_HOSTNAME,
          "controls-v1",
          ["/"],
          [
            {
              ...SAFE_DNS_CHECK,
              controlId: "DS-HTTP-01",
              method: "GET",
              evidence: { statusCode },
            },
          ],
        ),
      ).toThrow("scan_evidence_invalid");
    },
  );

  it.each([-1, 1.5, Number.MAX_SAFE_INTEGER + 1])(
    "rejects unsafe DNS evidence counts: %s",
    (aRecordCount) => {
      expect(() =>
        sanitizeScanObservations(
          MONITORED_HOSTNAME,
          "controls-v1",
          ["/"],
          [
            {
              ...SAFE_DNS_CHECK,
              evidence: { aRecordCount },
            },
          ],
        ),
      ).toThrow("scan_evidence_invalid");
    },
  );

  it("rejects missing checks, duplicate paths and malformed observations", () => {
    expect(() =>
      sanitizeScanObservations(
        MONITORED_HOSTNAME,
        "controls-v1",
        ALLOWED_PATHS,
        [],
      ),
    ).toThrow("scan_checks_required");
    expect(() =>
      sanitizeScanObservations(
        MONITORED_HOSTNAME,
        "controls-v1",
        ["/", "/"],
        [SAFE_DNS_CHECK],
      ),
    ).toThrow("scan_scope_not_allowlisted");
    expect(() =>
      sanitizeScanObservations(
        MONITORED_HOSTNAME,
        "controls-v1",
        ALLOWED_PATHS,
        [null],
      ),
    ).toThrow("scan_check_invalid");
  });

  it("rejects duplicate checks for the same control, route, and method", () => {
    expect(() =>
      sanitizeScanObservations(
        MONITORED_HOSTNAME,
        "controls-v1",
        ["/"],
        [SAFE_DNS_CHECK, SAFE_DNS_CHECK],
      ),
    ).toThrow("scan_check_duplicate");
  });

  it("bounds the number of checks before processing their contents", () => {
    expect(() =>
      sanitizeScanObservations(
        MONITORED_HOSTNAME,
        "controls-v1",
        ["/"],
        Array.from({ length: MAX_ACCEPTED_CHECK_COUNT + 1 }, () => null),
      ),
    ).toThrow("scan_checks_required");
  });

  it("accepts evidence counts at the documented upper bound and rejects larger values", () => {
    const checkAtLimit = {
      ...SAFE_DNS_CHECK,
      evidence: {
        addressClass: "public",
        aRecordCount: MAX_ACCEPTED_EVIDENCE_COUNT,
        aaaaRecordCount: 0,
      },
    };
    const checkOverLimit = {
      ...checkAtLimit,
      evidence: {
        ...checkAtLimit.evidence,
        aRecordCount: MAX_ACCEPTED_EVIDENCE_COUNT + 1,
      },
    };

    expect(
      sanitizeScanObservations(
        MONITORED_HOSTNAME,
        "controls-v1",
        ["/"],
        [checkAtLimit],
      ).checks[0]?.evidence.aRecordCount,
    ).toBe(MAX_ACCEPTED_EVIDENCE_COUNT);
    expect(() =>
      sanitizeScanObservations(
        MONITORED_HOSTNAME,
        "controls-v1",
        ["/"],
        [checkOverLimit],
      ),
    ).toThrow("scan_evidence_invalid");
  });

  it("rejects invalid observation dates instead of persisting an invalid Date", () => {
    expect(() =>
      sanitizeScanObservations(
        MONITORED_HOSTNAME,
        "controls-v1",
        ["/"],
        [{ ...SAFE_DNS_CHECK, observedAt: new Date(Number.NaN) }],
      ),
    ).toThrow("scan_check_invalid");
  });

  it("uses the same reviewed route allowlist for every hostname", () => {
    const result = sanitizeScanObservations(
      "other.example.net",
      NEXT_PROFILE_VERSION,
      ALLOWED_PATHS,
      makeControlsV2Checks(ALLOWED_PATHS),
    );

    expect(result.scope).toEqual(ALLOWED_PATHS);
  });
});

function makeControlsV2Checks(scope: readonly string[]) {
  const hostChecks = [
    { controlId: "DS-DNS-01", method: "DNS" },
    { controlId: "DS-TLS-01", method: "TLS" },
    { controlId: "DS-TLS-02", method: "TLS" },
  ];
  const routeChecks = [
    { controlId: "DS-HTTP-01", methods: ["HEAD", "GET"] },
    { controlId: "DS-HDR-01", methods: ["GET"] },
    { controlId: "DS-PRIV-01", methods: ["GET"] },
    { controlId: "DS-PRIV-02", methods: ["GET"] },
    { controlId: "DS-PRIV-03", methods: ["GET"] },
    { controlId: "DS-QUAL-01", methods: ["GET"] },
  ];

  return [
    ...hostChecks.map((check) =>
      makeUnknownCheck(check.controlId, "/", check.method),
    ),
    ...scope.flatMap((targetPath) =>
      routeChecks.flatMap(({ controlId, methods }) =>
        methods.map((method) =>
          makeUnknownCheck(controlId, targetPath, method),
        ),
      ),
    ),
  ];
}

function makeControlsV3Checks(scope: readonly string[]) {
  return makeControlsV2Checks(scope).map((check) => {
    if (check.controlId !== "DS-HDR-01") return check;
    return { ...check, evidence: { finalScheme: "https" } };
  });
}

function makeDomainV4Checks() {
  const policyEvidence = {
    inspected: true,
    privacyPolicyLinksFound: 1,
    policyLinksFound: 1,
    sitePrivacyPolicyFetched: true,
    policyPagesFetched: 1,
    policyPagesMissing: 0,
    policyPagesDenied: 0,
    policyRecipientsMentioned: true,
    policyPurposesMentioned: true,
    policyTextBlocked: false,
    policyProbeFailed: false,
    policyLanguageCatalogVersion: "public-policy-language-eea-v1",
  };
  return [
    ...makeTransportV1Checks(),
    {
      ...makeUnknownCheck("DS-TLS-02", "/", "TLS"),
      status: "pass",
      evidence: {
        tls10Accepted: false,
        tls11Accepted: false,
        tls12Accepted: true,
        tls13Accepted: true,
      },
    },
    {
      ...makeUnknownCheck("DS-PRIV-05", "/", "GET"),
      status: "pass",
      evidence: {
        inspected: true,
        cookieCount: 0,
        insecureCookieCount: 0,
        catalogMatchCount: 0,
        consentPromptDetected: false,
      },
    },
    {
      ...makeUnknownCheck("DS-PRIV-06", "/", "GET"),
      status: "pass",
      evidence: {
        inspected: true,
        thirdPartyResourceReferences: 0,
        knownTrackingResourceReferences: 0,
      },
    },
    {
      ...makeUnknownCheck("DS-QUAL-02", "/", "GET"),
      status: "pass",
      evidence: { inspected: true, responseTimeMs: 900, responseBytes: 45_000 },
    },
    {
      ...makeUnknownCheck("DS-PRIV-04", "/", "GET"),
      status: "pass",
      evidence: policyEvidence,
    },
  ];
}

function makeTransportV1Checks() {
  const fixtureChecks = [
    {
      controlId: "DS-DNS-01",
      method: "DNS",
      evidence: { addressClass: "public", aRecordCount: 1, aaaaRecordCount: 0 },
    },
    {
      controlId: "DS-TLS-01",
      method: "TLS",
      evidence: {
        protocol: "TLSv1.3",
        certificateValid: true,
        hostnameMatches: true,
      },
    },
    {
      controlId: "DS-HTTP-01",
      method: "HEAD",
      evidence: {
        statusCode: 200,
        redirectedToHttps: true,
        finalScheme: "https",
      },
    },
    {
      controlId: "DS-HTTP-01",
      method: "GET",
      evidence: {
        statusCode: 200,
        redirectedToHttps: true,
        finalScheme: "https",
      },
    },
    {
      controlId: "DS-HDR-01",
      method: "GET",
      evidence: {
        finalScheme: "https",
        hsts: true,
        nosniff: true,
        frameProtection: true,
        referrerPolicy: true,
        csp: true,
      },
    },
  ];

  return fixtureChecks.map((check) => ({
    ...makeUnknownCheck(check.controlId, "/", check.method),
    status: "pass",
    evidence: check.evidence,
  }));
}

function makeUnknownCheck(
  controlId: string,
  targetPath: string,
  method: string,
) {
  return {
    controlId,
    status: "unknown",
    required: true,
    severity: "high",
    observedAt: OBSERVED_AT,
    targetPath,
    method,
    summary: "ignored summary",
    limitation: "ignored limitation",
    evidence: {},
  };
}
