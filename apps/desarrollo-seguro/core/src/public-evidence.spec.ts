import { describe, expect, it } from "vitest";
import { projectPublicEvidence } from "./public-evidence.js";

describe("projectPublicEvidence", () => {
  it("returns only primitive evidence allowlisted for a control", () => {
    expect(projectPublicEvidence("DS-HDR-01", {
      finalScheme: "https",
      hsts: true,
      responseBody: "private page content",
      rawCookie: "session=secret",
    })).toEqual({ finalScheme: "https", hsts: true });
  });

  it("rejects malformed values and unrelated control fields", () => {
    expect(projectPublicEvidence("DS-HTTP-01", {
      statusCode: 200,
      redirectedToHttps: true,
      finalScheme: "javascript:alert(1)",
      cookieCount: 10,
      responseBytes: 100,
    })).toEqual({ statusCode: 200, redirectedToHttps: true });
  });

  it("projects only the authorized Grumphya redirect identity fields", () => {
    expect(projectPublicEvidence("DS-HTTP-01", {
      statusCode: 301,
      requestedHostname: "www.grumphya.com",
      finalHostname: "grumphya.com",
      canonicalHostname: "grumphya.com",
      redirectStatusCode: 301,
      redirectFromHostname: "www.grumphya.com",
      redirectToHostname: "grumphya.com",
      redirectLocation: "https://grumphya.com/private?token=secret",
    })).toEqual({
      statusCode: 301,
      requestedHostname: "www.grumphya.com",
      finalHostname: "grumphya.com",
      canonicalHostname: "grumphya.com",
      redirectStatusCode: 301,
      redirectFromHostname: "www.grumphya.com",
      redirectToHostname: "grumphya.com",
    });
  });

  it("projects only allowlisted TLS probe diagnostics", () => {
    expect(projectPublicEvidence("DS-TLS-02", {
      tls12ProbeError: "connection_failed",
      tls13ProbeError: "request_timeout",
      tls10ProbeError: "private socket details",
    })).toEqual({
      tls12ProbeError: "connection_failed",
      tls13ProbeError: "request_timeout",
    });
  });

  it("projects browser-observed cookie and request counts without cookie names or URLs", () => {
    expect(projectPublicEvidence("DS-PRIV-05", {
      browserObservationComplete: true,
      browserCookieCount: 2,
      browserInsecureCookieCount: 1,
      browserCatalogMatchCount: 1,
      cookieName: "_ga",
      cookieValue: "secret",
    })).toEqual({
      browserObservationComplete: true,
      browserCookieCount: 2,
      browserInsecureCookieCount: 1,
      browserCatalogMatchCount: 1,
    });
    expect(projectPublicEvidence("DS-PRIV-06", {
      browserObservationComplete: true,
      browserThirdPartyRequestCount: 3,
      browserKnownTrackingRequestCount: 2,
      browserBlockedTrackingRequestCount: 1,
      browserTrackingResponseCount: 1,
      requestUrl: "https://tracker.example/pixel?token=secret",
    })).toEqual({
      browserObservationComplete: true,
      browserThirdPartyRequestCount: 3,
      browserKnownTrackingRequestCount: 2,
      browserBlockedTrackingRequestCount: 1,
      browserTrackingResponseCount: 1,
    });
  });

  it("projects only bounded profile diagnostics for incomplete performance results", () => {
    expect(projectPublicEvidence("DS-QUAL-02", {
      desktopDiagnosticCode: "required_measurement_missing",
      desktopMissingMetricsMask: 68,
      mobileDiagnosticCode: "browser_timeout",
      mobileMissingMetricsMask: 255,
      desktopRuntimeError: "private stack trace",
    })).toEqual({
      desktopDiagnosticCode: "required_measurement_missing",
      desktopMissingMetricsMask: 68,
      mobileDiagnosticCode: "browser_timeout",
      mobileMissingMetricsMask: 255,
    });
  });
});
