import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PublicScanPortal } from "../index.js";

const DOMAIN_INPUT_NAME = "Dominio que quieres consultar";
const SEARCH_BUTTON_NAME = "Consultar informe";
const STATUS_ENDPOINT = "/api/desarrollo-seguro/v1/domains/example.com/status";
const ANALYSIS_REQUEST_ENDPOINT =
  "/api/desarrollo-seguro/v1/domains/example.com/analysis-requests";
const REPORT_SUMMARY = "La cabecera de seguridad está presente.";
const RATE_LIMIT_MESSAGE = "Espera un minuto y vuelve a intentarlo.";
const REPORT_ID = "123e4567-e89b-42d3-a456-426614174000";

const PUBLIC_REPORT = {
  id: REPORT_ID,
  hostname: "example.com",
  profileVersion: "controls-v3",
  scannerVersion: "scanner-v1",
  vantage: "same_vps",
  trigger: "requested",
  startedAt: "2026-11-03T07:00:00.000Z",
  completedAt: "2026-11-03T07:01:00.000Z",
  expiresAt: "2026-11-03T08:01:00.000Z",
  verdict: "inconclusive",
  ethicsAssessment: {
    policyVersion: "domain-ethics-v3",
    score: 100,
    assessedCriteria: 1,
    totalCriteria: 8,
    maturity: "preliminary",
    criteria: [
      { id: "dns-integrity", label: "Resolución DNS", status: "pass", weight: 10 },
      { id: "transport-security", label: "Seguridad del transporte TLS", status: "unknown", weight: 25 },
      { id: "http-availability", label: "Respuesta HTTP", status: "unknown", weight: 15 },
      { id: "security-headers", label: "Cabeceras de seguridad", status: "unknown", weight: 20 },
      { id: "third-party-data-use", label: "Reutilización o venta de datos por terceros", status: "unknown", weight: 10 },
      { id: "initial-cookie-risk", label: "Cookies conocidas en la respuesta inicial", status: "unknown", weight: 10 },
      { id: "tracking", label: "Rastreadores y mapas de calor", status: "unknown", weight: 5 },
      { id: "performance", label: "Rendimiento", status: "unknown", weight: 5 },
    ],
    reasons: ["No hay evidencia verificable sobre reutilización o venta de datos por terceros."],
    interpretation: "Indicador provisional de DNS, TLS, HTTP, cabeceras y cookies conocidas en la respuesta inicial. No evalúa el consentimiento real, las prácticas de datos de terceros, los rastreadores dinámicos ni el rendimiento; no es una certificación.",
  },
  scope: ["/"],
  checks: [
    {
      controlId: "DS-HDR-01",
      status: "pass",
      required: true,
      severity: "high",
      observedAt: "2026-11-03T07:01:00.000Z",
      targetPath: "/",
      method: "GET",
      summary: REPORT_SUMMARY,
      limitation: "Solo se observó la portada.",
      evidence: { hsts: true, nosniff: true, csp: false },
    },
  ],
};

