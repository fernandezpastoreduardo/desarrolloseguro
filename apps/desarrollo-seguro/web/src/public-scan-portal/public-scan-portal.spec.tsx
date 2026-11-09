import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PublicScanPortal } from "../index.js";

const DOMAIN_INPUT_NAME = "Dominio que quieres consultar";
const SEARCH_BUTTON_NAME = "Consultar informe";
const STATUS_ENDPOINT = "/api/desarrollo-seguro/v1/domains/example.com/status";
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
    },
  ],
};

describe("PublicScanPortal", () => {
  afterEach(() => {
    cleanup();
    window.history.replaceState({}, "", "/");
    vi.unstubAllGlobals();
  });

  it("shows an honest empty state when the API reports that a domain has not been scanned", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      Response.json({
        hostname: "example.com",
        enrollment: "on_demand",
        state: "not_scanned",
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

    expect(fetchMock).toHaveBeenCalledWith(STATUS_ENDPOINT, {
      headers: { Accept: "application/json" },
      method: "GET",
      credentials: "omit",
      cache: "no-store",
    });
    expect(
      await screen.findByRole("heading", { name: "Aún no hay un informe" }),
    ).toBeVisible();
    expect(
      screen.getByText(/esta consulta no inicia un análisis/i),
    ).toBeVisible();
  });

  it("shows the stored checks and makes a stale report visibly historical", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      Response.json({
        hostname: "example.com",
        enrollment: "on_demand",
        state: "stale",
        activeJobId: null,
        lastReport: PUBLIC_REPORT,
        checkedAt: "2026-11-03T08:10:00.000Z",
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

    expect(await screen.findByText("Histórico")).toBeVisible();
    expect(screen.getByText(REPORT_SUMMARY)).toBeVisible();
    expect(screen.getByText(/solo se observó la portada/i)).toBeVisible();
    expect(screen.getByText(/origen indicado en el registro/i)).toBeVisible();
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

    render(<PublicScanPortal />);

    expect(await screen.findByText(unsafeSummary)).toBeVisible();
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
});
