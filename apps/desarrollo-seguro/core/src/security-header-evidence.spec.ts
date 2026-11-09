import { describe, expect, it } from "vitest";
import { assessSecurityHeaders } from "./security-header-evidence.js";

const HTTPS_SCHEME = "https";
const HTTP_SCHEME = "http";
const SECURE_CSP =
  "default-src 'self'; script-src 'sha256-suebgenoyDvF0MseSMQjhvmvvc00cXYsKyXaeDanRCI='; object-src 'none'; base-uri 'self'; frame-ancestors 'none'; form-action 'self'";
const VALID_HEADERS = {
  "Strict-Transport-Security": "max-age=31536000; includeSubDomains",
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "Content-Security-Policy": SECURE_CSP,
} as const;
const PASS_EVIDENCE = {
  hsts: true,
  nosniff: true,
  frameProtection: true,
  referrerPolicy: true,
  csp: true,
};

describe("assessSecurityHeaders", () => {
  it("returns a pass for a complete HTTPS response with the versioned minimum rubric", () => {
    expect(assessSecurityHeaders(VALID_HEADERS, HTTPS_SCHEME)).toEqual({
      status: "pass",
      evidence: PASS_EVIDENCE,
    });
  });

  it("returns unknown when the response could not be inspected over HTTPS", () => {
    expect(assessSecurityHeaders(VALID_HEADERS, HTTP_SCHEME)).toEqual({
      status: "unknown",
      evidence: null,
    });
    expect(assessSecurityHeaders(null, HTTPS_SCHEME)).toEqual({
      status: "unknown",
      evidence: null,
    });
  });

  it("rejects the current policy when only a partial Content Security Policy is present", () => {
    const headers = {
      ...VALID_HEADERS,
      "Content-Security-Policy":
        "base-uri 'self'; object-src 'none'; frame-ancestors 'none'; form-action 'self'",
      "Content-Security-Policy-Report-Only": SECURE_CSP,
    };

    expect(assessSecurityHeaders(headers, HTTPS_SCHEME)).toEqual({
      status: "fail",
      evidence: { ...PASS_EVIDENCE, csp: false },
    });
  });

  it("fails HSTS below six months and does not require includeSubDomains", () => {
    const headers = {
      ...VALID_HEADERS,
      "Strict-Transport-Security": "max-age=15767999",
    };

    expect(assessSecurityHeaders(headers, HTTPS_SCHEME)).toEqual({
      status: "fail",
      evidence: { ...PASS_EVIDENCE, hsts: false },
    });

    expect(
      assessSecurityHeaders(
        { ...headers, "Strict-Transport-Security": "max-age=15768000" },
        HTTPS_SCHEME,
      ).evidence?.hsts,
    ).toBe(true);
  });

  it.each([
    ["duplicate max-age", "max-age=31536000; max-age=31536000"],
    ["signed max-age", "max-age=+31536000"],
    ["fractional max-age", "max-age=31536000.5"],
    ["unsafe integer max-age", "max-age=9007199254740992"],
  ])("rejects HSTS with %s", (_label, hsts) => {
    const assessment = assessSecurityHeaders(
      { ...VALID_HEADERS, "Strict-Transport-Security": hsts },
      HTTPS_SCHEME,
    );

    expect(assessment.status).toBe("fail");
    expect(assessment.evidence?.hsts).toBe(false);
  });

  it.each([
    ["missing HSTS", { ...VALID_HEADERS, "Strict-Transport-Security": "" }],
    [
      "invalid nosniff",
      { ...VALID_HEADERS, "X-Content-Type-Options": "no-sniff" },
    ],
    [
      "unsafe frame policy",
      {
        ...VALID_HEADERS,
        "X-Frame-Options": "ALLOW-FROM https://example.com",
        "Content-Security-Policy": SECURE_CSP.replace(
          "frame-ancestors 'none'",
          "frame-ancestors *",
        ),
      },
    ],
    [
      "unsafe referrer policy",
      { ...VALID_HEADERS, "Referrer-Policy": "unsafe-url" },
    ],
    [
      "unsafe CSP source",
      {
        ...VALID_HEADERS,
        "Content-Security-Policy": SECURE_CSP.replace("'self'", "*"),
      },
    ],
  ])("marks %s as a failed observation", (_label, headers) => {
    expect(assessSecurityHeaders(headers, HTTPS_SCHEME).status).toBe("fail");
  });

  it.each(["'self'", "'unsafe-inline'", "'unsafe-eval'", "*"])(
    "rejects unsafe script-src source %s",
    (source) => {
      const headers = {
        ...VALID_HEADERS,
        "Content-Security-Policy": SECURE_CSP.replace(
          /script-src [^;]+/u,
          `script-src ${source}`,
        ),
      };

      expect(assessSecurityHeaders(headers, HTTPS_SCHEME).evidence?.csp).toBe(
        false,
      );
    },
  );

  it("keeps X-Frame-Options evidence independent of an unsafe CSP", () => {
    const headers = {
      ...VALID_HEADERS,
      "Content-Security-Policy": SECURE_CSP.replace(
        /script-src [^;]+/u,
        "script-src 'unsafe-inline'",
      ),
    };

    expect(assessSecurityHeaders(headers, HTTPS_SCHEME)).toEqual({
      status: "fail",
      evidence: { ...PASS_EVIDENCE, csp: false },
    });
  });

  it("accepts CSP frame protection when X-Frame-Options is absent", () => {
    const headers = Object.fromEntries(
      Object.entries(VALID_HEADERS).filter(
        ([name]) => name !== "X-Frame-Options",
      ),
    );

    expect(
      assessSecurityHeaders(headers, HTTPS_SCHEME).evidence?.frameProtection,
    ).toBe(true);
  });

  it("treats multiple enforcing policies cumulatively and reads header names case-insensitively", () => {
    const headers = {
      "strict-transport-security": VALID_HEADERS["Strict-Transport-Security"],
      "x-content-type-options": VALID_HEADERS["X-Content-Type-Options"],
      "referrer-policy": VALID_HEADERS["Referrer-Policy"],
      "content-security-policy": ["default-src *", SECURE_CSP],
    };

    expect(assessSecurityHeaders(headers, HTTPS_SCHEME)).toEqual({
      status: "pass",
      evidence: PASS_EVIDENCE,
    });
  });

  it("uses the first occurrence of a duplicate CSP directive", () => {
    const headers = {
      ...VALID_HEADERS,
      "Content-Security-Policy": SECURE_CSP.replace(
        "default-src 'self'",
        "default-src *; default-src 'self'",
      ),
    };

    expect(assessSecurityHeaders(headers, HTTPS_SCHEME).evidence?.csp).toBe(
      false,
    );
  });

  it("does not interpret non-string header values as observed evidence", () => {
    const headers = { ...VALID_HEADERS, "X-Frame-Options": 1 };

    expect(assessSecurityHeaders(headers, HTTPS_SCHEME)).toEqual({
      status: "unknown",
      evidence: null,
    });
  });

  it("returns unknown when inspecting an accessor-backed header throws", () => {
    const headers = { ...VALID_HEADERS };
    Object.defineProperty(headers, "Content-Security-Policy", {
      enumerable: true,
      get() {
        throw new Error("untrusted header accessor");
      },
    });

    expect(() => assessSecurityHeaders(headers, HTTPS_SCHEME)).not.toThrow();
    expect(assessSecurityHeaders(headers, HTTPS_SCHEME)).toEqual({
      status: "unknown",
      evidence: null,
    });
  });

  it("returns unknown when inspecting a proxy-backed header record throws", () => {
    const headers = new Proxy(VALID_HEADERS, {
      getPrototypeOf() {
        throw new Error("untrusted header proxy");
      },
    });

    expect(() => assessSecurityHeaders(headers, HTTPS_SCHEME)).not.toThrow();
    expect(assessSecurityHeaders(headers, HTTPS_SCHEME)).toEqual({
      status: "unknown",
      evidence: null,
    });
  });
});
