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
  await page.route("**/domains/report.example/status", async (route) => {
    statusReads += 1;
    const state = statusReads === 3 ? "updating" : "not_scanned";
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
        profileVersion: "controls-v3",
        scannerVersion: "scanner-v1",
        vantage: "same_vps",
        trigger: "requested",
        startedAt: "2026-11-11T00:00:00.000Z",
        completedAt: "2026-11-11T00:01:00.000Z",
        expiresAt: "2026-11-11T01:01:00.000Z",
        verdict: "pass",
        ethicsAssessment: {
          policyVersion: "domain-ethics-v3",
          score: 100,
          assessedCriteria: 1,
          totalCriteria: 8,
          maturity: "preliminary",
          criteria: [
            { id: "dns-integrity", label: "Resolución DNS", status: "unknown", weight: 10 },
            { id: "transport-security", label: "Seguridad del transporte TLS", status: "unknown", weight: 25 },
            { id: "http-availability", label: "Respuesta HTTP", status: "unknown", weight: 15 },
            {
              id: "security-headers",
              label: "Cabeceras de seguridad",
              status: "pass",
              weight: 20,
            },
            { id: "third-party-data-use", label: "Reutilización o venta de datos por terceros", status: "unknown", weight: 10 },
            { id: "initial-cookie-risk", label: "Cookies conocidas en la respuesta inicial", status: "unknown", weight: 10 },
            { id: "tracking", label: "Rastreadores y mapas de calor", status: "unknown", weight: 5 },
            { id: "performance", label: "Rendimiento", status: "unknown", weight: 5 },
          ],
          reasons: [],
          interpretation:
            "Indicador provisional de DNS, TLS, HTTP, cabeceras y cookies conocidas en la respuesta inicial. No evalúa el consentimiento real, las prácticas de datos de terceros, los rastreadores dinámicos ni el rendimiento; no es una certificación.",
        },
        scope: ["/"],
        checks: [
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
          },
        ],
      },
    };
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify(statusReads >= 4 ? completedResponse : response),
    });
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

  await expect.poll(() => statusReads, { timeout: 25_000 }).toBe(4);

  await expect(page.getByRole("heading", { name: "Informe vigente" })).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Resumen y puntuación" }),
  ).toBeVisible();
  await expect(page.getByText("Controles observados aprobados")).toBeVisible();
});
