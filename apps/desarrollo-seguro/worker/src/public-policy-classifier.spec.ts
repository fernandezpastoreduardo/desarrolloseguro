import { describe, expect, it } from "vitest";
import { classifyPublicPolicyHtml, getPublicPolicyProviderSources } from "./public-policy-classifier.js";

describe("classifyPublicPolicyHtml", () => {
  it("requires an explicitly stated purpose alongside a known provider", () => {
    expect(classifyPublicPolicyHtml(`
      <p>Usamos Google Analytics para la medición del uso de este sitio.</p>
      <p>También integramos Meta Pixel.</p>
    `)).toMatchObject({
      providerIds: expect.arrayContaining(["google-analytics", "meta-pixel"]),
      providersWithPurpose: expect.arrayContaining(["google-analytics"]),
      purposeIds: ["analytics"],
      categories: ["analytics"],
    });
  });

  it("does not treat the word analytics in a product name as a declared purpose", () => {
    expect(classifyPublicPolicyHtml("<p>Usamos Google Analytics y Meta Pixel.</p>")).toMatchObject({
      providerIds: ["google-analytics", "meta-pixel"],
      providersWithPurpose: [],
      declaredServices: [],
    });
  });

  it("attributes purposes per sentence instead of spreading a paragraph purpose across providers", () => {
    const result = classifyPublicPolicyHtml(`
      <p>Google Analytics se usa para la medición de audiencia. OpenAI presta funciones de inteligencia artificial.</p>
    `);
    expect(result.declaredServices).toEqual([
      { providerId: "google-analytics", purposeIds: ["analytics"] },
      { providerId: "openai-api", purposeIds: ["ai_processing"] },
    ]);
  });

  it("leaves a purpose unattributed when one sentence names multiple providers", () => {
    const result = classifyPublicPolicyHtml(`<p>Google Analytics y OpenAI participan en la medición de audiencia.</p>`);
    expect(result.providerIds).toEqual(expect.arrayContaining(["google-analytics", "openai-api"]));
    expect(result.providersWithPurpose).toEqual([]);
    expect(result.declaredServices).toEqual([]);
  });

  it("recognizes OpenAI and IONOS and their declared backend purposes", () => {
    const result = classifyPublicPolicyHtml(`
      <p>Cuando una función de IA está activada, el servidor puede enviar a OpenAI el texto de la idea para evaluarla, crear una representación semántica y comparar similitudes. Para generar una respuesta se envía el mensaje correspondiente. La moderación de avatares envía la imagen procesada.</p>
      <p>El despliegue usa un VPS de IONOS para la web, API y base de datos. IONOS también presta el servicio SMTP para el envío de correos.</p>
    `);

    expect(result.providerIds).toEqual(expect.arrayContaining(["openai-api", "ionos"]));
    expect(result.declaredServices).toEqual(expect.arrayContaining([
      { providerId: "openai-api", purposeIds: expect.arrayContaining(["ai_processing"]) },
      { providerId: "ionos", purposeIds: expect.arrayContaining(["email_delivery", "infrastructure"]) },
    ]));
    expect(result.categories).toEqual(["other"]);
    expect(result.siteStatements).toEqual(expect.arrayContaining([
      expect.objectContaining({ providerId: "openai-api", factId: "provider_receives_content", value: true }),
      expect.objectContaining({ providerId: "ionos", factId: "provider_performs_purpose", value: true }),
    ]));
    expect(result.siteStatements?.some((statement) => statement.factId === "provider_receives_personal_data")).toBe(false);
  });

  it("emits provider_receives_personal_data only for an explicit direct personal-data claim", () => {
    const result = classifyPublicPolicyHtml(`
      <p><strong>Política de privacidad</strong></p>
      <p>OpenAI recibe y procesa datos personales de usuarios para prestar el servicio.</p>
      <p>No enviamos datos personales de usuarios a IONOS.</p>
      <p>Meta Pixel ayuda a medir las visitas.</p>
    `);

    expect(result.siteStatements).toEqual(expect.arrayContaining([
      expect.objectContaining({ providerId: "openai-api", factId: "provider_receives_personal_data", value: true, basis: "explicit_claim" }),
      expect.objectContaining({ providerId: "ionos", factId: "provider_receives_personal_data", value: false, basis: "explicit_claim" }),
    ]));
    expect(result.siteStatements?.some((statement) =>
      statement.providerId === "meta-pixel" && statement.factId === "provider_receives_personal_data",
    )).toBe(false);
    expect(result.documentTitle).toBeUndefined();
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
    expect(sources.some((source) => source.sourceUrl === "https://openai.com/policies/sub-processor-list/")).toBe(true);
    expect(sources.some((source) => source.sourceUrl === "https://www.ionos.es/ayuda/proteccion-de-datos/informacion-general-sobre-el-rgpd/contrato-de-tratamiento-de-datos/")).toBe(true);
    expect(JSON.stringify(sources)).not.toMatch(/html|cookie value|policy text/iu);
  });
});
