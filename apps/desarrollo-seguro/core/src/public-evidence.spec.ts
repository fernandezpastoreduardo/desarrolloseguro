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

  it("projects safe redirect identity fields for a synthetic hostname", () => {
    expect(projectPublicEvidence("DS-HTTP-01", {
      statusCode: 301,
      requestedHostname: "www.example.net",
      finalHostname: "example.net",
      canonicalHostname: "example.net",
      redirectStatusCode: 301,
      redirectFromHostname: "www.example.net",
      redirectToHostname: "example.net",
      redirectLocation: "https://example.net/private?token=secret",
    })).toEqual({
      statusCode: 301,
      requestedHostname: "www.example.net",
      finalHostname: "example.net",
      canonicalHostname: "example.net",
      redirectStatusCode: 301,
      redirectFromHostname: "www.example.net",
      redirectToHostname: "example.net",
    });
  });

  it("omits malformed hostname values from public transport evidence", () => {
    expect(projectPublicEvidence("DS-HTTP-01", {
      requestedHostname: "example.net:443",
      finalHostname: "not a hostname",
      canonicalHostname: "example..net",
    })).toEqual({});
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

  it("preserves mobile and desktop transfer sizes through the accepted 64 MiB bound", () => {
    const mobileTransferBytes = 2_000_000;
    const desktopTransferBytes = 1_250_000;
    expect(projectPublicEvidence("DS-QUAL-02", {
      mobileTransferBytes,
      mobileScore: 84,
      desktopTransferBytes,
      desktopScore: 92,
      responseBytes: 2_000_000,
    })).toEqual({
      mobileTransferBytes,
      mobileScore: 84,
      desktopTransferBytes,
      desktopScore: 92,
    });

    expect(projectPublicEvidence("DS-QUAL-02", {
      mobileTransferBytes: 64 * 1024 * 1024,
      desktopTransferBytes: 64 * 1024 * 1024 + 1,
    })).toEqual({ mobileTransferBytes: 64 * 1024 * 1024 });
  });
});
