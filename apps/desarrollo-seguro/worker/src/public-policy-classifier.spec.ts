import { describe, expect, it } from "vitest";
import { classifyPublicPolicyHtml, getPublicPolicyProviderSources } from "./public-policy-classifier.js";

describe("classifyPublicPolicyHtml", () => {
  it("requires an explicitly stated purpose alongside a known provider", () => {
    expect(classifyPublicPolicyHtml(`
      <p>Usamos Google Analytics para medir el uso de este sitio.</p>
      <p>También integramos Meta Pixel.</p>
    `)).toMatchObject({
      providerIds: expect.arrayContaining(["google-analytics", "meta-pixel"]),
      providersWithPurpose: expect.arrayContaining(["google-analytics"]),
      purposeIds: ["analytics"],
      categories: ["analytics"],
    });
  });

  it("does not read provider names or purposes from scripts and styles", () => {
    expect(classifyPublicPolicyHtml(`
      <script>Google Analytics, estadísticas y medición</script>
      <style>.analytics { content: 'Google Analytics'; }</style>
      <p>No se describen servicios.</p>
    `)).toMatchObject({ providerIds: [], providersWithPurpose: [], purposeIds: [], categories: [] });
  });

  it("recognizes explicit access challenges", () => {
    expect(classifyPublicPolicyHtml("<p>Verifica que eres una persona para continuar.</p>")).toMatchObject({ accessDenied: true });
  });

  it("exposes local catalog provenance without raw policy text", () => {
    const sources = getPublicPolicyProviderSources();
    expect(sources.length).toBeGreaterThan(0);
    expect(sources.every((source) => source.sourceUrl.startsWith("https://") && source.reviewedAt.length > 0 && source.license.length > 0)).toBe(true);
    expect(JSON.stringify(sources)).not.toMatch(/html|cookie value|policy text/iu);
  });
});
