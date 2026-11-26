import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { parsePublicServiceComparison } from "@desarrolloseguro/core";
import { PublicScanPortal } from "../index.js";

const DOMAIN_INPUT_NAME = "URL HTTPS que quieres auditar";
const SEARCH_BUTTON_NAME = "Consultar informe";
const STATUS_ENDPOINT = "/api/desarrollo-seguro/v1/domains/example.com/status?targetUrl=https%3A%2F%2Fexample.com%2F";
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
  globalAssessment: {
    policyVersion: "mvp-global-v2",
    status: "not_available",
    score: null,
    legalViolationAccredited: false,
    weights: { ethics: 50, privacy: 50 },
    ethicsCoverage: { assessedCriteria: 1, totalCriteria: 8 },
    privacyCoverage: null,
  },
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
      { id: "third-party-data-use", label: "Transparencia sobre servicios externos", status: "unknown", weight: 10 },
      { id: "initial-cookie-risk", label: "Cookies conocidas en la respuesta inicial", status: "unknown", weight: 10 },
      { id: "tracking", label: "Rastreadores y mapas de calor", status: "unknown", weight: 5 },
      { id: "performance", label: "Rendimiento", status: "unknown", weight: 5 },
    ],
    reasons: ["El auditor no pudo terminar la revisión de la información pública sobre servicios externos."],
    interpretation: "Indicador provisional de DNS, TLS, HTTP, cabeceras y cookies conocidas en la respuesta inicial. No evalúa el consentimiento real, las prácticas de datos de terceros, los rastreadores dinámicos ni el rendimiento; no es una certificación.",
  },
  processorTransparencyAssessment: null,
  publicPolicyTransparencyAssessment: null,
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
const SCORED_PUBLIC_REPORT = {
  ...PUBLIC_REPORT,
  globalAssessment: {
    policyVersion: "mvp-global-v2",
    status: "scored",
    score: 90,
    legalViolationAccredited: false,
    weights: { ethics: 50, privacy: 50 },
    ethicsCoverage: { assessedCriteria: 8, totalCriteria: 8 },
    privacyCoverage: {
      assessedCriteria: 3,
      unknownCriteria: 0,
      notApplicableCriteria: 2,
      totalCriteria: 5,
    },
  },
  ethicsAssessment: {
    ...PUBLIC_REPORT.ethicsAssessment,
    score: 100,
    assessedCriteria: 8,
    maturity: "broad",
    criteria: PUBLIC_REPORT.ethicsAssessment.criteria.map((criterion) => ({
      ...criterion,
      status: "pass",
    })),
  },
  privacyAssessment: {
    policyVersion: "privacy-v1",
    score: 80,
    assessedCriteria: 3,
    unknownCriteria: 0,
    notApplicableCriteria: 2,
    totalCriteria: 5,
    evidence: { cookieNames: [], providers: [], domains: [] },
    criteria: [
      { id: "preference-before-tracking", label: "Actividad no esencial antes de elegir", status: "evaluated", weight: 30, deduction: 6, awarded: 24, confirmedFindings: 1, unknownFindings: 0 },
      { id: "contextual-excess", label: "Exceso y redundancia contextual", status: "not_applicable", weight: 10, deduction: null, awarded: null, confirmedFindings: 0, unknownFindings: 0 },
      { id: "choice-parity", label: "Visibilidad de aceptar y rechazar", status: "evaluated", weight: 20, deduction: 8, awarded: 12, confirmedFindings: 1, unknownFindings: 0 },
      { id: "rejection-persistence", label: "Eficacia del rechazo y persistencia", status: "evaluated", weight: 20, deduction: 0, awarded: 20, confirmedFindings: 0, unknownFindings: 0 },
      { id: "vendor-controls", label: "Controles de proveedores", status: "not_applicable", weight: 20, deduction: null, awarded: null, confirmedFindings: 0, unknownFindings: 0 },
    ],
  },
};

