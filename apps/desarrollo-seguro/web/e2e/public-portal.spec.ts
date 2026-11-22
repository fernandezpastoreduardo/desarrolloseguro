import { expect, test } from "@playwright/test";

test("renders the public portal and allows changing its theme", async ({
  page,
}) => {
  const externalRequests: string[] = [];
  page.on("request", (request) => {
    if (!request.url().startsWith("http://127.0.0.1:4173/")) {
      externalRequests.push(request.url());
    }
  });

  await page.goto("/");

  await expect(page).toHaveTitle("Desarrollo Seguro · Consulta de informes");
  await expect(
    page.getByRole("img", { name: "DesarrolloSeguro.org" }),
  ).toHaveAttribute("src", "/app/assets/desarrollo-seguro-logo-v1.svg");
  await expect(page.getByRole("navigation", { name: "Navegación principal" })).toContainText(
    "Metodología",
  );
  const publicNavigation = page.getByRole("navigation", { name: "Navegación principal" });
  await expect(publicNavigation.getByRole("link", { name: "Inicio" })).toHaveAttribute(
    "href",
    "/desarrollo-seguro/",
  );
  await expect(publicNavigation.getByRole("link", { name: "Metodología" })).toHaveAttribute(
    "href",
    "/desarrollo-seguro/metodologia.html",
  );
  await expect(publicNavigation.getByRole("link", { name: "Privacidad" })).toHaveAttribute(
    "href",
    "/desarrollo-seguro/privacidad.html",
  );
  await expect(publicNavigation.getByRole("link", { name: "Sello" })).toHaveAttribute(
    "href",
    "/desarrollo-seguro/sello.html",
  );
  await expect(
    page.getByRole("heading", { name: "¿Qué se ve desde fuera?" }),
  ).toBeVisible();
  await expect(
    page.getByRole("textbox", { name: "Dominio que quieres consultar" }),
  ).toBeVisible();
  await expect(
    page.getByText("Solo se consulta información guardada."),
  ).toBeVisible();

  const portal = page.locator("main.ds-portal");
  await page.getByRole("button", { name: "Tema oscuro" }).click();
  await expect(portal).toHaveAttribute("data-theme", "dark");
  await expect(page.locator(".ds-portal__search label")).toHaveCSS(
    "color",
    "rgb(244, 241, 235)",
  );
  await expect(page.getByRole("button", { name: "Consultar informe" })).toHaveCSS(
    "background-color",
    "rgb(142, 216, 205)",
  );
  await page.getByRole("button", { name: "Tema claro" }).click();
  await expect(portal).toHaveAttribute("data-theme", "light");
  expect(externalRequests).toEqual([]);
});

test("searches a domain and requests an authorized analysis without third-party traffic", async ({
  page,
}) => {
  const externalRequests: string[] = [];
  page.on("request", (request) => {
    if (!request.url().startsWith("http://127.0.0.1:4173/")) {
      externalRequests.push(request.url());
    }
  });
  await page.route("**/domains/demo.example/status", async (route) =>
    route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        hostname: "demo.example",
        enrollment: "on_demand",
        state: "not_scanned",
        failureCode: null,
        activeJobId: null,
        lastReport: null,
        checkedAt: "2026-11-11T00:00:00.000Z",
      }),
    }),
  );
  await page.route("**/analysis-requests", async (route) =>
    route.fulfill({
      status: 202,
      contentType: "application/json",
      body: JSON.stringify({ hostname: "demo.example", state: "queued" }),
    }),
  );

  await page.goto("/");
  await page.getByRole("textbox", { name: "Dominio que quieres consultar" }).fill("demo.example");
  await page.getByRole("button", { name: "Consultar informe" }).click();
  await expect(page.getByRole("heading", { name: "Aún no hay un informe" })).toBeVisible();
  await page.getByRole("checkbox", { name: /tengo autorización/i }).check();
  await page.getByRole("button", { name: "Solicitar análisis" }).click();
  await expect(page.getByRole("status")).toHaveText("Solicitud añadida a la cola de análisis.");
  expect(externalRequests).toEqual([]);
});

