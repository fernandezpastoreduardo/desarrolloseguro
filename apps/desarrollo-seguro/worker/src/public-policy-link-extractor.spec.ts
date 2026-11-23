import { describe, expect, it } from "vitest";
import { extractPublicPolicyLinks, MAX_PUBLIC_POLICY_LINKS } from "./public-policy-link-extractor.js";

describe("extractPublicPolicyLinks", () => {
  it("finds same-site and external HTTPS policy links and drops query, fragment, and labels", () => {
    const html = `
      <a href="/politica-de-privacidad?campaign=secret#proveedores">Política de privacidad</a>
      <a href="https://Vendor.Example.com/privacy?email=secret#terms">Privacy information</a>
      <a href="https://terms.vendor.example.com/legal#privacy">Click here</a>
      <a href="/account">Account</a>
    `;

    expect(extractPublicPolicyLinks("WWW.Example.com", html)).toEqual([
      { hostname: "www.example.com", path: "/politica-de-privacidad", kind: "privacy" },
      { hostname: "vendor.example.com", path: "/privacy", kind: "privacy" },
      { hostname: "terms.vendor.example.com", path: "/legal", kind: "terms" },
    ]);
  });

  it("recognizes policy language in nested anchor text", () => {
    expect(extractPublicPolicyLinks("example.com", `
      <a href="/legal"><span>Condiciones del servicio</span></a>
    `)).toEqual([{ hostname: "example.com", path: "/legal", kind: "terms" }]);
  });

  it("deduplicates normalized host and path pairs", () => {
    expect(extractPublicPolicyLinks("example.com", `
      <a href="https://EXAMPLE.com/privacy?one=1">Privacy</a>
      <a href="https://example.com/privacy?two=2#policy">Privacidad</a>
    `)).toEqual([{ hostname: "example.com", path: "/privacy", kind: "privacy" }]);
  });

  it("accepts HTTPS default ports and rejects non-default ports and HTTP", () => {
    expect(extractPublicPolicyLinks("example.com", `
      <a href="https://vendor.example.com:443/privacy">Privacy</a>
      <a href="https://vendor.example.com:8443/privacy">Privacy</a>
      <a href="http://vendor.example.com/privacy">Privacy</a>
    `)).toEqual([{ hostname: "vendor.example.com", path: "/privacy", kind: "privacy" }]);
  });

  it("rejects credentials, IP literals, private suffixes, unsafe schemes, and control paths", () => {
    const links = [
      "https://user:pass@vendor.example.com/privacy",
      "https://127.0.0.1/privacy",
      "https://[::1]/privacy",
      "https://router.local/privacy",
      "https://service.internal/privacy",
      "javascript:alert(1)",
      "https://vendor.example.com/%0a/privacy",
    ].map((href) => `<a href="${href}">Privacy policy</a>`).join("\n");

    expect(extractPublicPolicyLinks("example.com", links)).toEqual([]);
  });

  it("returns no links for invalid root hostnames or oversized documents", () => {
    const html = "<a href='/privacy'>Privacy policy</a>";
    expect(extractPublicPolicyLinks("127.0.0.1", html)).toEqual([]);
    expect(extractPublicPolicyLinks("example.com", "x".repeat(256 * 1024 + 1))).toEqual([]);
  });

  it("caps output at the documented limit", () => {
    const html = Array.from({ length: MAX_PUBLIC_POLICY_LINKS + 10 }, (_, index) =>
      `<a href="https://vendor${index}.example.com/privacy">Privacy policy</a>`,
    ).join("\n");

    const result = extractPublicPolicyLinks("example.com", html);
    expect(result).toHaveLength(MAX_PUBLIC_POLICY_LINKS);
    expect(result[0]).toEqual({ hostname: "vendor0.example.com", path: "/privacy", kind: "privacy" });
  });
});
