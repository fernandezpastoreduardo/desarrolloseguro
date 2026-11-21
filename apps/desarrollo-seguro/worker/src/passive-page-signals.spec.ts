import { describe, expect, it } from "vitest";
import { COOKIE_CATALOG, COOKIE_CATALOG_SOURCE } from "./data/cookie-pattern-catalog.js";
import { inspectPassivePageSignals } from "./passive-page-signals.js";

describe("inspectPassivePageSignals", () => {
  it("counts third-party references and known tracker vendors without retaining URLs", () => {
    const result = inspectPassivePageSignals({
      hostname: "example.com",
      html: `
        <html><head>
          <script src="https://www.google-analytics.com/analytics.js"></script>
          <script src="/assets/app.js"></script>
          <iframe src="https://player.example-video.test/embed"></iframe>
        </head><body></body></html>`,
      setCookieHeaders: [],
      responseTimeMs: 235,
      responseBytes: 12_000,
    });

    expect(result).toMatchObject({
      inspected: true,
      thirdPartyResourceReferences: 2,
      knownTrackingResourceReferences: 1,
      consentPromptDetected: false,
      cookieCount: 0,
      insecureCookieCount: 0,
      catalogMatchCount: 0,
      responseTimeMs: 235,
      responseBytes: 12_000,
    });
    expect(JSON.stringify(result)).not.toContain("google-analytics");
    expect(JSON.stringify(result)).not.toContain("example-video");
  });

  it("detects consent controls and known non-essential cookies without returning values", () => {
    const result = inspectPassivePageSignals({
      hostname: "example.com",
      html: "<button>Rechazar</button><button>Aceptar todas las cookies</button>",
      setCookieHeaders: [
        "_ga=secret-value; Path=/; SameSite=Lax",
        "session=private-value; Path=/; Secure; HttpOnly; SameSite=Strict",
      ],
      responseTimeMs: 120,
      responseBytes: 5_000,
    });

    expect(result).toMatchObject({
      inspected: true,
      consentPromptDetected: true,
      cookieCount: 2,
      insecureCookieCount: 1,
      catalogMatchCount: 1,
    });
    expect(JSON.stringify(result)).not.toContain("secret-value");
    expect(JSON.stringify(result)).not.toContain("private-value");
  });

  it("reports an incomplete observation as uninspected and ignores invalid URLs", () => {
    const result = inspectPassivePageSignals({
      hostname: "example.com",
      html: '<script src="javascript:alert(1)"></script><img src="//[invalid">',
      setCookieHeaders: [],
      responseTimeMs: 1,
      responseBytes: 1,
      complete: false,
    });

    expect(result).toMatchObject({ inspected: false, thirdPartyResourceReferences: 0 });
  });

  it("fails closed when the cookie-header bound is exceeded", () => {
    const result = inspectPassivePageSignals({
      hostname: "example.com",
      html: "<html></html>",
      setCookieHeaders: Array.from({ length: 101 }, () => "session=x; Secure"),
      responseTimeMs: 10,
      responseBytes: 100,
    });

    expect(result).toMatchObject({ inspected: false, cookieCount: 0, catalogMatchCount: 0 });
  });

  it("records the pinned catalog source used for local name matching", () => {
    expect(COOKIE_CATALOG_SOURCE).toMatchObject({
      revision: "7786335566460016f07a50705a92fc781c976f6f",
      license: "Apache-2.0",
    });
  });

  it("uses secure HTTPS for published cookie privacy links", () => {
    expect(COOKIE_CATALOG.every((entry) => entry.privacyUrl === "" || entry.privacyUrl.startsWith("https://"))).toBe(true);
  });

  it("handles deeply nested untrusted markup without recursive traversal", () => {
    const depth = 8_000;
    const result = inspectPassivePageSignals({
      hostname: "example.com",
      html: `${"<span>".repeat(depth)}<button>Rechazar</button>${"</span>".repeat(depth)}`,
      setCookieHeaders: [],
      responseTimeMs: 10,
      responseBytes: 100_000,
    });

    expect(result).toMatchObject({ inspected: true, consentPromptDetected: true });
  });
});