test("shows the report when an authorized analysis finishes", async ({ page }) => {
  let statusReads = 0;
  let completedResponseServed = false;
  await page.route("**/domains/report.example/history", (route) =>
    route.fulfill({ contentType: "application/json", body: "[]" }),
  );
  await page.route("**/domains/report.example/status", async (route) => {
    statusReads += 1;
    const state = statusReads >= 2 ? "updating" : "not_scanned";
    const response = {
      hostname: "report.example",
      enrollment: "on_demand",
      state,
      failureCode: null,
      activeJobId: state === "updating" ? "123e4567-e89b-42d3-a456-426614174000" : null,
      lastReport: null,
      checkedAt: "2026-11-11T00:00:00.000Z",
    };
    const completedResponse = {
      ...response,
      state: "fresh",
      activeJobId: null,
      lastReport: {
        id: "123e4567-e89b-42d3-a456-426614174000",
        hostname: "report.example",
        profileVersion: "domain-v3",
        scannerVersion: "scanner-v1",
        vantage: "same_vps",
        trigger: "requested",
        startedAt: "2026-11-11T00:00:00.000Z",
        completedAt: "2026-11-11T00:01:00.000Z",
        expiresAt: "2026-11-11T01:01:00.000Z",
        verdict: "fail",
        globalAssessment: {
          policyVersion: "mvp-global-v1",
          status: "review",
          score: null,
          weights: { ethics: 50, privacy: 50 },
          ethicsCoverage: { assessedCriteria: 4, totalCriteria: 8 },
          privacyCoverage: {
            assessedCriteria: 1,
            unknownCriteria: 0,
            notApplicableCriteria: 4,
            totalCriteria: 5,
          },
        },
        ethicsAssessment: {
          policyVersion: "domain-ethics-v3",
          score: 70,
          assessedCriteria: 4,
          totalCriteria: 8,
          maturity: "preliminary",
          criteria: [
            { id: "dns-integrity", label: "Resolución DNS", status: "unknown", weight: 10 },
            { id: "transport-security", label: "Seguridad del transporte TLS", status: "pass", weight: 25 },
            { id: "http-availability", label: "Respuesta HTTP", status: "unknown", weight: 15 },
            {
              id: "security-headers",
              label: "Cabeceras de seguridad",
              status: "pass",
              weight: 20,
            },
            { id: "third-party-data-use", label: "Reutilización o venta de datos por terceros", status: "unknown", weight: 10 },
            { id: "initial-cookie-risk", label: "Cookies conocidas en la respuesta inicial", status: "unknown", weight: 10 },
            { id: "tracking", label: "Rastreadores y mapas de calor", status: "fail", weight: 5 },
            { id: "performance", label: "Rendimiento", status: "pass", weight: 5 },
          ],
          reasons: [],
          interpretation:
            "No confirma conexiones ni scripts dinámicos; el rendimiento mide una respuesta inicial.",
        },
        privacyAssessment: {
          policyVersion: "privacy-v1",
          score: 100,
          assessedCriteria: 1,
          unknownCriteria: 0,
          notApplicableCriteria: 4,
          totalCriteria: 5,
          evidence: { cookieNames: [], providers: [], domains: [] },
          criteria: [
            { id: "preference-before-tracking", label: "Actividad no esencial antes de elegir", status: "evaluated", weight: 30, deduction: 0, awarded: 30, confirmedFindings: 0, unknownFindings: 0 },
            { id: "contextual-excess", label: "Exceso y redundancia contextual", status: "not_applicable", weight: 10, deduction: null, awarded: null, confirmedFindings: 0, unknownFindings: 0 },
            { id: "choice-parity", label: "Visibilidad de aceptar y rechazar", status: "not_applicable", weight: 20, deduction: null, awarded: null, confirmedFindings: 0, unknownFindings: 0 },
            { id: "rejection-persistence", label: "Eficacia del rechazo y persistencia", status: "not_applicable", weight: 20, deduction: null, awarded: null, confirmedFindings: 0, unknownFindings: 0 },
            { id: "vendor-controls", label: "Controles de proveedores", status: "not_applicable", weight: 20, deduction: null, awarded: null, confirmedFindings: 0, unknownFindings: 0 },
          ],
        },
        processorTransparencyAssessment: null,
        scope: ["/"],
        checks: [
          {
            controlId: "DS-TLS-02",
            status: "pass",
            required: true,
            severity: "high",
            observedAt: "2026-11-11T00:01:00.000Z",
            targetPath: "/",
            method: "TLS",
            summary: "Las versiones antiguas de TLS están desactivadas.",
            limitation: "Prueba la negociación de TLS por versión; no analiza todos los cifrados.",
            evidence: { tls10Accepted: false, tls11Accepted: false, tls12Accepted: true, tls13Accepted: true },
          },
          {
            controlId: "DS-HDR-01",
            status: "pass",
            required: true,
            severity: "high",
            observedAt: "2026-11-11T00:01:00.000Z",
            targetPath: "/",
            method: "GET",
            summary: "La cabecera de seguridad está presente.",
            limitation: "Solo se observó la portada.",
            evidence: { finalScheme: "https", hsts: true, nosniff: true, frameProtection: true, referrerPolicy: true, csp: true },
          },
          {
            controlId: "DS-PRIV-06",
            status: "fail",
            required: true,
            severity: "medium",
            observedAt: "2026-11-11T00:01:00.000Z",
            targetPath: "/",
            method: "GET",
            summary: "Se encontraron referencias a rastreadores conocidos.",
            limitation: "Solo se contaron referencias visibles en el HTML inicial; no se ejecutó JavaScript ni se confirmó ninguna conexión.",
            evidence: { inspected: true, thirdPartyResourceReferences: 2, knownTrackingResourceReferences: 1 },
          },
          {
            controlId: "DS-QUAL-02",
            status: "pass",
            required: true,
            severity: "medium",
            observedAt: "2026-11-11T00:01:00.000Z",
            targetPath: "/",
            method: "GET",
            summary: "La respuesta inicial se completó dentro del umbral provisional.",
            limitation: "Una única respuesta GET desde el VPS; no mide Core Web Vitals, carga de recursos ni experiencia del visitante.",
            evidence: { inspected: true, responseTimeMs: 700, responseBytes: 45000 },
          },
        ],
      },
    };
    const reportReady = statusReads >= 4;
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify(reportReady ? completedResponse : response),
    });
    if (reportReady) completedResponseServed = true;
  });
  await page.route("**/analysis-requests", async (route) =>
    route.fulfill({
      status: 202,
      contentType: "application/json",
      body: JSON.stringify({ hostname: "report.example", state: "queued" }),
    }),
  );

  await page.goto("/");
  await page.getByRole("textbox", { name: "Dominio que quieres consultar" }).fill("report.example");
  await page.getByRole("button", { name: "Consultar informe" }).click();
  await page.getByRole("checkbox", { name: /tengo autorización/i }).check();
  await page.getByRole("button", { name: "Solicitar análisis" }).click();
  await expect(page.getByRole("status")).toHaveText("Solicitud añadida a la cola de análisis.");

  await expect.poll(() => statusReads, { timeout: 10_000 }).toBeGreaterThanOrEqual(2);
  await expect(page.getByRole("progressbar", { name: "Progreso del análisis" }))
    .toHaveAttribute("data-phase", "running");
  await expect.poll(() => completedResponseServed, { timeout: 25_000 }).toBe(true);

  await expect(page.getByRole("heading", { name: "Informe vigente" })).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Dimensiones de evaluación" }),
  ).toBeVisible();
  await expect(page.getByRole("img", { name: "Puntuación global: en revisión" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Ética" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Privacidad" })).toHaveCount(2);
  await expect(page.getByRole("heading", { name: "Seguridad" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Rendimiento" })).toBeVisible();
  const categoryButtons = page.getByRole("button", { name: "Ver detalle" });
  await expect(categoryButtons).toHaveCount(4);
  await expect(categoryButtons.first()).toHaveAttribute("aria-expanded", "false");
  await expect(page.locator("#report-category-details-ethics")).toHaveCount(0);
  await categoryButtons.nth(2).click();
  const securityDialog = page.getByRole("dialog", { name: "Seguridad" });
  await expect(securityDialog).toBeVisible();
  expect(await securityDialog.evaluate((element) => element.closest(".ds-portal__report-category"))).toBeNull();
  expect((await securityDialog.boundingBox())?.width ?? 0).toBeGreaterThan(400);
  await expect(
    securityDialog.locator('.ds-portal__ethics-criteria li[data-status="pass"] > span').first(),
  ).toHaveText("Correcto");
  await expect(
    securityDialog.locator('.ds-portal__ethics-criteria li[data-status="unknown"] > span').first(),
  ).toHaveText("Sin datos");
  await expect(page.getByText("La conexión protege los datos")).toBeVisible();
  await expect(page.locator(".ds-portal__score-ring")).toHaveAttribute("data-score-band", "unknown");
  await expect(page.locator('.ds-portal__category-score-ring[data-score-band="low"]')).toHaveCount(1);
  await expect(page.locator('.ds-portal__category-score-ring[data-score-band="excellent"]')).toHaveCount(2);
  await expect(page.locator(".ds-portal__category-score-ring-value").first()).toHaveCSS(
    "fill",
    "rgb(245, 237, 225)",
  );
  await expect(page.locator(".ds-portal__category-heading strong").first()).toHaveCSS(
    "color",
    "rgb(212, 217, 225)",
  );
  const technicalEvidenceSections = page.locator(".ds-portal__technical-details summary");
  await expect(technicalEvidenceSections).toHaveCount(1);
  await technicalEvidenceSections.first().click();
  await expect(page.getByText("TLS 1.0 aceptado", { exact: true })).toBeVisible();
  await expect(page.getByText("TLS 1.1 aceptado", { exact: true })).toBeVisible();
  await expect(page.getByText("TLS 1.2 aceptado", { exact: true })).toBeVisible();
  await expect(page.getByText("TLS 1.3 aceptado", { exact: true })).toBeVisible();
  await expect(page.getByText("Política que restringe contenido cargado (CSP)")).toBeVisible();
  await page.getByRole("button", { name: "Cerrar detalle" }).click();
  await categoryButtons.nth(0).click();
  await expect(page.getByRole("dialog", { name: "Ética" })).toBeVisible();
  await expect(
    page.locator('.ds-portal__category-modal .ds-portal__ethics-criteria li[data-status="fail"] > span').first(),
  ).toHaveText("Problema detectado");
  await page.locator(".ds-portal__technical-details summary").click();
  await expect(page.getByText("Referencias a rastreadores conocidos").first()).toBeVisible();
  await expect(page.getByText(/Revisa las referencias detectadas/i)).toBeVisible();
  await expect(page.getByText(/qué revisar:/i).first()).toBeVisible();
  await expect(page.getByText(/HTML inicial contiene referencias a herramientas de seguimiento conocidas/i))
    .toBeVisible();
  await page.getByRole("button", { name: "Cerrar detalle" }).click();
  await categoryButtons.nth(3).click();
  await expect(page.getByRole("dialog", { name: "Rendimiento" })).toBeVisible();
  await page.locator(".ds-portal__technical-details summary").click();
  await expect(page.getByText("Tiempo de respuesta inicial")).toBeVisible();
  await expect(page.getByText("45.000 bytes")).toBeVisible();
  await expect(page.getByText(/qué comprueba:/i).first()).toBeVisible();
  await expect(page.getByText(/qué significa:/i).first()).toBeVisible();
  await expect(page.locator(".ds-portal__report-takeaway")).toBeVisible();
  await expect(page.getByText("Hay controles observados que no se cumplen")).toBeVisible();
  await page.getByRole("button", { name: "Cerrar detalle" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
});

test("stops polling and reports an admission mismatch when no scan job appears", async ({
  page,
}) => {
  let statusReads = 0;
  await page.route("**/domains/stuck.example/status", async (route) => {
    statusReads += 1;
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        hostname: "stuck.example",
        enrollment: "on_demand",
        state: "not_scanned",
        failureCode: null,
        activeJobId: null,
        lastReport: null,
        checkedAt: "2026-11-11T00:00:00.000Z",
      }),
    });
  });
  await page.route("**/analysis-requests", async (route) =>
    route.fulfill({
      status: 202,
      contentType: "application/json",
      body: JSON.stringify({ hostname: "stuck.example", state: "queued" }),
    }),
  );

  await page.goto("/");
  await page.getByRole("textbox", { name: "Dominio que quieres consultar" }).fill("stuck.example");
  await page.getByRole("button", { name: "Consultar informe" }).click();
  await page.getByRole("checkbox", { name: /tengo autorización/i }).check();
  await page.getByRole("button", { name: "Solicitar análisis" }).click();

  await expect(
    page.getByRole("alert").filter({ hasText: /no muestra ningún trabajo activo/i }),
  ).toBeVisible({ timeout: 15_000 });
  await expect(page.getByRole("button", { name: "Volver a solicitar análisis" })).toBeVisible();
  await expect(page.getByRole("progressbar", { name: "Progreso del análisis" })).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Aún no hay un informe" })).toBeVisible();
  expect(statusReads).toBe(2);
});
