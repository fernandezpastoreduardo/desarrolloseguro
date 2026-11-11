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