describe("PublicScanPortal", () => {
  afterEach(() => {
    cleanup();
    window.history.replaceState({}, "", "/");
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("lets an authorized user request a bounded analysis for an unscanned domain", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        Response.json({
          hostname: "example.com",
          enrollment: "on_demand",
          state: "not_scanned",
          failureCode: null,
          activeJobId: null,
          lastReport: null,
          checkedAt: "2026-11-03T08:00:00.000Z",
        }),
      )
      .mockResolvedValueOnce(
        Response.json({ hostname: "example.com", state: "queued" }, { status: 202 }),
      );
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();

    render(<PublicScanPortal />);
    await user.type(
      screen.getByRole("textbox", { name: DOMAIN_INPUT_NAME }),
      "example.com",
    );
    await user.click(screen.getByRole("button", { name: SEARCH_BUTTON_NAME }));

    expect(fetchMock).toHaveBeenCalledWith(STATUS_ENDPOINT, {
      headers: { Accept: "application/json" },
      method: "GET",
      credentials: "omit",
      cache: "no-store",
    });
    expect(
      await screen.findByRole("heading", { name: "Aún no hay un informe" }),
    ).toBeVisible();
    expect(screen.getByText(/la consulta solo lee información guardada/i)).toBeVisible();
    const authorization = screen.getByRole("checkbox", {
      name: /tengo autorización para solicitar este análisis/i,
    });
    const requestButton = screen.getByRole("button", {
      name: "Solicitar análisis",
    });
    expect(requestButton).toBeDisabled();
    await user.click(authorization);
    await user.click(requestButton);

    expect(fetchMock).toHaveBeenLastCalledWith(ANALYSIS_REQUEST_ENDPOINT, {
      method: "POST",
      headers: { Accept: "application/json", "Content-Type": "application/json" },
      credentials: "omit",
      cache: "no-store",
      body: JSON.stringify({ authorized: true }),
    });
    expect(await screen.findByText(/solicitud añadida a la cola/i)).toBeVisible();
    expect(
      screen.getByRole("progressbar", { name: "Progreso del análisis" }),
    ).toHaveAttribute("data-phase", "queued");
  });

  it("shows the permanent redirect evidence separately from the canonical report", async () => {
    const aliasReport = { ...PUBLIC_REPORT, hostname: "grumphya.com" };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({
      hostname: "www.grumphya.com",
      enrollment: "monitored",
      state: "fresh",
      failureCode: null,
      activeJobId: null,
      lastReport: aliasReport,
      hostnameResolution: {
        observedReportId: REPORT_ID,
        requestedHostname: "www.grumphya.com",
        canonicalHostname: "grumphya.com",
        statusCode: 301,
        responseStatusCode: 200,
        fromHostname: "www.grumphya.com",
        toHostname: "grumphya.com",
      },
      checkedAt: "2026-11-03T08:00:00.000Z",
    })));
    const user = userEvent.setup();
    render(<PublicScanPortal />);
    await user.type(screen.getByRole("textbox", { name: DOMAIN_INPUT_NAME }), "www.grumphya.com");
    await user.click(screen.getByRole("button", { name: SEARCH_BUTTON_NAME }));
    expect(await screen.findByText(/redirección permanente HTTP 301 a grumphya\.com/i)).toBeVisible();
    expect(screen.getByText(/respuesta final fue HTTP 200/i)).toBeVisible();
    expect(screen.getByRole("link", { name: "Consultar la evidencia de redirección" }))
      .toHaveAttribute("href", `/app/?report=${REPORT_ID}`);
    expect(screen.getByRole("heading", { name: /Informe/ })).toBeVisible();
  });

  it("stops after one poll when an accepted request has no active job", async () => {
    const status = {
      hostname: "example.com",
      enrollment: "on_demand",
      state: "not_scanned",
      failureCode: null,
      activeJobId: null,
      lastReport: null,
      checkedAt: "2026-11-03T08:00:00.000Z",
    };
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(Response.json(status))
      .mockResolvedValueOnce(
        Response.json({ hostname: "example.com", state: "queued" }, { status: 202 }),
      )
      .mockResolvedValueOnce(Response.json(status));
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();

    render(<PublicScanPortal />);
    await user.type(
      screen.getByRole("textbox", { name: DOMAIN_INPUT_NAME }),
      "example.com",
    );
    await user.click(screen.getByRole("button", { name: SEARCH_BUTTON_NAME }));
    await user.click(
      await screen.findByRole("checkbox", {
        name: /tengo autorización para solicitar este análisis/i,
      }),
    );
    await user.click(screen.getByRole("button", { name: "Solicitar análisis" }));
    expect(await screen.findByText(/solicitud añadida a la cola/i)).toBeVisible();

    await new Promise((resolve) => globalThis.setTimeout(resolve, 5_100));
    expect(screen.getByRole("alert").textContent).toMatch(
      /no muestra ningún trabajo activo/i,
    );
    expect(screen.getByRole("button", { name: "Volver a solicitar análisis" })).toBeVisible();
    expect(screen.queryByRole("progressbar", { name: "Progreso del análisis" })).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(3);
  }, 10_000);

  it("shows the stored checks and makes a stale report visibly historical", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(Response.json({
        hostname: "example.com",
        enrollment: "on_demand",
        state: "stale",
        failureCode: null,
        activeJobId: null,
        lastReport: PUBLIC_REPORT,
        checkedAt: "2026-11-03T08:10:00.000Z",
      }))
      .mockResolvedValueOnce(Response.json([
        {
          id: PUBLIC_REPORT.id,
          hostname: PUBLIC_REPORT.hostname,
          profileVersion: PUBLIC_REPORT.profileVersion,
          completedAt: PUBLIC_REPORT.completedAt,
          expiresAt: PUBLIC_REPORT.expiresAt,
          verdict: PUBLIC_REPORT.verdict,
          score: PUBLIC_REPORT.ethicsAssessment.score,
          assessedCriteria: PUBLIC_REPORT.ethicsAssessment.assessedCriteria,
          totalCriteria: PUBLIC_REPORT.ethicsAssessment.totalCriteria,
          certificationState: null,
        },
      ]));
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();

    render(<PublicScanPortal />);
    await user.type(
      screen.getByRole("textbox", { name: DOMAIN_INPUT_NAME }),
      "example.com",
    );
    await user.click(screen.getByRole("button", { name: SEARCH_BUTTON_NAME }));

    expect(await screen.findByText("Histórico")).toBeVisible();
    expect(screen.getByRole("heading", { name: "Historial de observaciones" })).toBeVisible();
    expect(screen.getByText("1 informe")).toBeVisible();
    expect(screen.getByRole("heading", { name: "Resumen y puntuación" })).toBeVisible();
    const categoryButtons = screen.getAllByRole("button", { name: "Ver detalle" });
    expect(categoryButtons).toHaveLength(4);
    await user.click(categoryButtons[2]);
    expect(screen.getByRole("dialog", { name: "Seguridad" })).toBeVisible();
    expect(screen.getByText(REPORT_SUMMARY)).toBeInTheDocument();
    expect(screen.getByText(/solo se observó la portada/i)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Cerrar detalle" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    await user.click(categoryButtons[0]);
    expect(screen.getByRole("dialog", { name: "Ética" })).toBeVisible();
    expect(screen.getByText(/no hay evidencia verificable sobre reutilización o venta/i)).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Cerrar detalle" }));
    await user.click(categoryButtons[2]);
    expect(screen.getByText("100/100 · provisional · 1 de 8 criterios evaluados")).toBeVisible();
    expect(screen.getByText(/solo se calcula con los criterios evaluados/i)).toBeVisible();
    expect(screen.getByText("No se detectaron problemas en 1 aspecto evaluado. 7 aspectos aún no tienen datos."))
      .toBeVisible();
    expect(screen.getByText("100/100 provisional · 1 de 4 aspectos evaluados"))
      .toBeVisible();
    expect(screen.getByText(/provisional · 1 de 8 criterios evaluados/i)).toBeVisible();
    expect(screen.getAllByText(/qué significa:/i)).toHaveLength(4);
    expect(screen.getAllByText("Sin datos suficientes").length).toBeGreaterThan(0);
    expect(screen.getByText(/origen indicado en el registro/i)).toBeVisible();
    expect(screen.getByRole("heading", { name: "Privacidad" })).toBeVisible();
    expect(screen.getByRole("heading", { name: "Ética" })).toBeVisible();
    expect(screen.getByRole("heading", { name: "Rendimiento" })).toBeVisible();
    expect(screen.getByRole("region", { name: "Niveles de evaluación" })).toBeVisible();
    expect(screen.getByRole("img", { name: "Puntuación global: 100 de 100 puntos" })).toBeVisible();
    expect(document.querySelector(".ds-portal__score-ring")).toHaveAttribute("data-score-band", "excellent");
    expect(document.querySelectorAll('.ds-portal__category-score-ring[data-score-band="excellent"]')).toHaveLength(1);
    expect(screen.getByRole("img", { name: "Ética: sin puntuación; 0 de 2 aspectos evaluados" })).toBeVisible();
    expect(screen.getByRole("img", { name: "Privacidad: sin puntuación; 0 de 1 aspectos evaluados" })).toBeVisible();
    expect(screen.getByRole("img", { name: "Seguridad: 100 de 100 puntos; 1 de 4 aspectos evaluados" })).toBeVisible();
    expect(screen.getByRole("img", { name: "Rendimiento: sin puntuación; 0 de 1 aspectos evaluados" })).toBeVisible();
    expect(screen.getByRole("img", { name: "Observado: 1 de 8 criterios (13%)" })).toBeVisible();
    expect(screen.getByRole("img", { name: "No observado: 0 de 8 criterios (0%)" })).toBeVisible();
    expect(screen.getByRole("img", { name: "Sin conclusión: 7 de 8 criterios (88%)" })).toBeVisible();
    expect(screen.getByText(/indicaciones que el sitio envía al navegador/i)).toBeVisible();
    expect(screen.getByText(/se revisaron 1 de 4 aspectos; no se detectaron problemas en el observado\. faltan datos de 3/i)).toBeVisible();
    expect(screen.getByText("Política que restringe contenido cargado (CSP)")).toBeInTheDocument();
    expect(screen.getByText(/faltaba.*política de contenido CSP/i)).toBeVisible();
    expect(screen.getByText("Ver evidencias técnicas (1 comprobación)")).toBeVisible();

    const summary = screen.getByRole("heading", { name: "Resumen y puntuación" });
    const detail = screen.getByRole("heading", { name: "Alcance observado" });
    expect(
      summary.compareDocumentPosition(detail) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it.each([
    [74, "low"],
    [75, "good"],
    [89, "good"],
    [90, "excellent"],
  ] as const)("assigns score %s to the %s visual band", async (score, band) => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        Response.json({
          ...PUBLIC_REPORT,
          ethicsAssessment: { ...PUBLIC_REPORT.ethicsAssessment, score },
        }),
      ),
    );
    window.history.replaceState({}, "", `/?report=${REPORT_ID}`);

    render(<PublicScanPortal />);

    await screen.findByRole("img", { name: `Puntuación global: ${score} de 100 puntos` });
    expect(document.querySelector(".ds-portal__score-ring")).toHaveAttribute(
      "data-score-band",
      band,
    );
  });

  it("lets an authorized user request a fresh analysis when a historical report exists", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        Response.json({
          hostname: "example.com",
          enrollment: "on_demand",
          state: "stale",
          failureCode: null,
          activeJobId: null,
          lastReport: PUBLIC_REPORT,
          checkedAt: "2026-11-03T08:10:00.000Z",
        }),
      )
      .mockResolvedValueOnce(Response.json([]))
      .mockResolvedValueOnce(
        Response.json({ hostname: "example.com", state: "queued" }, { status: 202 }),
      );
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();

    render(<PublicScanPortal />);
    await user.type(
      screen.getByRole("textbox", { name: DOMAIN_INPUT_NAME }),
      "example.com",
    );
    await user.click(screen.getByRole("button", { name: SEARCH_BUTTON_NAME }));

    expect(await screen.findByText("Histórico")).toBeVisible();
    await user.click(
      screen.getByRole("checkbox", {
        name: /tengo autorización para solicitar este análisis/i,
      }),
    );
    await user.click(screen.getByRole("button", { name: "Solicitar análisis" }));

    expect(fetchMock).toHaveBeenLastCalledWith(ANALYSIS_REQUEST_ENDPOINT, {
      method: "POST",
      headers: { Accept: "application/json", "Content-Type": "application/json" },
      credentials: "omit",
      cache: "no-store",
      body: JSON.stringify({ authorized: true }),
    });
    expect(await screen.findByText(/solicitud añadida a la cola/i)).toBeVisible();
    expect(
      screen.getByRole("progressbar", { name: "Progreso del análisis" }),
    ).toHaveAttribute("data-phase", "queued");
  });

  it("shows a safe failure reason and allows retry when no report was produced", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        Response.json({
          hostname: "example.com",
          enrollment: "on_demand",
          state: "failed",
          failureCode: "egress_failed",
          activeJobId: null,
          lastReport: null,
          checkedAt: "2026-11-03T08:10:00.000Z",
        }),
      )
      .mockResolvedValueOnce(
        Response.json({ hostname: "example.com", state: "queued" }, { status: 202 }),
      );
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();

    render(<PublicScanPortal />);
    await user.type(
      screen.getByRole("textbox", { name: DOMAIN_INPUT_NAME }),
      "example.com",
    );
    await user.click(screen.getByRole("button", { name: SEARCH_BUTTON_NAME }));

    expect(await screen.findByText(/no se pudo completar la conexión pública/i)).toBeVisible();
    await user.click(
      screen.getByRole("checkbox", {
        name: /tengo autorización para solicitar este análisis/i,
      }),
    );
    await user.click(screen.getByRole("button", { name: "Solicitar análisis" }));
    expect(await screen.findByText(/solicitud añadida a la cola/i)).toBeVisible();
  });

  it("shows an indeterminate progress bar for a domain with an active scan", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        Response.json({
          hostname: "example.com",
          enrollment: "on_demand",
          state: "updating",
          failureCode: null,
          activeJobId: "123e4567-e89b-42d3-a456-426614174123",
          lastReport: null,
          checkedAt: "2026-11-03T08:10:00.000Z",
        }),
      ),
    );
    const user = userEvent.setup();

    render(<PublicScanPortal />);
    await user.type(
      screen.getByRole("textbox", { name: DOMAIN_INPUT_NAME }),
      "example.com",
    );
    await user.click(screen.getByRole("button", { name: SEARCH_BUTTON_NAME }));

    const progress = await screen.findByRole("progressbar", {
      name: "Progreso del análisis",
    });
    expect(progress).toHaveAttribute(
      "aria-valuetext",
      expect.stringContaining("porcentaje de progreso no está disponible"),
    );
    expect(progress).not.toHaveAttribute("aria-valuenow");
  });

  it("accepts and labels a transport-v1 report", async () => {
    const transportReport = {
      ...PUBLIC_REPORT,
      profileVersion: "transport-v1",
      checks: [
        {
          ...PUBLIC_REPORT.checks[0],
          controlId: "DS-DNS-01",
          method: "DNS",
          summary: "Comprobación DS-DNS-01: pass.",
        },
      ],
    };
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(Response.json(transportReport)),
    );
    window.history.replaceState({}, "", `/?report=${REPORT_ID}`);
    const user = userEvent.setup();

    render(<PublicScanPortal />);

    expect(await screen.findByText("transport-v1")).toBeVisible();
    await user.click(screen.getAllByRole("button", { name: "Ver detalle" })[2]);
    expect(screen.getByText("Comprobación DS-DNS-01: pass.")).toBeInTheDocument();
  });

  it("shows the bounded initial-cookie finding in a domain-v1 report", async () => {
    const domainReport = {
      ...PUBLIC_REPORT,
      profileVersion: "domain-v1",
      ethicsAssessment: {
        ...PUBLIC_REPORT.ethicsAssessment,
        policyVersion: "domain-ethics-v3",
        score: 50,
        assessedCriteria: 2,
        criteria: [
          { id: "dns-integrity", label: "Resolución DNS", status: "pass", weight: 10 },
          { id: "transport-security", label: "Seguridad del transporte TLS", status: "unknown", weight: 25 },
          { id: "http-availability", label: "Respuesta HTTP", status: "unknown", weight: 15 },
          { id: "security-headers", label: "Cabeceras de seguridad", status: "unknown", weight: 20 },
          { id: "third-party-data-use", label: "Reutilización o venta de datos por terceros", status: "unknown", weight: 10 },
          { id: "initial-cookie-risk", label: "Cookies conocidas en la respuesta inicial", status: "fail", weight: 10 },
          { id: "tracking", label: "Rastreadores y mapas de calor", status: "unknown", weight: 5 },
          { id: "performance", label: "Rendimiento", status: "unknown", weight: 5 },
        ],
        reasons: ["Cookies conocidas en la respuesta inicial: el control observado presenta fallos."],
      },
      checks: [
        {
          ...PUBLIC_REPORT.checks[0],
          controlId: "DS-PRIV-05",
          status: "fail",
          method: "GET",
          summary: "Cookies en respuesta inicial: 2; coincidencias con la tabla local Analytics/Marketing: 1; sin atributo Secure: 1. No se interactuó con el banner de consentimiento.",
          limitation: "Solo se analizó la respuesta HTTP inicial; no se ejecutó JavaScript ni se eligió consentimiento.",
          evidence: { inspected: true, cookieCount: 2, insecureCookieCount: 1, catalogMatchCount: 1, consentPromptDetected: false },
        },
      ],
    };
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(Response.json(domainReport)),
    );
    window.history.replaceState({}, "", `/?report=${REPORT_ID}`);
    const user = userEvent.setup();

    render(<PublicScanPortal />);

    await screen.findByText("domain-v1");
    await user.click(screen.getAllByRole("button", { name: "Ver detalle" })[1]);
    expect(await screen.findByText(/coincidencias con la tabla local Analytics\/Marketing: 1/i)).toBeInTheDocument();
    expect(screen.getByText(/no se interactuó con el banner de consentimiento/i)).toBeInTheDocument();
    expect(screen.getByRole("img", { name: /No observado: 1 de 8 criterios/ })).toBeVisible();
  });

  it("shows domain-v2 tracker and response evidence in readable categories", async () => {
    const criteria = PUBLIC_REPORT.ethicsAssessment.criteria.map((criterion) => {
      if (["security-headers", "initial-cookie-risk"].includes(criterion.id)) {
        return { ...criterion, status: "pass" };
      }
      if (["tracking", "performance"].includes(criterion.id)) {
        return { ...criterion, status: "fail" };
      }
      return { ...criterion, status: "unknown" };
    });
    const report = {
      ...PUBLIC_REPORT,
      profileVersion: "domain-v2",
      verdict: "fail",
      ethicsAssessment: {
        ...PUBLIC_REPORT.ethicsAssessment,
        score: 75,
        assessedCriteria: 4,
        criteria,
        reasons: ["Hay referencias a rastreadores conocidos.", "La respuesta inicial supera el umbral provisional."],
        interpretation: "No confirma conexiones ni scripts dinámicos; el rendimiento mide una respuesta inicial.",
      },
      checks: [
        { ...PUBLIC_REPORT.checks[0], evidence: { finalScheme: "https", hsts: true, nosniff: true, frameProtection: true, referrerPolicy: true, csp: true } },
        {
          ...PUBLIC_REPORT.checks[0], controlId: "DS-PRIV-05", summary: "Cookies comprobadas.",
          evidence: { inspected: true, cookieCount: 0, insecureCookieCount: 0, catalogMatchCount: 0, consentPromptDetected: false },
        },
        {
          ...PUBLIC_REPORT.checks[0], controlId: "DS-PRIV-06", status: "fail", summary: "Referencias a terceros comprobadas.",
          evidence: { inspected: true, thirdPartyResourceReferences: 3, knownTrackingResourceReferences: 1 },
        },
        {
          ...PUBLIC_REPORT.checks[0], controlId: "DS-QUAL-02", status: "fail", summary: "Respuesta inicial medida.",
          evidence: { inspected: true, responseTimeMs: 2_900, responseBytes: 40_000 },
        },
      ],
    };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json(report)));
    window.history.replaceState({}, "", `/?report=${REPORT_ID}`);

    render(<PublicScanPortal />);

    expect(await screen.findByText("domain-v2")).toBeVisible();
    const user = userEvent.setup();
    await user.click(screen.getAllByRole("button", { name: "Ver detalle" })[0]);
    expect(screen.getAllByText("Referencias a rastreadores conocidos").length).toBeGreaterThan(0);
    await user.click(screen.getByRole("button", { name: "Cerrar detalle" }));
    await user.click(screen.getAllByRole("button", { name: "Ver detalle" })[3]);
    expect(screen.getByText("Tiempo de respuesta inicial")).toBeInTheDocument();
    expect(screen.getByText("40.000 bytes")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Cerrar detalle" }));
    expect(screen.getByText("No confirma conexiones ni scripts dinámicos; el rendimiento mide una respuesta inicial.")).toBeVisible();
  });

  it("renders untrusted report strings as text rather than HTML", async () => {
    const unsafeSummary = '<img src=x onerror="alert(1)">';
    const reportWithUnsafeText = {
      ...PUBLIC_REPORT,
      checks: PUBLIC_REPORT.checks.map((check) => ({
        ...check,
        summary: unsafeSummary,
      })),
    };
    const fetchMock = vi
      .fn()
      .mockResolvedValue(Response.json(reportWithUnsafeText));
    vi.stubGlobal("fetch", fetchMock);
    window.history.replaceState({}, "", `/?report=${REPORT_ID}`);
    const user = userEvent.setup();

    render(<PublicScanPortal />);

    const categoryButtons = await screen.findAllByRole("button", { name: "Ver detalle" });
    await user.click(categoryButtons[2]);
    expect(await screen.findByText(unsafeSummary)).toBeInTheDocument();
    expect(document.querySelector("img[onerror]")).toBeNull();
    expect(fetchMock).toHaveBeenCalledWith(
      `/api/desarrollo-seguro/v1/reports/${REPORT_ID}`,
      expect.objectContaining({ credentials: "omit", cache: "no-store" }),
    );
  });

  it("rejects reports whose ID or check paths do not match the request and declared scope", async () => {
    const outOfScopeReport = {
      ...PUBLIC_REPORT,
      scope: ["/"],
      checks: PUBLIC_REPORT.checks.map((check) => ({
        ...check,
        targetPath: "/precios",
      })),
    };
    const fetchMock = vi
      .fn()
      .mockResolvedValue(Response.json(outOfScopeReport));
    vi.stubGlobal("fetch", fetchMock);
    window.history.replaceState({}, "", `/?report=${REPORT_ID}`);

    render(<PublicScanPortal />);

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "No se ha podido consultar el informe.",
    );

    cleanup();
    fetchMock.mockResolvedValueOnce(
      Response.json({
        ...PUBLIC_REPORT,
        id: "123e4567-e89b-42d3-a456-426614174001",
      }),
    );
    render(<PublicScanPortal />);

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "No se ha podido consultar el informe.",
    );
  });

  it("explains when a domain is excluded without implying an active scan", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      Response.json({
        hostname: "example.com",
        enrollment: "on_demand",
        state: "unavailable",
        failureCode: null,
        activeJobId: null,
        lastReport: null,
        checkedAt: "2026-11-03T08:00:00.000Z",
      }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();

    render(<PublicScanPortal />);
    await user.type(
      screen.getByRole("textbox", { name: DOMAIN_INPUT_NAME }),
      "example.com",
    );
    await user.click(screen.getByRole("button", { name: SEARCH_BUTTON_NAME }));

    expect(
      await screen.findByText(
        "Este dominio no está disponible para consulta pública.",
      ),
    ).toBeVisible();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("does not expose server error details when the read endpoint fails", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        Response.json({ message: "private storage failure" }, { status: 503 }),
      );
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();

    render(<PublicScanPortal />);
    await user.type(
      screen.getByRole("textbox", { name: DOMAIN_INPUT_NAME }),
      "example.com",
    );
    await user.click(screen.getByRole("button", { name: SEARCH_BUTTON_NAME }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "No se ha podido consultar el informe.",
    );
    expect(
      screen.queryByText(/private storage failure/i),
    ).not.toBeInTheDocument();
  });

  it("fails closed when a successful response has a malformed public schema", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      Response.json({
        hostname: "example.com",
        enrollment: "on_demand",
        state: "green",
        activeJobId: null,
        lastReport: null,
        checkedAt: "not-a-date",
      }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();

    render(<PublicScanPortal />);
    await user.type(
      screen.getByRole("textbox", { name: DOMAIN_INPUT_NAME }),
      "example.com",
    );
    await user.click(screen.getByRole("button", { name: SEARCH_BUTTON_NAME }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "No se ha podido consultar el informe.",
    );
  });

  it("rejects a report whose score disagrees with its evaluated criteria", async () => {
    const invalidReport = {
      ...PUBLIC_REPORT,
      ethicsAssessment: {
        ...PUBLIC_REPORT.ethicsAssessment,
        assessedCriteria: 2,
      },
    };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({
      hostname: "example.com",
      enrollment: "on_demand",
      state: "fresh",
      failureCode: null,
      activeJobId: null,
      lastReport: invalidReport,
      checkedAt: "2026-11-03T08:00:00.000Z",
    })));
    const user = userEvent.setup();

    render(<PublicScanPortal />);
    await user.type(screen.getByRole("textbox", { name: DOMAIN_INPUT_NAME }), "example.com");
    await user.click(screen.getByRole("button", { name: SEARCH_BUTTON_NAME }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "No se ha podido consultar el informe.",
    );
  });

  it("does not treat a non-JSON success response as a public report", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response("<html>login</html>", {
        status: 200,
        headers: { "Content-Type": "text/html" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();

    render(<PublicScanPortal />);
    await user.type(
      screen.getByRole("textbox", { name: DOMAIN_INPUT_NAME }),
      "example.com",
    );
    await user.click(screen.getByRole("button", { name: SEARCH_BUTTON_NAME }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "No se ha podido consultar el informe.",
    );
    expect(screen.queryByText(/login/i)).not.toBeInTheDocument();
  });

  it("explains a rate limit without showing the server response body", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        Response.json({ message: "rate_limited" }, { status: 429 }),
      );
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();

    render(<PublicScanPortal />);
    await user.type(
      screen.getByRole("textbox", { name: DOMAIN_INPUT_NAME }),
      "example.com",
    );
    await user.click(screen.getByRole("button", { name: SEARCH_BUTTON_NAME }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      RATE_LIMIT_MESSAGE,
    );
    expect(screen.queryByText("rate_limited")).not.toBeInTheDocument();
  });

  it("rejects a URL instead of sending a request to an arbitrary path", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();

    render(<PublicScanPortal />);
    await user.type(
      screen.getByRole("textbox", { name: DOMAIN_INPUT_NAME }),
      "https://example.com/path",
    );
    await user.click(screen.getByRole("button", { name: SEARCH_BUTTON_NAME }));

    expect(fetchMock).not.toHaveBeenCalled();
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Escribe un dominio válido",
    );
  });

  it("associates an invalid domain with its input and returns focus to it", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();

    render(<PublicScanPortal />);
    const input = screen.getByRole("textbox", { name: DOMAIN_INPUT_NAME });
    await user.type(input, "https://example.com/ruta");
    await user.click(screen.getByRole("button", { name: SEARCH_BUTTON_NAME }));

    expect(input).toHaveAttribute("aria-invalid", "true");
    expect(input).toHaveAttribute(
      "aria-errormessage",
      "ds-portal-domain-error",
    );
    expect(screen.getByText("Escribe un dominio válido, por ejemplo ejemplo.es.")).toHaveAttribute(
      "id",
      "ds-portal-domain-error",
    );
    expect(input).toHaveFocus();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("announces each analysis phase once while polling keeps the same phase", async () => {
    vi.useFakeTimers();
    const queuedStatus = {
      hostname: "example.com",
      enrollment: "on_demand",
      state: "not_scanned",
      failureCode: null,
      activeJobId: null,
      lastReport: null,
      checkedAt: "2026-11-03T08:00:00.000Z",
    };
    const updatingStatus = {
      ...queuedStatus,
      state: "updating",
      activeJobId: "123e4567-e89b-42d3-a456-426614174123",
    };
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(Response.json(queuedStatus))
      .mockResolvedValueOnce(
        Response.json({ hostname: "example.com", state: "queued" }, { status: 202 }),
      )
      .mockImplementation(() => Promise.resolve(Response.json(updatingStatus)));
    vi.stubGlobal("fetch", fetchMock);
    render(<PublicScanPortal />);
    const input = screen.getByRole("textbox", { name: DOMAIN_INPUT_NAME });
    const form = input.closest("form");
    if (!form) throw new Error("search_form_missing");
    await act(async () => {
      fireEvent.change(input, { target: { value: "example.com" } });
      fireEvent.submit(form);
      await Promise.resolve();
    });
    await act(async () => {
      fireEvent.click(
        screen.getByRole("checkbox", {
          name: /tengo autorización para solicitar este análisis/i,
        }),
      );
      fireEvent.click(screen.getByRole("button", { name: "Solicitar análisis" }));
      await Promise.resolve();
    });

    const announcement = screen.getByText(
      "Análisis en cola. Se avisará cuando comience.",
      { exact: true },
    );
    expect(announcement).toHaveAttribute("aria-live", "polite");

    await act(async () => {
      await vi.advanceTimersByTimeAsync(5_000);
    });
    expect(announcement).toHaveTextContent("Análisis en curso");
    const firstRunningAnnouncement = announcement.textContent;

    await act(async () => {
      await vi.advanceTimersByTimeAsync(5_000);
    });
    expect(announcement.textContent).toBe(firstRunningAnnouncement);
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });
});