describe("PublicScanPortal", () => {
  afterEach(() => {
    cleanup();
    window.history.replaceState({}, "", "/");
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("shows the two-profile performance score and evidence for domain-v5", async () => {
    const performanceEvidence = {
      inspected: true,
      mobileFcpMs: 1_820,
      mobileLcpMs: 2_700,
      mobileClsMilli: 120,
      mobileTbtMs: 220,
      mobileTtfbMs: 900,
      mobileTransferBytes: 2_000_000,
      mobileScore: 84,
      desktopFcpMs: 1_100,
      desktopLcpMs: 1_700,
      desktopClsMilli: 40,
      desktopTbtMs: 80,
      desktopTtfbMs: 300,
      desktopTransferBytes: 800_000,
      desktopScore: 92,
    };
    const targetPath = "/servicio?plan=pro";
    const report = {
      ...SCORED_PUBLIC_REPORT,
      profileVersion: "domain-v5",
      scannerVersion: "domain-v5-network-adapter-1",
      scope: [targetPath],
      checks: [
        { ...SCORED_PUBLIC_REPORT.checks[0], targetPath },
        {
          controlId: "DS-QUAL-02",
          status: "pass",
          required: true,
          severity: "medium",
          observedAt: "2026-11-03T07:01:00.000Z",
          targetPath,
          method: "GET",
          summary: "Carga medida en móvil y escritorio.",
          limitation: "Medición propia tipo Lighthouse.",
          evidence: performanceEvidence,
        },
      ],
    };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json(report)));
    window.history.replaceState({}, "", `/app/?report=${REPORT_ID}`);

    render(<PublicScanPortal />);

    expect(await screen.findByRole("img", {
      name: "Rendimiento: 88 de 100 puntos; 1 de 1 aspectos evaluados",
    })).toBeVisible();
    expect(screen.getByText("88/100 · media de móvil y escritorio")).toBeVisible();
    const performanceButton = document.querySelector('[data-category-id="performance"]');
    expect(performanceButton).not.toBeNull();
    fireEvent.click(performanceButton!);
    expect(screen.getByRole("dialog", { name: "Rendimiento" })).toBeVisible();
    expect(screen.getByText(/Móvil 84\/100 y escritorio 92\/100; nota media 88\/100/u)).toBeVisible();
    fireEvent.click(screen.getByText("Ver evidencias técnicas (1 comprobación)"));
    expect(screen.getByText("Móvil · FCP")).toBeVisible();
    expect(screen.getByText("1820 ms")).toBeVisible();
    expect(screen.getByText("Móvil · CLS")).toBeVisible();
    expect(screen.getByText("0,120")).toBeVisible();
    expect(screen.getByText("Escritorio · puntuación")).toBeVisible();
    expect(screen.getByText(/2\.000\.000 bytes/u)).toBeVisible();
  });

  it("does not invent an aggregate performance score when a required profile metric is missing", async () => {
    const targetPath = "/servicio?plan=pro";
    const incompleteEvidence = {
      inspected: true,
      mobileFcpMs: 1_820,
      mobileClsMilli: 120,
      mobileTbtMs: 220,
      mobileTtfbMs: 900,
      mobileTransferBytes: 2_000_000,
      mobileScore: 84,
      desktopFcpMs: 1_100,
      desktopLcpMs: 1_700,
      desktopClsMilli: 40,
      desktopTbtMs: 80,
      desktopTtfbMs: 300,
      desktopTransferBytes: 800_000,
      desktopScore: 92,
    };
    const report = {
      ...SCORED_PUBLIC_REPORT,
      profileVersion: "domain-v5",
      scannerVersion: "domain-v5-network-adapter-1",
      scope: [targetPath],
      checks: [
        { ...SCORED_PUBLIC_REPORT.checks[0], targetPath },
        {
          controlId: "DS-QUAL-02",
          status: "unknown",
          required: true,
          severity: "medium",
          observedAt: "2026-11-03T07:01:00.000Z",
          targetPath,
          method: "GET",
          summary: "Medición incompleta.",
          limitation: "Falta una métrica móvil.",
          evidence: incompleteEvidence,
        },
      ],
    };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json(report)));
    window.history.replaceState({}, "", `/app/?report=${REPORT_ID}`);

    render(<PublicScanPortal />);

    expect(await screen.findByRole("img", {
      name: "Rendimiento: sin puntuación; 0 de 1 aspectos evaluados",
    })).toBeVisible();
    expect(screen.getByText("Sin datos suficientes")).toBeVisible();
    expect(screen.getByText(/Medición incompleta: falta algún dato requerido de móvil o escritorio/u)).toBeVisible();
    const performanceButton = document.querySelector('[data-category-id="performance"]');
    expect(performanceButton).not.toBeNull();
    fireEvent.click(performanceButton!);
    expect(screen.getByText(/Medición incompleta: móvil 84\/100; escritorio 92\/100/u)).toBeVisible();
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
    expect(screen.queryByText(/Comprobación técnica acotada desde el mismo VPS/i)).not.toBeInTheDocument();
    await user.type(
      screen.getByRole("textbox", { name: DOMAIN_INPUT_NAME }),
      "https://example.com/",
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
      body: JSON.stringify({ authorized: true, targetUrl: "https://example.com/" }),
    });
    expect(await screen.findByRole("progressbar", { name: "Progreso del análisis" }))
      .toHaveAttribute("data-phase", "queued");
    expect(
      screen.getByRole("progressbar", { name: "Progreso del análisis" }),
    ).toHaveAttribute("data-phase", "queued");
  });

  it.each([
    ["grumphya.com", true],
    ["desarrolloseguro.org", true],
    ["talentoypersonas.com", false],
  ] as const)("shows the beta certification status for %s only when it is a client", async (hostname, visible) => {
    const report = {
      ...PUBLIC_REPORT,
      hostname,
      certification: {
        policyVersion: "beta-0.1",
        state: "pending",
        latestAssessmentStatus: "pending",
        score: null,
        lastCheckedAt: "2026-11-03T07:01:00.000Z",
        certifiedReportId: null,
      },
    };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({
      hostname,
      enrollment: "on_demand",
      state: "fresh",
      failureCode: null,
      activeJobId: null,
      lastReport: report,
      checkedAt: "2026-11-03T07:01:00.000Z",
    })));
    const user = userEvent.setup();

    render(<PublicScanPortal />);
    await user.type(screen.getByRole("textbox", { name: DOMAIN_INPUT_NAME }), `https://${hostname}/`);
    await user.click(screen.getByRole("button", { name: SEARCH_BUTTON_NAME }));

    expect(await screen.findByRole("heading", { name: "Qué significa esta valoración" })).toBeVisible();
    expect(document.querySelector(".ds-portal__certification") !== null).toBe(visible);
    expect(screen.queryByText("Certificación beta · beta-0.1") !== null).toBe(visible);
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
    await user.type(screen.getByRole("textbox", { name: DOMAIN_INPUT_NAME }), "https://www.grumphya.com/");
    await user.click(screen.getByRole("button", { name: SEARCH_BUTTON_NAME }));
    expect(await screen.findByText(/redirección permanente HTTP 301 a grumphya\.com/i)).toBeVisible();
    expect(screen.getByText(/respuesta final fue HTTP 200/i)).toBeVisible();
    expect(screen.getByRole("link", { name: "Consultar la evidencia de redirección" }))
      .toHaveAttribute("href", `/app/?report=${REPORT_ID}`);
    expect(screen.getByRole("heading", { name: /Informe/ })).toBeVisible();
  });

  it("shows the separate plain-language block for Grumphya's 14 private criteria", async () => {
    const ids = [
      "infrastructure.tls", "infrastructure.headers", "infrastructure.network",
      "application.dependencies", "application.secrets", "authentication.authorization",
      "quality.e2e", "quality.accessibility", "performance.page_load",
      "privacy.cookies", "privacy.third_parties", "privacy.consent",
      "ethics.transparency", "ai.disclosure",
    ];
    const report = {
      ...PUBLIC_REPORT,
      hostname: "grumphya.com",
      internalAuditSummary: {
        policyVersion: "internal-audit-public-v1",
        status: "complete",
        observedAt: "2026-11-03T10:00:00.000Z",
        criteria: ids.map((id) => ({ id, status: id === "application.secrets" ? "fail" : "pass" })),
      },
    };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({
      hostname: "grumphya.com", enrollment: "monitored", state: "fresh",
      failureCode: null, activeJobId: null, lastReport: report,
      checkedAt: "2026-11-03T10:01:00.000Z",
    })));
    const user = userEvent.setup();
    render(<PublicScanPortal />);
    await user.type(screen.getByRole("textbox", { name: DOMAIN_INPUT_NAME }), "https://grumphya.com/");
    await user.click(screen.getByRole("button", { name: SEARCH_BUTTON_NAME }));

    expect(await screen.findByRole("heading", { name: "Lo que ocurre dentro de Grumphya" })).toBeVisible();
    expect(screen.getByText(/Grumphya ha decidido permitir una revisión de aspectos internos/i)).toBeVisible();
    expect(screen.getByText("Protección de claves de acceso")).toBeVisible();
    expect(screen.getByText(/Una clave expuesta podría permitir/i)).toBeVisible();
    expect(screen.getByText(/Revisión completada el/i)).toBeVisible();
    expect(screen.queryByText(/Qué revisar/i)).not.toBeInTheDocument();
    const auditSection = screen.getByRole("region", { name: "Lo que ocurre dentro de Grumphya" });
    expect(auditSection.querySelectorAll("li")).toHaveLength(14);
    expect(screen.getByRole("heading", { name: "Conexión y protección" })).toBeVisible();
    expect(screen.getByRole("heading", { name: "Datos e información" })).toBeVisible();
  });

  it("shows active internal checks as running, not as a final review state", async () => {
    const ids = [
      "infrastructure.tls", "infrastructure.headers", "infrastructure.network",
      "application.dependencies", "application.secrets", "authentication.authorization",
      "quality.e2e", "quality.accessibility", "performance.page_load",
      "privacy.cookies", "privacy.third_parties", "privacy.consent",
      "ethics.transparency", "ai.disclosure",
    ];
    const report = {
      ...PUBLIC_REPORT,
      hostname: "grumphya.com",
      internalAuditState: "running",
      internalAuditSummary: {
        policyVersion: "internal-audit-public-v1",
        status: "review",
        observedAt: null,
        criteria: ids.map((id) => ({ id, status: "unknown" })),
      },
    };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({
      hostname: "grumphya.com", enrollment: "monitored", state: "updating",
      activeJobId: "123e4567-e89b-42d3-a456-426614174123", failureCode: null,
      lastReport: report, checkedAt: "2026-11-03T10:01:00.000Z",
    })));
    const user = userEvent.setup();
    render(<PublicScanPortal />);
    await user.type(screen.getByRole("textbox", { name: DOMAIN_INPUT_NAME }), "https://grumphya.com/");
    await user.click(screen.getByRole("button", { name: SEARCH_BUTTON_NAME }));

    const auditSection = await screen.findByRole("region", { name: "Lo que ocurre dentro de Grumphya" });
    expect(auditSection).toHaveAttribute("aria-busy", "true");
    expect(screen.getByText(/El informe se está actualizando/i)).toBeVisible();
    expect(auditSection.querySelectorAll(".ds-portal__spinner")).toHaveLength(1);
    expect(within(auditSection).getAllByText("Pendiente")).toHaveLength(14);
  });

  it("shows verified backend providers and attributes treatment statements to Grumphya", async () => {
    const report = {
      ...PUBLIC_REPORT,
      hostname: "grumphya.com",
      ethicsAssessment: {
        ...PUBLIC_REPORT.ethicsAssessment,
        policyVersion: "domain-ethics-v4",
        assessedCriteria: 2,
        criteria: PUBLIC_REPORT.ethicsAssessment.criteria.map((criterion) => criterion.id === "third-party-data-use"
          ? { id: "backend-processor-transparency", label: "Transparencia de procesadores backend", status: "pass", weight: 10 }
          : criterion),
        reasons: [],
      },
      globalAssessment: {
        ...PUBLIC_REPORT.globalAssessment,
        ethicsCoverage: { assessedCriteria: 2, totalCriteria: 8 },
      },
      processorTransparencyAssessment: {
        policyVersion: "processor-inventory-v1",
        status: "pass",
        reasonCode: "inventory_complete_and_disclosed",
        inventory: {
          policyVersion: "processor-inventory-v1",
          observedAt: "2026-11-03T10:00:00.000Z",
          validUntil: "2026-11-04T10:00:00.000Z",
          hostname: "grumphya.com",
          deploymentDigest: `sha256:${"a".repeat(64)}`,
          inventoryStatus: "complete",
          privacyPolicy: { url: "https://grumphya.com/politica-de-privacidad", revision: "v5" },
          processors: [{
            providerId: "openai-api",
            displayName: "OpenAI",
            product: "API",
            disclosureStatus: "published",
            purpose: "Procesamiento de solicitudes de IA",
            policyUrl: "https://grumphya.com/politica-de-privacidad#openai-api",
            declaredStatements: ["No se usa para entrenar modelos."],
          }],
          attestation: { verified: true, keyId: "grumphya-release-2026" },
        },
      },
    };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({
      hostname: "grumphya.com",
      enrollment: "monitored",
      state: "fresh",
      failureCode: null,
      activeJobId: null,
      lastReport: report,
      checkedAt: "2026-11-03T10:01:00.000Z",
    })));
    const user = userEvent.setup();

    render(<PublicScanPortal />);
    await user.type(screen.getByRole("textbox", { name: DOMAIN_INPUT_NAME }), "https://grumphya.com/");
    await user.click(screen.getByRole("button", { name: SEARCH_BUTTON_NAME }));

    expect(await screen.findByRole("heading", { name: "Información adicional compartida por Grumphya" })).toBeVisible();
    expect(screen.getByRole("heading", { name: /OpenAI.*API/ })).toBeVisible();
    expect(screen.getByText("Declaraciones de Grumphya:")).toBeVisible();
    expect(screen.getByText("No se usa para entrenar modelos.")).toBeVisible();
    expect(screen.getByRole("link", { name: "Ver política de privacidad de Grumphya" }))
      .toHaveAttribute("href", "https://grumphya.com/politica-de-privacidad#openai-api");
  });

  it("accepts and shows the self-domain IONOS hosting inventory", async () => {
    const report = {
      ...PUBLIC_REPORT,
      hostname: "desarrolloseguro.org",
      ethicsAssessment: {
        ...PUBLIC_REPORT.ethicsAssessment,
        policyVersion: "domain-ethics-v4",
        assessedCriteria: 2,
        criteria: PUBLIC_REPORT.ethicsAssessment.criteria.map((criterion) => criterion.id === "third-party-data-use"
          ? { id: "backend-processor-transparency", label: "Transparencia de procesadores backend", status: "pass", weight: 10 }
          : criterion),
        reasons: [],
      },
      globalAssessment: {
        ...PUBLIC_REPORT.globalAssessment,
        ethicsCoverage: { assessedCriteria: 2, totalCriteria: 8 },
      },
      processorTransparencyAssessment: {
        policyVersion: "processor-inventory-v1",
        status: "pass",
        reasonCode: "inventory_complete_and_disclosed",
        inventory: {
          policyVersion: "processor-inventory-v1",
          observedAt: "2026-11-25T10:00:00.000Z",
          validUntil: "2026-11-26T10:00:00.000Z",
          hostname: "desarrolloseguro.org",
          deploymentDigest: `sha256:${"a".repeat(64)}`,
          inventoryStatus: "complete",
          privacyPolicy: {
            url: "https://desarrolloseguro.org/desarrollo-seguro/privacidad.html",
            revision: "v2",
          },
          processors: [{
            providerId: "ionos",
            displayName: "IONOS",
            product: "VPS",
            disclosureStatus: "published",
            purpose: "Alojamiento de la web pública, la API y la base de datos de Desarrollo Seguro.",
            policyUrl: "https://desarrolloseguro.org/desarrollo-seguro/privacidad.html#ionos-hosting",
            declaredStatements: [
              "Desarrollo Seguro está alojado en un VPS de IONOS que ejecuta la web pública, la API y la base de datos.",
            ],
          }],
          attestation: { verified: true, keyId: "desarrolloseguro-source-registry-v1" },
          evidenceSource: "desarrolloseguro_source_registry",
        },
      },
    };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({
      hostname: "desarrolloseguro.org", enrollment: "monitored", state: "fresh",
      failureCode: null, activeJobId: null, lastReport: report,
      checkedAt: "2026-11-25T10:01:00.000Z",
    })));
    const user = userEvent.setup();
    render(<PublicScanPortal />);
    await user.type(screen.getByRole("textbox", { name: DOMAIN_INPUT_NAME }), "https://desarrolloseguro.org/");
    await user.click(screen.getByRole("button", { name: SEARCH_BUTTON_NAME }));

    expect(await screen.findByRole("heading", { name: "Información adicional compartida por Desarrollo Seguro" })).toBeVisible();
    expect(screen.getByRole("heading", { name: /IONOS.*VPS/ })).toBeVisible();
    expect(screen.getByText(/Alojamiento de la web pública/)).toBeVisible();
    expect(screen.getByRole("link", { name: "Ver política de privacidad de Desarrollo Seguro" }))
      .toHaveAttribute("href", "https://desarrolloseguro.org/desarrollo-seguro/privacidad.html#ionos-hosting");
  });

  it("shows the v5 public service transparency criterion in Ethics with its evidence", async () => {
    const criteria = PUBLIC_REPORT.ethicsAssessment.criteria.map((criterion) => criterion.id === "third-party-data-use"
      ? { id: "external-service-transparency", label: "Información pública sobre servicios externos", status: "pass", weight: 10 }
      : { ...criterion, status: "pass" });
    const report = {
      ...PUBLIC_REPORT,
      profileVersion: "domain-v3",
      ethicsAssessment: {
        ...PUBLIC_REPORT.ethicsAssessment,
        policyVersion: "domain-ethics-v5",
        score: 100,
        assessedCriteria: 8,
        maturity: "broad",
        criteria,
        reasons: [],
      },
      globalAssessment: {
        ...SCORED_PUBLIC_REPORT.globalAssessment,
        ethicsCoverage: { assessedCriteria: 8, totalCriteria: 8 },
      },
      privacyAssessment: SCORED_PUBLIC_REPORT.privacyAssessment,
      publicPolicyTransparencyAssessment: {
        policyVersion: "public-policy-v1",
        status: "pass",
        reasonCode: "disclosure_found",
        evidence: {
          linksFound: 2,
          pagesInspected: 2,
          unavailablePages: 0,
          accessDeniedPages: 0,
          providerMentions: 3,
          providersMissingPurpose: 0,
          categories: ["analytics"],
        },
      },
    };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({
      hostname: "example.com",
      enrollment: "on_demand",
      state: "fresh",
      failureCode: null,
      activeJobId: null,
      lastReport: report,
      checkedAt: "2026-11-03T10:01:00.000Z",
    })));
    const user = userEvent.setup();

    render(<PublicScanPortal />);
    await user.type(screen.getByRole("textbox", { name: DOMAIN_INPUT_NAME }), "https://example.com/");
    await user.click(screen.getByRole("button", { name: SEARCH_BUTTON_NAME }));

    expect(await screen.findByRole("heading", { name: "Qué significa esta valoración" })).toBeVisible();
    await user.click(screen.getAllByRole("button", { name: "Ver detalle" })[0]);
    expect(screen.getByText("Información pública sobre servicios externos")).toBeVisible();
    expect(screen.getByText(/la información pública del sitio explica servicios externos y para qué se usan/i)).toBeVisible();
  });

  it("explains observed, undeclared and declaration-only services with public sources", async () => {
    const report = {
      ...SCORED_PUBLIC_REPORT,
      profileVersion: "domain-v4",
      scannerVersion: "domain-v4-network-adapter-7",
      ethicsAssessment: {
        ...SCORED_PUBLIC_REPORT.ethicsAssessment,
        policyVersion: "domain-ethics-v6",
        criteria: SCORED_PUBLIC_REPORT.ethicsAssessment.criteria.map((criterion) => criterion.id === "third-party-data-use"
          ? { ...criterion, id: "external-service-transparency" }
          : criterion),
      },
      privacyAssessment: {
        ...SCORED_PUBLIC_REPORT.privacyAssessment,
        evidence: { cookieNames: [], providers: [], domains: ["static.unclassified.example"] },
      },
      publicServiceComparison: {
        policyVersion: "public-service-comparison-v1",
        status: "fail",
        reasonCode: "observed_service_undisclosed",
        items: [
          { providerId: "openai-api", observation: "observed_and_declared", observedDomains: ["api.openai.com"], declaredPurposes: ["ai_processing"] },
          { providerId: "google-analytics", observation: "observed", observedDomains: ["www.google-analytics.com"], declaredPurposes: [] },
          { providerId: "ionos", observation: "declared", observedDomains: [], declaredPurposes: ["support", "mystery"] },
          { providerId: "unlisted-vendor", observation: "observed", observedDomains: ["edge.unlisted.example"], declaredPurposes: [] },
        ],
      },
    };
    expect(parsePublicServiceComparison(report.publicServiceComparison)).not.toBeNull();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({
      hostname: "example.com",
      enrollment: "on_demand",
      state: "fresh",
      failureCode: null,
      activeJobId: null,
      lastReport: report,
      checkedAt: "2026-11-03T10:01:00.000Z",
    })));
    const user = userEvent.setup();

    render(<PublicScanPortal />);
    await user.type(screen.getByRole("textbox", { name: DOMAIN_INPUT_NAME }), "https://example.com/");
    await user.click(screen.getByRole("button", { name: SEARCH_BUTTON_NAME }));

    expect(await screen.findByRole("heading", { name: "Servicios externos detectados" })).toBeVisible();
    expect(screen.getByText(/incumplimiento observado: se detectó un servicio externo sin información pública/i)).toBeVisible();
    expect(screen.getByText("Correcto · observado y explicado")).toBeVisible();
    expect(screen.getAllByText("Servicio observado · sin finalidad declarada")).toHaveLength(2);
    expect(screen.getByText("Declarado · no observado en esta revisión")).toBeVisible();
    expect(screen.getAllByRole("link", { name: "acuerdo de tratamiento de datos" })
      .some((link) => link.getAttribute("href") === "https://openai.com/policies/data-processing-addendum/")).toBe(true);
    expect(screen.getByText(/edge\.unlisted\.example/iu)).toBeVisible();
    expect(screen.getAllByText("static.unclassified.example").length).toBeGreaterThan(0);
    expect(screen.getByText(/una finalidad que el sitio identifica en su política/i)).toBeVisible();
  });

  it("shows observed services without claiming the unread policy omitted them", async () => {
    const report = {
      ...SCORED_PUBLIC_REPORT,
      profileVersion: "domain-v4",
      scannerVersion: "domain-v4-network-adapter-7",
      ethicsAssessment: {
        ...SCORED_PUBLIC_REPORT.ethicsAssessment,
        policyVersion: "domain-ethics-v6",
        criteria: SCORED_PUBLIC_REPORT.ethicsAssessment.criteria.map((criterion) => criterion.id === "third-party-data-use"
          ? { ...criterion, id: "external-service-transparency" }
          : criterion),
      },
      publicServiceComparison: {
        policyVersion: "public-service-comparison-v1",
        status: "unknown",
        reasonCode: "auditor_error",
        items: [{
          providerId: "google-analytics",
          observation: "observed",
          observedDomains: ["www.google-analytics.com"],
          declaredPurposes: [],
        }],
      },
    };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({
      hostname: "example.com", enrollment: "on_demand", state: "fresh", failureCode: null,
      activeJobId: null, lastReport: report, checkedAt: "2026-11-03T10:01:00.000Z",
    })));
    const user = userEvent.setup();
    render(<PublicScanPortal />);
    await user.type(screen.getByRole("textbox", { name: DOMAIN_INPUT_NAME }), "https://example.com/");
    await user.click(screen.getByRole("button", { name: SEARCH_BUTTON_NAME }));

    expect(await screen.findByText("Google Analytics")).toBeVisible();
    expect(screen.getByText("Servicio observado · declaración sin comprobar")).toBeVisible();
    expect(screen.getByText(/www\.google-analytics\.com/u)).toBeVisible();
    expect(screen.queryByText("Servicio observado · sin finalidad declarada")).toBeNull();
  });

  it("shows a consent failure when the legal link is only in the footer", async () => {
    const report = {
      ...SCORED_PUBLIC_REPORT,
      firstEntryPolicyAccess: {
        policyVersion: "first-entry-policy-access-v1",
        status: "fail",
        reasonCode: "consent_link_missing",
        consentPromptDetected: true,
        thirdPartyCookieDetected: true,
        nonEssentialThirdPartyStorageDetected: true,
        linkLocation: "none",
        link: null,
        documentAccess: "not_checked",
      },
    };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({
      hostname: "example.com", enrollment: "on_demand", state: "fresh", failureCode: null,
      activeJobId: null, lastReport: report, checkedAt: "2026-11-03T10:01:00.000Z",
    })));
    const user = userEvent.setup();
    render(<PublicScanPortal />);
    await user.type(screen.getByRole("textbox", { name: DOMAIN_INPUT_NAME }), "https://example.com/");
    await user.click(screen.getByRole("button", { name: SEARCH_BUTTON_NAME }));

    expect(await screen.findByRole("heading", { name: "Acceso a información legal" })).toBeVisible();
    expect(screen.getByText("Comprobación incumplida")).toBeVisible();
    expect(screen.getByText(/el aviso de consentimiento no contiene un enlace visible/i)).toBeVisible();
    expect(screen.getByText("Cookie de terceros").parentElement).toHaveTextContent("Detectada");
  });

  it("shows a footer link as valid only when no consent and no third-party cookies were observed", async () => {
    const report = {
      ...SCORED_PUBLIC_REPORT,
      firstEntryPolicyAccess: {
        policyVersion: "first-entry-policy-access-v1",
        status: "pass",
        reasonCode: "footer_link_accessible_without_consent",
        consentPromptDetected: false,
        thirdPartyCookieDetected: false,
        nonEssentialThirdPartyStorageDetected: true,
        linkLocation: "footer",
        link: { hostname: "example.com", path: "/privacy", kind: "privacy" },
        documentAccess: "accessible",
        policyLinkVisit: {
          status: "evaluated",
          link: { hostname: "example.com", path: "/privacy", kind: "privacy" },
          documentAccess: "accessible",
          navigationStartedAtMs: 40,
          beforeNavigation: { capturedAtMs: 30, cookies: [], storageKeys: [], cookieReadComplete: true, storageReadComplete: true },
          afterNavigation: {
            capturedAtMs: 180,
            cookies: [{ name: "grumphya_anon", domain: "example.com", secure: true, httpOnly: true, sameSite: "Strict", expiresAtUnixSeconds: Date.parse("2027-12-29T00:00:00Z") / 1000 }],
            storageKeys: [], cookieReadComplete: true, storageReadComplete: true,
          },
        },
      },
    };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({
      hostname: "example.com", enrollment: "on_demand", state: "fresh", failureCode: null,
      activeJobId: null, lastReport: report, checkedAt: "2026-11-03T10:01:00.000Z",
    })));
    const user = userEvent.setup();
    render(<PublicScanPortal />);
    await user.type(screen.getByRole("textbox", { name: DOMAIN_INPUT_NAME }), "https://example.com/");
    await user.click(screen.getByRole("button", { name: SEARCH_BUTTON_NAME }));

    expect(await screen.findByRole("heading", { name: "Acceso a información legal" })).toBeVisible();
    expect(screen.getByText("Enlace comprobado")).toBeVisible();
    expect(screen.getByText(/no se solicitó consentimiento ni se detectaron cookies de terceros/i)).toBeVisible();
    expect(screen.getByText("Estado observado al abrir el enlace en un contexto nuevo")).toBeVisible();
    await user.click(screen.getByText("Estado observado al abrir el enlace en un contexto nuevo"));
    expect(screen.getByText(/Cookie grumphya_anon · example.com · Secure · HttpOnly · SameSite=Strict · expira 2027-12-29/iu)).toBeVisible();
    expect(screen.getByText(/se identificó almacenamiento de terceros no esencial.*hallazgo independiente/i)).toBeVisible();
    expect(screen.getByRole("link", { name: "example.com/privacy" })).toHaveAttribute("href", "https://example.com/privacy");
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
      "https://example.com/",
    );
    await user.click(screen.getByRole("button", { name: SEARCH_BUTTON_NAME }));
    await user.click(
      await screen.findByRole("checkbox", {
        name: /tengo autorización para solicitar este análisis/i,
      }),
    );
    await user.click(screen.getByRole("button", { name: "Solicitar análisis" }));
    expect(await screen.findByRole("progressbar", { name: "Progreso del análisis" }))
      .toHaveAttribute("data-phase", "queued");

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
          globalAssessment: PUBLIC_REPORT.globalAssessment,
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
      "https://example.com/",
    );
    await user.click(screen.getByRole("button", { name: SEARCH_BUTTON_NAME }));

    expect(await screen.findByText("Histórico")).toBeVisible();
    const terminalCategorySummaries = [...document.querySelectorAll(".ds-portal__category-summary")]
      .map((element) => element.textContent ?? "");
    expect(terminalCategorySummaries).toHaveLength(4);
    expect(terminalCategorySummaries.join(" ")).not.toMatch(/aún se está comprobando|todavía no ha terminado|sigue en comprobación/i);
    expect(screen.getByRole("heading", { name: "Historial de observaciones" })).toBeVisible();
    expect(screen.getByText("1 informe")).toBeVisible();
    expect(screen.getByRole("heading", { name: "Qué significa esta valoración" })).toBeVisible();
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
    expect(screen.getAllByText(/Comprobación incompleta por un error técnico del auditor/i).length).toBeGreaterThan(0);
    await user.click(screen.getByRole("button", { name: "Cerrar detalle" }));
    await user.click(categoryButtons[2]);
    expect(screen.getAllByText(/Comprobación incompleta por un error técnico/i).length).toBeGreaterThan(0);
    expect(screen.getByText("100/100 provisional · 1 de 4 aspectos evaluados"))
      .toBeVisible();
    expect(screen.getAllByText(/qué implica:/i)).toHaveLength(4);
    expect(screen.getAllByText("Sin datos suficientes").length).toBeGreaterThan(0);
    expect(screen.getByText(/origen indicado en el registro/i)).toBeVisible();
    expect(screen.getByRole("heading", { name: "Privacidad" })).toBeVisible();
    expect(screen.getByRole("heading", { name: "Ética" })).toBeVisible();
    expect(screen.getByRole("heading", { name: "Rendimiento" })).toBeVisible();
    expect(screen.getByRole("region", { name: "Niveles de evaluación" })).toBeVisible();
    expect(screen.getByRole("img", { name: "Puntuación global: no disponible en este informe" })).toBeVisible();
    expect(screen.getByRole("heading", { name: "Qué significa esta valoración" })).toBeVisible();
    expect(document.querySelector(".ds-portal__score-ring")).toHaveAttribute("data-score-band", "unknown");
    expect(document.querySelectorAll('.ds-portal__category-score-ring[data-score-band="excellent"]')).toHaveLength(1);
    expect(screen.getByRole("img", { name: "Ética: sin puntuación; 0 de 2 aspectos evaluados" })).toBeVisible();
    expect(screen.getByRole("img", { name: "Privacidad: sin puntuación; 0 de 1 aspectos evaluados" })).toBeVisible();
    expect(screen.getByRole("img", { name: "Seguridad: 100 de 100 puntos; 1 de 4 aspectos evaluados" })).toBeVisible();
    expect(screen.getByRole("img", { name: "Rendimiento: sin puntuación; 0 de 1 aspectos evaluados" })).toBeVisible();
    expect(screen.getByRole("img", { name: "Observado: 1 de 8 criterios (13%)" })).toBeVisible();
    expect(screen.getByRole("img", { name: "No observado: 0 de 8 criterios (0%)" })).toBeVisible();
    expect(screen.getByRole("img", { name: "En revisión: 7 de 8 criterios (88%)" })).toBeVisible();
    expect(screen.getByText(/instrucciones que ayudan al navegador a proteger/i)).toBeVisible();
    expect(screen.getByText("Política que restringe contenido cargado (CSP)")).toBeInTheDocument();
    expect(screen.getByText(/faltaba.*política de contenido CSP/i)).toBeVisible();
    expect(screen.getByText("Ver evidencias técnicas (1 comprobación)")).toBeVisible();

    const summary = screen.getByRole("heading", { name: "Qué significa esta valoración" });
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
    const ethicsScore = score * 2 - SCORED_PUBLIC_REPORT.privacyAssessment.score;
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        Response.json({
          ...SCORED_PUBLIC_REPORT,
          globalAssessment: {
            ...SCORED_PUBLIC_REPORT.globalAssessment,
            status: "scored",
            score,
          },
          ethicsAssessment: { ...SCORED_PUBLIC_REPORT.ethicsAssessment, score: ethicsScore },
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

  it("shows separate dimension scores and no combined number while the global score is under review", async () => {
    const reviewReport = {
      ...SCORED_PUBLIC_REPORT,
      globalAssessment: {
        ...SCORED_PUBLIC_REPORT.globalAssessment,
        status: "review",
        score: null,
        ethicsCoverage: { assessedCriteria: 7, totalCriteria: 8 },
        privacyCoverage: {
          assessedCriteria: 3,
          unknownCriteria: 1,
          notApplicableCriteria: 1,
          totalCriteria: 5,
        },
      },
      privacyAssessment: {
        ...SCORED_PUBLIC_REPORT.privacyAssessment,
        unknownCriteria: 1,
        notApplicableCriteria: 1,
        criteria: SCORED_PUBLIC_REPORT.privacyAssessment.criteria.map((criterion) =>
          criterion.id === "contextual-excess"
            ? { ...criterion, status: "unknown", deduction: null, awarded: null }
            : criterion.id === "vendor-controls"
              ? { ...criterion, status: "not_applicable" }
              : criterion,
        ),
      },
      ethicsAssessment: {
        ...SCORED_PUBLIC_REPORT.ethicsAssessment,
        assessedCriteria: 7,
        criteria: SCORED_PUBLIC_REPORT.ethicsAssessment.criteria.map((criterion) => criterion.id === "initial-cookie-risk"
          ? { ...criterion, status: "unknown" }
          : criterion),
      },
    };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json(reviewReport)));
    window.history.replaceState({}, "", `/?report=${REPORT_ID}`);

    render(<PublicScanPortal />);

    expect(await screen.findByRole("img", { name: "Puntuación global: en revisión" })).toBeVisible();
    expect(screen.getByText("El informe terminó con comprobaciones sin completar.")).toBeVisible();
    expect(screen.getAllByText("No se pudo completar esta comprobación.").length).toBeGreaterThan(0);
    expect(screen.queryByText(/aún se está comprobando/i)).toBeNull();
    expect(screen.getAllByText("Ética", { exact: true }).length).toBeGreaterThan(0);
    expect(screen.queryByText(/50\s*%/)).toBeNull();
    expect(screen.getByRole("img", { name: /Ética:/u })).toBeVisible();
    expect(screen.getByRole("img", { name: /Privacidad:/u })).toBeVisible();
    expect(screen.queryByText("90/100 · 50 % Ética + 50 % Privacidad")).toBeNull();
    expect(screen.getByText(/La nota global combina por igual Ética y Privacidad/i)).toBeVisible();
  });

  it("loads a current v6 result from the hero search with a decimal privacy score", async () => {
    const ethicsStatuses: Record<string, string> = {
      "dns-integrity": "pass",
      "transport-security": "pass",
      "http-availability": "pass",
      "security-headers": "fail",
      "third-party-data-use": "fail",
      "initial-cookie-risk": "fail",
      tracking: "fail",
      performance: "pass",
    };
    const v6Criteria = SCORED_PUBLIC_REPORT.ethicsAssessment.criteria.map((criterion) => ({
      ...criterion,
      id: criterion.id === "third-party-data-use" ? "external-service-transparency" : criterion.id,
      status: ethicsStatuses[criterion.id] ?? criterion.status,
    }));
    const privacyCriteria = SCORED_PUBLIC_REPORT.privacyAssessment.criteria.map((criterion) => {
      switch (criterion.id) {
        case "preference-before-tracking":
          return { ...criterion, deduction: 1.5, awarded: 28.5, confirmedFindings: 3, unknownFindings: 4 };
        case "contextual-excess":
          return { ...criterion, status: "evaluated", deduction: 0, awarded: 10, confirmedFindings: 0, unknownFindings: 1 };
        case "choice-parity":
          return { ...criterion, deduction: 0, awarded: 20, confirmedFindings: 0, unknownFindings: 0 };
        case "rejection-persistence":
          return { ...criterion, deduction: 2, awarded: 18, confirmedFindings: 2, unknownFindings: 1 };
        default:
          return { ...criterion, status: "unknown", deduction: null, awarded: null };
      }
    });
    const legalFinding = {
      ruleId: "lssi-cookie-no-prior-consent-v1",
      ruleVersion: "1.0.0",
      status: "accredited",
      title: "Cookie analítica antes del consentimiento",
      description: "La evidencia cumple la regla jurídica configurada.",
      jurisdiction: "ES",
      articles: ["22.2", "38.4.g", "39.1.c", "43.1"].map((article) => ({
        law: "LSSI",
        article,
        url: "https://www.boe.es/buscar/act.php?id=BOE-A-2002-13758",
      })),
      infringementClass: "minor",
      sanction: { type: "statutory_maximum", currency: "EUR", maximum: 30000 },
      authority: "Agencia Española de Protección de Datos",
      evidence: [{
        flow: "initial",
        phase: "before_choice",
        capturedAtMs: 1000,
        cookieName: "_ga",
        cookieDomain: "example.com",
        provider: "Google Analytics",
        purpose: "Identificador de cliente para analítica.",
        attributionRuleId: "google-analytics-cookie-ga-v1",
        correlatedRequestHosts: ["www.googletagmanager.com"],
      }],
      evidenceComplete: true,
    };
    const report = {
      ...SCORED_PUBLIC_REPORT,
      profileVersion: "domain-v4",
      scannerVersion: "domain-v4-network-adapter-7",
      verdict: "fail",
      globalAssessment: {
        ...SCORED_PUBLIC_REPORT.globalAssessment,
        status: "scored",
        score: 0,
        legalViolationAccredited: true,
        ethicsCoverage: { assessedCriteria: 8, totalCriteria: 8 },
        privacyCoverage: { assessedCriteria: 4, unknownCriteria: 1, notApplicableCriteria: 0, totalCriteria: 5 },
      },
      ethicsAssessment: {
        ...SCORED_PUBLIC_REPORT.ethicsAssessment,
        policyVersion: "domain-ethics-v6",
        score: 55,
        criteria: v6Criteria,
      },
      privacyAssessment: {
        ...SCORED_PUBLIC_REPORT.privacyAssessment,
        score: 95.63,
        assessedCriteria: 4,
        unknownCriteria: 1,
        notApplicableCriteria: 0,
        criteria: privacyCriteria,
      },
      publicServiceComparison: {
        policyVersion: "public-service-comparison-v1",
        status: "fail",
        reasonCode: "public_policy_missing",
        items: [],
      },
      legalCookieFindings: [legalFinding],
      checks: SCORED_PUBLIC_REPORT.checks.map((check) => ({
        ...check,
        status: check.controlId === "DS-HDR-01" ? "fail" : check.status,
      })),
    };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({
      hostname: "example.com",
      enrollment: "on_demand",
      state: "fresh",
      failureCode: null,
      activeJobId: null,
      lastReport: report,
      checkedAt: "2026-11-03T10:01:00.000Z",
    })));
    const user = userEvent.setup();

    render(<PublicScanPortal />);
    await user.type(screen.getByRole("textbox", { name: DOMAIN_INPUT_NAME }), "https://example.com/");
    await user.click(screen.getByRole("button", { name: SEARCH_BUTTON_NAME }));

    expect(await screen.findByRole("heading", { name: "Qué significa esta valoración" })).toBeVisible();
    expect(screen.getByRole("img", { name: "Puntuación global: 0 de 100 puntos" })).toBeVisible();
    expect(screen.getByText("95.63/100 · 4 de 5 criterios evaluados · 1 desconocidos · 0 no aplican")).toBeVisible();
    expect(screen.getByRole("img", { name: "Ética: 0 de 100 puntos; 2 de 2 aspectos evaluados" })).toBeVisible();
    expect(screen.getByRole("img", { name: "Privacidad: 0 de 100 puntos; 1 de 1 aspectos evaluados" })).toBeVisible();
    expect(screen.getByRole("img", { name: "Seguridad: 71 de 100 puntos; 4 de 4 aspectos evaluados" })).toBeVisible();
    expect(screen.getByRole("img", { name: "Rendimiento: 100 de 100 puntos; 1 de 1 aspectos evaluados" })).toBeVisible();
  });

  it("uses active wording only while the domain status is updating", async () => {
    const reviewReport = {
      ...SCORED_PUBLIC_REPORT,
      globalAssessment: {
        ...SCORED_PUBLIC_REPORT.globalAssessment,
        status: "review",
        score: null,
        ethicsCoverage: { assessedCriteria: 7, totalCriteria: 8 },
        privacyCoverage: { assessedCriteria: 3, unknownCriteria: 1, notApplicableCriteria: 1, totalCriteria: 5 },
      },
      ethicsAssessment: {
        ...SCORED_PUBLIC_REPORT.ethicsAssessment,
        assessedCriteria: 7,
        criteria: SCORED_PUBLIC_REPORT.ethicsAssessment.criteria.map((criterion) => criterion.id === "initial-cookie-risk"
          ? { ...criterion, status: "unknown" }
          : criterion),
      },
      privacyAssessment: {
        ...SCORED_PUBLIC_REPORT.privacyAssessment,
        unknownCriteria: 1,
        notApplicableCriteria: 1,
        criteria: SCORED_PUBLIC_REPORT.privacyAssessment.criteria.map((criterion) => criterion.id === "contextual-excess"
          ? { ...criterion, status: "unknown", deduction: null, awarded: null }
          : criterion.id === "vendor-controls"
            ? { ...criterion, status: "not_applicable" }
            : criterion),
      },
    };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({
      hostname: "example.com",
      enrollment: "on_demand",
      state: "updating",
      failureCode: null,
      activeJobId: "123e4567-e89b-42d3-a456-426614174001",
      lastReport: reviewReport,
      checkedAt: "2026-11-03T10:01:00.000Z",
    })));
    const user = userEvent.setup();
    render(<PublicScanPortal />);
    await user.type(screen.getByRole("textbox", { name: DOMAIN_INPUT_NAME }), "https://example.com/");
    await user.click(screen.getByRole("button", { name: SEARCH_BUTTON_NAME }));

    expect(await screen.findByText("La revisión sigue en curso.")).toBeVisible();
    expect(screen.getAllByText("Esta comprobación está en curso.").length).toBeGreaterThan(0);
  });

  it("shows an accredited legal cookie finding and fixes the global score at zero", async () => {
    const legalReport = {
      ...SCORED_PUBLIC_REPORT,
      globalAssessment: {
        ...SCORED_PUBLIC_REPORT.globalAssessment,
        score: 0,
        legalViolationAccredited: true,
      },
      legalCookieFindings: [{
        ruleId: "lssi-cookie-no-prior-consent-v1",
        ruleVersion: "1.0.0",
        status: "accredited",
        title: "Cookie no esencial antes del consentimiento",
        description: "Se observó una cookie de analítica antes de que se eligiera una opción.",
        jurisdiction: "ES",
        articles: ["22.2", "38.4.g", "39.1.c", "43.1"].map((article) => ({
          law: "LSSI",
          article,
          url: "https://www.boe.es/buscar/act.php?id=BOE-A-2002-13758",
        })),
        infringementClass: "minor",
        sanction: { type: "statutory_maximum", currency: "EUR", maximum: 30000 },
        authority: "Agencia Española de Protección de Datos",
        evidence: [{
          flow: "initial",
          phase: "before_choice",
          capturedAtMs: 250,
          cookieName: "_ga",
          cookieDomain: "example.com",
          provider: "Google Analytics",
          purpose: "analytics",
          attributionRuleId: "google-analytics-ga-v1",
          correlatedRequestHosts: ["www.google-analytics.com"],
          auditBlockedRequestHosts: ["region1.google-analytics.com"],
        }],
        evidenceComplete: true,
      }],
    };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json(legalReport)));
    window.history.replaceState({}, "", `/?report=${REPORT_ID}`);

    render(<PublicScanPortal />);

    expect(await screen.findByRole("img", { name: "Puntuación global: 0 de 100 puntos" })).toBeVisible();
    expect(screen.getByText("Incumplimientos legales acreditados")).toBeVisible();
    expect(screen.getByText("Cookie no esencial antes del consentimiento")).toBeVisible();
    expect(screen.getByText(/LSSI, artículos 22.2, 38.4.g, 39.1.c, 43.1/u)).toBeVisible();
    expect(screen.getByText(/bloqueada por el auditor antes de transmitirse/u)).toBeVisible();
    expect(screen.getByText(/la puntuación global es 0\/100/i)).toBeVisible();
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
      "https://example.com/",
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
      body: JSON.stringify({ authorized: true, targetUrl: "https://example.com/" }),
    });
    expect(await screen.findByRole("progressbar", { name: "Progreso del análisis" }))
      .toHaveAttribute("data-phase", "queued");
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
      "https://example.com/",
    );
    await user.click(screen.getByRole("button", { name: SEARCH_BUTTON_NAME }));

    expect(await screen.findByText(/no se pudo completar la conexión pública/i)).toBeVisible();
    await user.click(
      screen.getByRole("checkbox", {
        name: /tengo autorización para solicitar este análisis/i,
      }),
    );
    await user.click(screen.getByRole("button", { name: "Solicitar análisis" }));
    expect(await screen.findByRole("progressbar", { name: "Progreso del análisis" }))
      .toHaveAttribute("data-phase", "queued");
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
      "https://example.com/",
    );
    await user.click(screen.getByRole("button", { name: SEARCH_BUTTON_NAME }));

    const progress = await screen.findByRole("progressbar", {
      name: "Progreso del análisis",
    });
    expect(progress).toHaveAttribute(
      "aria-valuetext",
      expect.stringContaining("no hay un porcentaje fiable"),
    );
    expect(progress).not.toHaveAttribute("aria-valuenow");
  });

  it("accepts and labels a transport-v1 report", async () => {
    const transportReport = {
          ...SCORED_PUBLIC_REPORT,
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
          { id: "third-party-data-use", label: "Transparencia sobre servicios externos", status: "unknown", weight: 10 },
          { id: "initial-cookie-risk", label: "Cookies conocidas en la respuesta inicial", status: "fail", weight: 10 },
          { id: "tracking", label: "Rastreadores y mapas de calor", status: "unknown", weight: 5 },
          { id: "performance", label: "Rendimiento", status: "unknown", weight: 5 },
        ],
        reasons: ["Cookies conocidas en la respuesta inicial: el control observado presenta fallos."],
      },
      globalAssessment: {
        ...PUBLIC_REPORT.globalAssessment,
        ethicsCoverage: { assessedCriteria: 2, totalCriteria: 8 },
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
      globalAssessment: {
        ...PUBLIC_REPORT.globalAssessment,
        ethicsCoverage: { assessedCriteria: 4, totalCriteria: 8 },
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
      "https://example.com/",
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
      "https://example.com/",
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
      "https://example.com/",
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
    await user.type(screen.getByRole("textbox", { name: DOMAIN_INPUT_NAME }), "https://example.com/");
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
      "https://example.com/",
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
      "https://example.com/",
    );
    await user.click(screen.getByRole("button", { name: SEARCH_BUTTON_NAME }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      RATE_LIMIT_MESSAGE,
    );
    expect(screen.queryByText("rate_limited")).not.toBeInTheDocument();
  });

  it("rejects HTTP URLs instead of auditing an insecure URL", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();

    render(<PublicScanPortal />);
    await user.type(
      screen.getByRole("textbox", { name: DOMAIN_INPUT_NAME }),
      "http://example.com/path",
    );
    await user.click(screen.getByRole("button", { name: SEARCH_BUTTON_NAME }));

    expect(fetchMock).not.toHaveBeenCalled();
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Escribe una URL HTTPS pública completa",
    );
  });

  it("associates an invalid domain with its input and returns focus to it", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();

    render(<PublicScanPortal />);
    const input = screen.getByRole("textbox", { name: DOMAIN_INPUT_NAME });
    await user.type(input, "https://127.0.0.1/ruta");
    await user.click(screen.getByRole("button", { name: SEARCH_BUTTON_NAME }));

    expect(input).toHaveAttribute("aria-invalid", "true");
    expect(input).toHaveAttribute(
      "aria-errormessage",
      "ds-portal-domain-error",
    );
    expect(screen.getByText("Escribe una URL HTTPS pública completa, por ejemplo https://ejemplo.es/servicio.")).toHaveAttribute(
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
      fireEvent.change(input, { target: { value: "https://example.com/" } });
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
      "Tu solicitud está en cola. Te avisaremos cuando empiece la comprobación.",
      { exact: true },
    );
    expect(announcement).toHaveAttribute("aria-live", "polite");

    await act(async () => {
      await vi.advanceTimersByTimeAsync(5_000);
    });
    expect(announcement).toHaveTextContent("La comprobación del dominio está en curso");
    const firstRunningAnnouncement = announcement.textContent;

    await act(async () => {
      await vi.advanceTimersByTimeAsync(5_000);
    });
    expect(announcement.textContent).toBe(firstRunningAnnouncement);
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });

  it("shows a spinner while the analysis request is being registered", async () => {
    let resolveRequest!: (response: Response) => void;
    const pendingRequest = new Promise<Response>((resolve) => {
      resolveRequest = resolve;
    });
    vi.stubGlobal("fetch", vi.fn()
      .mockResolvedValueOnce(Response.json({
        hostname: "example.com", enrollment: "on_demand", state: "not_scanned",
        activeJobId: null, failureCode: null, lastReport: null,
        checkedAt: "2026-11-03T08:00:00.000Z",
      }))
      .mockReturnValueOnce(pendingRequest));
    const user = userEvent.setup();
    render(<PublicScanPortal />);
    await user.type(screen.getByRole("textbox", { name: DOMAIN_INPUT_NAME }), "https://example.com/");
    await user.click(screen.getByRole("button", { name: SEARCH_BUTTON_NAME }));
    await user.click(screen.getByRole("checkbox", { name: /tengo autorización/i }));
    await user.click(screen.getByRole("button", { name: "Solicitar análisis" }));

    const progress = await screen.findByRole("progressbar", { name: "Progreso del análisis" });
    expect(progress).toHaveAttribute("data-phase", "submitting");
    expect(progress).toHaveAttribute("aria-busy", "true");
    expect(progress.querySelector(".ds-portal__spinner")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Solicitar análisis" })).not.toBeInTheDocument();

    await act(async () => {
      resolveRequest(Response.json({ hostname: "example.com", state: "queued" }, { status: 202 }));
      await Promise.resolve();
    });
  });
});
