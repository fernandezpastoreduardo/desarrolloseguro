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
});
