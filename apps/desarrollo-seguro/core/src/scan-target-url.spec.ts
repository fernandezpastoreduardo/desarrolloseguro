import { describe, expect, it } from "vitest";
import { parseScanTargetUrl } from "./scan-target-url.js";

describe("parseScanTargetUrl", () => {
  it("preserves the exact page path and query and removes the fragment", () => {
    expect(parseScanTargetUrl("https://Example.com/ofertas?id=7&src=mail#datos"))
      .toEqual({
        hostname: "example.com",
        targetUrl: "https://example.com/ofertas?id=7&src=mail",
        targetPath: "/ofertas?id=7&src=mail",
      });
  });

  it("uses the root page when the HTTPS URL has no path", () => {
    expect(parseScanTargetUrl("https://example.com")).toEqual({
      hostname: "example.com",
      targetUrl: "https://example.com/",
      targetPath: "/",
    });
  });

  it.each([
    "example.com",
    "http://example.com/page",
    "https://user@example.com/page",
    "https://example.com:8443/page",
    "https://127.0.0.1/page",
    "https://example.com\\@127.0.0.1/page",
    " https://example.com/page",
    "https://example.com/path with spaces",
  ])("rejects unsafe or incomplete input: %s", (input) => {
    expect(() => parseScanTargetUrl(input)).toThrow("invalid_scan_target_url");
  });
});
