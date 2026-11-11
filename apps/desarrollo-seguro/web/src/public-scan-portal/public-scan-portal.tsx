import { type FormEvent, useEffect, useRef, useState } from "react";
import "./public-scan-portal.css";

const API_ROOT = "/api/desarrollo-seguro/v1";
const DOMAIN_INPUT_ID = "public-scan-domain";
const SEARCH_BUTTON_TEXT = "Consultar informe";
const EMPTY_REPORT_TITLE = "Aún no hay un informe";
const GENERIC_ERROR =
  "No se ha podido consultar el informe. Inténtalo de nuevo más tarde.";
const RATE_LIMIT_MESSAGE =
  "Has hecho varias consultas seguidas. Espera un minuto y vuelve a intentarlo.";
const INVALID_DOMAIN_MESSAGE =
  "Escribe un dominio válido, por ejemplo ejemplo.es.";
const NO_REPORT_MESSAGE =
  "Todavía no hay un informe completo guardado para este dominio.";
const UPDATING_WITHOUT_REPORT_MESSAGE =
  "Hay una actualización en curso. Vuelve a consultar dentro de un momento.";
const UNAVAILABLE_DOMAIN_MESSAGE =
  "Este dominio no está disponible para consulta pública.";
const ANALYSIS_REQUEST_MESSAGES: Record<string, string> = {
  queued: "Solicitud añadida a la cola de análisis.",
  running: "El análisis de este dominio ya está en curso.",
  cached: "Ya hay un informe reciente disponible. Vuelve a consultar el dominio.",
  rate_limited: "Ya se solicitó un análisis para este dominio en las últimas 24 horas.",
  capacity_reached: "La cola de análisis está completa. Inténtalo más tarde.",
  unavailable: "Este dominio no está disponible para análisis.",
  error: "No se ha podido registrar la solicitud. Inténtalo más tarde.",
  poll_error:
    "No se pudo actualizar el estado automáticamente. Consulta el dominio de nuevo dentro de un momento.",
  poll_timeout:
    "Todavía no hay un informe nuevo. Consulta el dominio de nuevo dentro de un momento.",
};
const ANALYSIS_REQUEST_STATES = [
  "queued",
  "running",
  "cached",
  "rate_limited",
  "capacity_reached",
  "unavailable",
] as const;
const ACCEPT_JSON_HEADER = "application/json";
const RETRY_AFTER_HEADER = "Retry-After";
const MAX_RETRY_AFTER_SECONDS = 3_600;
const ANALYSIS_STATUS_POLL_INTERVAL_MS = 5_000;
const MAX_ANALYSIS_STATUS_POLLS = 24;
const REPORT_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const DOMAIN_STATES = [
  "fresh",
  "updating",
  "stale",
  "not_scanned",
  "unavailable",
] as const;
const ENROLLMENTS = ["monitored", "on_demand"] as const;
const PROFILE_VERSIONS = [
  "controls-v1",
  "controls-v2",
  "controls-v3",
  "transport-v1",
] as const;
const SCAN_VERDICTS = ["pass", "fail", "inconclusive"] as const;
const SCAN_TRIGGERS = ["scheduled", "requested"] as const;
const CHECK_STATUSES = ["pass", "fail", "unknown", "not_applicable"] as const;
const CHECK_SEVERITIES = ["critical", "high", "medium", "low", "info"] as const;
const CHECK_METHODS = ["DNS", "TLS", "GET", "HEAD"] as const;
const PUBLIC_SCOPE_PATHS = ["/", "/precios", "/informe"] as const;
const MAX_REPORT_CHECKS = 32;

type PortalState = "idle" | "loading" | "ready" | "error";
type AnalysisRequestState =
  | (typeof ANALYSIS_REQUEST_STATES)[number]
  | "loading"
  | "error"
  | "poll_error"
  | "poll_timeout";
type DomainState = (typeof DOMAIN_STATES)[number];
type Enrollment = (typeof ENROLLMENTS)[number];
type ProfileVersion = (typeof PROFILE_VERSIONS)[number];
type ScanVerdict = (typeof SCAN_VERDICTS)[number];
type ScanTrigger = (typeof SCAN_TRIGGERS)[number];
type CheckStatus = (typeof CHECK_STATUSES)[number];
type CheckSeverity = (typeof CHECK_SEVERITIES)[number];
type PublicCheck = {
  controlId: string;
  status: CheckStatus;
  required: boolean;
  severity: CheckSeverity;
  observedAt: string;
  targetPath: string;
  method: string;
  summary: string;
  limitation: string;
};
type PublicReport = {
  id: string;
  hostname: string;
  profileVersion: ProfileVersion;
  scannerVersion: string;
  vantage: "same_vps";
  trigger: ScanTrigger;
  startedAt: string;
  completedAt: string;
  expiresAt: string;
  verdict: ScanVerdict;
  ethicsAssessment: {
    policyVersion: "domain-ethics-v1";
    score: number | null;
    assessedCriteria: number;
    totalCriteria: number;
    maturity: "preliminary" | "partial" | "broad";
    criteria: Array<{
      id: string;
      label: string;
      status: CheckStatus;
      weight: number;
    }>;
    reasons: string[];
    interpretation: string;
  };
  scope: string[];
  checks: PublicCheck[];
};
type DomainStatus = {
  hostname: string;
  enrollment: Enrollment;
  state: DomainState;
  activeJobId: string | null;
  lastReport: PublicReport | null;
  checkedAt: string;
};

const STATE_LABELS: Record<string, string> = {
  fresh: "Informe vigente",
  updating: "Actualización en curso",
  stale: "Informe histórico",
  not_scanned: "Sin informe",
  unavailable: "Dominio no disponible",
};
const VERDICT_LABELS: Record<string, string> = {
  pass: "Controles observados aprobados",
  fail: "Hay controles observados que no se cumplen",
  inconclusive: "Resultado no concluyente",
};

export function PublicScanPortal() {
  const reportId = getReportIdFromLocation();
  const [domain, setDomain] = useState("");
  const [state, setState] = useState<PortalState>("idle");
  const [status, setStatus] = useState<DomainStatus | null>(null);
  const [report, setReport] = useState<PublicReport | null>(null);
  const [message, setMessage] = useState("");
  const [darkTheme, setDarkTheme] = useState(false);
  const [authorizationConfirmed, setAuthorizationConfirmed] = useState(false);
  const [analysisRequestState, setAnalysisRequestState] =
    useState<AnalysisRequestState | null>(null);
  const analysisStatusPollCount = useRef(0);
  const reportBeforeAnalysisId = useRef<string | null>(null);

  useEffect(() => {
    if (reportId) void loadReport(reportId);
  }, [reportId]);

  useEffect(() => {
    if (
      !status ||
      (analysisRequestState !== "queued" && analysisRequestState !== "running")
    ) {
      return;
    }

    const controller = new AbortController();
    let pollTimer: number | undefined;

    const pollStatus = async () => {
      analysisStatusPollCount.current += 1;
      try {
        const response = await fetch(
          `${API_ROOT}/domains/${encodeURIComponent(status.hostname)}/status`,
          {
            method: "GET",
            headers: { Accept: ACCEPT_JSON_HEADER },
            credentials: "omit",
            cache: "no-store",
            signal: controller.signal,
          },
        );
        if (!response.ok) throw new Error("invalid_status_response");
        const payload: unknown = await readPublicJson(response);
        if (!isDomainStatus(payload)) throw new Error("invalid_status_response");

        setStatus(payload);
        setReport(payload.lastReport);
        if (
          payload.lastReport &&
          payload.lastReport.id !== reportBeforeAnalysisId.current
        ) {
          setAnalysisRequestState(null);
          return;
        }
        if (payload.state === "unavailable") {
          setAnalysisRequestState("unavailable");
          return;
        }

        if (analysisStatusPollCount.current >= MAX_ANALYSIS_STATUS_POLLS) {
          setAnalysisRequestState("poll_timeout");
          return;
        }
        pollTimer = window.setTimeout(
          () => void pollStatus(),
          ANALYSIS_STATUS_POLL_INTERVAL_MS,
        );
      } catch {
        if (!controller.signal.aborted) setAnalysisRequestState("poll_error");
      }
    };

    pollTimer = window.setTimeout(
      () => void pollStatus(),
      ANALYSIS_STATUS_POLL_INTERVAL_MS,
    );

    return () => {
      controller.abort();
      if (pollTimer !== undefined) window.clearTimeout(pollTimer);
    };
  }, [analysisRequestState, status]);

  async function loadReport(id: string) {
    setState("loading");
    setMessage("");
    setStatus(null);
    let publicError = GENERIC_ERROR;
    try {
      const response = await fetch(
        `${API_ROOT}/reports/${encodeURIComponent(id)}`,
        {
          method: "GET",
          headers: { Accept: ACCEPT_JSON_HEADER },
          credentials: "omit",
          cache: "no-store",
        },
      );
      if (!response.ok) {
        publicError = getReadErrorMessage(response);
        throw new Error("invalid_report_response");
      }
      const payload: unknown = await readPublicJson(response);
      if (
        !isPublicReport(payload) ||
        payload.id.toLowerCase() !== id.toLowerCase()
      ) {
        throw new Error("invalid_report_response");
      }
      setReport(payload);
      setDomain(payload.hostname);
      setState("ready");
    } catch {
      setReport(null);
      setState("error");
      setMessage(publicError);
    }
  }

  async function submitDomain(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const hostname = normalizeDomainInput(domain);
    if (hostname === null) {
      setState("error");
      setMessage(INVALID_DOMAIN_MESSAGE);
      setStatus(null);
      setReport(null);
      return;
    }

    setDomain(hostname);
    setAuthorizationConfirmed(false);
    setAnalysisRequestState(null);
    setState("loading");
    setMessage("");
    setReport(null);
    let publicError = GENERIC_ERROR;
    try {
      const response = await fetch(
        `${API_ROOT}/domains/${encodeURIComponent(hostname)}/status`,
        {
          method: "GET",
          headers: { Accept: ACCEPT_JSON_HEADER },
          credentials: "omit",
          cache: "no-store",
        },
      );
      if (!response.ok) {
        publicError = getReadErrorMessage(response);
        throw new Error("invalid_status_response");
      }
      const payload: unknown = await readPublicJson(response);
      if (!isDomainStatus(payload)) throw new Error("invalid_status_response");
      setStatus(payload);
      setReport(payload.lastReport);
      setState("ready");
    } catch {
      setStatus(null);
      setReport(null);
      setState("error");
      setMessage(publicError);
    }
  }

  async function requestAnalysis() {
    if (!status || !authorizationConfirmed || state === "loading") return;
    analysisStatusPollCount.current = 0;
    reportBeforeAnalysisId.current = status.lastReport?.id ?? null;
    setAnalysisRequestState("loading");
    try {
      const response = await fetch(
        `${API_ROOT}/domains/${encodeURIComponent(status.hostname)}/analysis-requests`,
        {
          method: "POST",
          headers: {
            Accept: ACCEPT_JSON_HEADER,
            "Content-Type": "application/json",
          },
          credentials: "omit",
          cache: "no-store",
          body: JSON.stringify({ authorized: true }),
        },
      );
      if (!response.ok) throw new Error("invalid_analysis_request_response");
      const payload: unknown = await readPublicJson(response);
      if (
        !isAnalysisRequest(payload) ||
        payload.hostname !== status.hostname
      ) {
        throw new Error("invalid_analysis_request_response");
      }
      setAnalysisRequestState(payload.state);
    } catch {
      setAnalysisRequestState("error");
    }
  }

  return (
    <main className="ds-portal" data-theme={darkTheme ? "dark" : "light"}>
      <a className="ds-portal__skip-link" href="#ds-portal-heading">
        Saltar al contenido
      </a>
      <header className="ds-portal__topbar">
        <a
          className="ds-portal__brand"
          href="/"
          aria-label="Desarrollo Seguro, volver a presentación"
        >
          <span className="ds-portal__brand-name">
            Desarrollo <strong>Seguro</strong>
          </span>
          <span className="ds-portal__brand-note">Consulta de informes</span>
        </a>
        <button
          className="ds-portal__theme"
          type="button"
          onClick={() => setDarkTheme((current) => !current)}
          aria-pressed={darkTheme}
        >
          {darkTheme ? "Tema claro" : "Tema oscuro"}
        </button>
      </header>

      <section className="ds-portal__hero" aria-labelledby="ds-portal-heading">
        <div className="ds-portal__hero-copy">
          <p className="ds-portal__eyebrow">Observación técnica acotada</p>
          <h1 id="ds-portal-heading">¿Qué se ve desde fuera?</h1>
          <p className="ds-portal__intro">
            Consulta el estado y los controles observados de un dominio. Esta
            lectura no inicia un análisis.
          </p>
        </div>
        <form className="ds-portal__search" onSubmit={submitDomain} noValidate>
          <label htmlFor={DOMAIN_INPUT_ID}>Dominio que quieres consultar</label>
          <div className="ds-portal__search-row">
            <input
              id={DOMAIN_INPUT_ID}
              type="text"
              inputMode="url"
              autoComplete="url"
              placeholder="ejemplo.es"
              value={domain}
              onChange={(event) => setDomain(event.currentTarget.value)}
              aria-describedby="ds-portal-help"
            />
            <button type="submit" disabled={state === "loading"}>
              {state === "loading" ? "Consultando…" : SEARCH_BUTTON_TEXT}
            </button>
          </div>
          <span id="ds-portal-help" className="ds-portal__help">
            Solo se consulta información guardada. No se envían solicitudes al
            dominio.
          </span>
        </form>
        <div className="ds-portal__hero-footnote" aria-hidden="true">
          <span>01</span>
          <span>Consulta del estado guardado de un dominio</span>
        </div>
      </section>

      {state === "error" && (
        <div className="ds-portal__notice" role="alert">
          <strong>La consulta no está disponible</strong>
          <p>{message}</p>
        </div>
      )}
      {state === "ready" && status && (
        <DomainResult status={status} report={report} />
      )}
      {state === "ready" && !status && report && (
        <ReportResult report={report} />
      )}
      {status?.state === "updating" && analysisRequestState && (
        <p className="ds-portal__analysis-status" role="status">
          {getAnalysisRequestMessage(analysisRequestState)}
        </p>
      )}
      {isScanInProgress(status, analysisRequestState) && (
        <ScanProgress
          phase={getScanProgressPhase(status, analysisRequestState)}
        />
      )}
      {state === "ready" && status?.state === "not_scanned" && (
        <section
          className="ds-portal__empty"
          aria-labelledby="ds-empty-heading"
        >
          <p className="ds-portal__eyebrow">{status.hostname}</p>
          <h2 id="ds-empty-heading">{EMPTY_REPORT_TITLE}</h2>
          <p>
            Cuando exista un análisis completo, aquí verás su fecha, alcance y
            controles observados.
          </p>
          <p className="ds-portal__disclaimer">
            La consulta solo lee información guardada. Solicitar un análisis
            enviará las comprobaciones GET/HEAD limitadas del perfil, sin
            credenciales, formularios ni exploración de rutas adicionales.
          </p>
          {analysisRequestState === null ? (
            <div className="ds-portal__analysis-request">
              <label>
                <input
                  type="checkbox"
                  checked={authorizationConfirmed}
                  onChange={(event) =>
                    setAuthorizationConfirmed(event.currentTarget.checked)
                  }
                />
                Confirmo que tengo autorización para solicitar este análisis.
              </label>
              <button
                type="button"
                disabled={!authorizationConfirmed}
                onClick={() => void requestAnalysis()}
              >
                Solicitar análisis
              </button>
            </div>
          ) : (
            <p className="ds-portal__analysis-status" role="status">
              {getAnalysisRequestMessage(analysisRequestState)}
            </p>
          )}
        </section>
      )}
      <footer className="ds-portal__footer">
        <p>
          Comprobación técnica acotada desde el mismo VPS. No es una
          certificación independiente.
        </p>
        <a href="/desarrollo-seguro/">Cómo funciona este servicio</a>
      </footer>
    </main>
  );
}

function DomainResult({
  status,
  report,
}: {
  status: DomainStatus;
  report: PublicReport | null;
}) {
  if (!report) {
    if (status.state === "not_scanned") return null;
    return (
      <section className="ds-portal__empty" aria-labelledby="ds-result-heading">
        <p className="ds-portal__eyebrow">{status.hostname}</p>
        <h2 id="ds-result-heading">
          {STATE_LABELS[status.state] ?? "Estado del informe"}
        </h2>
        <p>{getEmptyStateMessage(status.state)}</p>
        {status.state === "updating" && (
          <p className="ds-portal__disclaimer">
            Esta página no se actualiza automáticamente. Vuelve a consultar para
            ver si el informe ya está listo.
          </p>
        )}
      </section>
    );
  }
  return (
    <section className="ds-portal__result" aria-labelledby="ds-result-heading">
      <p className="ds-portal__eyebrow">{status.hostname}</p>
      <h2 id="ds-result-heading">
        {STATE_LABELS[status.state] ?? "Estado del informe"}
      </h2>
      {status.state === "updating" && (
        <p>
          Hay una actualización en curso. El informe anterior se conserva como
          histórico.
        </p>
      )}
      <ReportSummary report={report} state={status.state} />
    </section>
  );
}

function ReportResult({ report }: { report: PublicReport }) {
  return (
    <section className="ds-portal__result" aria-labelledby="ds-result-heading">
      <p className="ds-portal__eyebrow">Informe público · {report.hostname}</p>
      <h2 id="ds-result-heading">Detalle del informe</h2>
      <ReportSummary report={report} state="historical" />
    </section>
  );
}

function ScanProgress({ phase }: { phase: "queued" | "running" }) {
  const description =
    phase === "queued"
      ? "Análisis en cola. El porcentaje de progreso no está disponible."
      : "Análisis en curso. El porcentaje de progreso no está disponible.";

  return (
    <div
      className="ds-portal__scan-progress"
      role="progressbar"
      aria-label="Progreso del análisis"
      aria-valuetext={description}
      data-phase={phase}
    >
      <span className="ds-portal__scan-progress-track" aria-hidden="true">
        <span className="ds-portal__scan-progress-indicator" />
      </span>
      <span className="ds-portal__scan-progress-label">{description}</span>
    </div>
  );
}

function isScanInProgress(
  status: DomainStatus | null,
  requestState: AnalysisRequestState | null,
): boolean {
  return (
    status?.state === "updating" ||
    requestState === "queued" ||
    requestState === "running"
  );
}

function getScanProgressPhase(
  status: DomainStatus | null,
  requestState: AnalysisRequestState | null,
): "queued" | "running" {
  if (requestState === "queued") return "queued";
  if (status?.state === "updating" || requestState === "running") {
    return "running";
  }
  return "queued";
}

function ReportSummary({
  report,
  state,
}: {
  report: PublicReport;
  state: string;
}) {
  const isCurrent = state === "fresh";
  return (
    <>
      <section className="ds-portal__ethics" aria-labelledby="ethics-summary-heading">
        <p className="ds-portal__eyebrow">Resumen del dominio</p>
        <h3 id="ethics-summary-heading">Lectura ética y técnica provisional</h3>
        <p className="ds-portal__ethics-score">
          {report.ethicsAssessment.score === null
            ? "Sin puntuación: faltan controles observables"
            : `${report.ethicsAssessment.score}/100 · ${report.ethicsAssessment.assessedCriteria} de ${report.ethicsAssessment.totalCriteria} criterios evaluados`}
        </p>
        <p>{report.ethicsAssessment.interpretation}</p>
        <ul className="ds-portal__ethics-criteria">
          {report.ethicsAssessment.criteria.map((criterion) => (
            <li key={criterion.id} data-status={criterion.status}>
              <span>{criterion.label}</span>
              <strong>{getCheckStatusLabel(criterion.status)}</strong>
            </li>
          ))}
        </ul>
        {report.ethicsAssessment.reasons.length > 0 && (
          <ul className="ds-portal__ethics-reasons">
            {report.ethicsAssessment.reasons.map((reason) => <li key={reason}>{reason}</li>)}
          </ul>
        )}
      </section>
      <div className="ds-portal__verdict" data-verdict={report.verdict}>
        <span>{isCurrent ? "Vigente" : "Histórico"}</span>
        <strong>
          {VERDICT_LABELS[report.verdict] ?? "Resultado no concluyente"}
        </strong>
      </div>
      <dl className="ds-portal__metadata">
        <div>
          <dt>Última observación</dt>
          <dd>{formatDate(report.completedAt)}</dd>
        </div>
        <div>
          <dt>Válido hasta</dt>
          <dd>{formatDate(report.expiresAt)}</dd>
        </div>
        <div>
          <dt>Fuente</dt>
          <dd>Origen indicado en el registro</dd>
        </div>
        <div>
          <dt>Perfil</dt>
          <dd>{report.profileVersion}</dd>
        </div>
      </dl>
      <h3>Alcance observado</h3>
      <ul className="ds-portal__scope">
        {report.scope.map((scopeItem) => (
          <li key={scopeItem}>{scopeItem}</li>
        ))}
      </ul>
      <h3>Controles observados</h3>
      <ul className="ds-portal__checks">
        {report.checks.map((check) => (
          <li key={`${check.controlId}-${check.targetPath}-${check.method}`}>
            <div>
              <strong>{check.controlId}</strong>
              <span>{getCheckStatusLabel(check.status)}</span>
            </div>
            <p>{check.summary}</p>
            <small>
              {check.method} {check.targetPath} · {check.limitation}
            </small>
          </li>
        ))}
      </ul>
      <p className="ds-portal__disclaimer">
        Un resultado vigente describe solo las rutas y señales incluidas en este
        informe. No acredita la seguridad completa del sitio.
      </p>
    </>
  );
}

function normalizeDomainInput(input: string): string | null {
  const hostname = input.trim().toLowerCase();
  return isPublicHostname(hostname) ? hostname : null;
}

function getReportIdFromLocation(): string | null {
  if (typeof window === "undefined") return null;
  const reportId = new URLSearchParams(window.location.search).get("report");
  return isUuid(reportId) ? reportId.toLowerCase() : null;
}

function isDomainStatus(value: unknown): value is DomainStatus {
  if (!isRecord(value)) return false;
  if (
    !isPublicHostname(value.hostname) ||
    !isOneOf(value.state, DOMAIN_STATES) ||
    !isOneOf(value.enrollment, ENROLLMENTS) ||
    (value.activeJobId !== null && !isUuid(value.activeJobId)) ||
    (value.lastReport !== null && !isPublicReport(value.lastReport)) ||
    !isIsoTimestamp(value.checkedAt)
  ) {
    return false;
  }
  return (
    value.lastReport === null || value.lastReport.hostname === value.hostname
  );
}

function isPublicReport(value: unknown): value is PublicReport {
  if (!isRecord(value)) return false;
  if (
    !isUuid(value.id) ||
    !isPublicHostname(value.hostname) ||
    !isOneOf(value.profileVersion, PROFILE_VERSIONS) ||
    !isBoundedString(value.scannerVersion, 80) ||
    value.vantage !== "same_vps" ||
    !isOneOf(value.trigger, SCAN_TRIGGERS) ||
    !isIsoTimestamp(value.startedAt) ||
    !isIsoTimestamp(value.completedAt) ||
    !isIsoTimestamp(value.expiresAt) ||
    !isOneOf(value.verdict, SCAN_VERDICTS) ||
    !isEthicsAssessment(value.ethicsAssessment) ||
    !Array.isArray(value.checks) ||
    value.checks.length === 0 ||
    value.checks.length > MAX_REPORT_CHECKS ||
    !value.checks.every(isPublicCheck)
  ) {
    return false;
  }
  if (!isScope(value.scope)) return false;
  const scope = value.scope;
  const checkKeys = value.checks.map(
    (check) => `${check.controlId}:${check.targetPath}:${check.method}`,
  );
  if (
    new Set(checkKeys).size !== checkKeys.length ||
    value.checks.some((check) => !scope.includes(check.targetPath))
  ) {
    return false;
  }
  if (
    value.verdict === "pass" &&
    value.checks.some((check) => check.status !== "pass")
  ) {
    return false;
  }
  if (
    value.verdict === "fail" &&
    !value.checks.some((check) => check.status === "fail")
  ) {
    return false;
  }
  return true;
}

function isEthicsAssessment(value: unknown): value is PublicReport["ethicsAssessment"] {
  if (!isRecord(value)) return false;
  return value.policyVersion === "domain-ethics-v1" &&
    (value.score === null || (isInteger(value.score) && value.score >= 0 && value.score <= 100)) &&
    isInteger(value.assessedCriteria) && value.assessedCriteria >= 0 &&
    isInteger(value.totalCriteria) && value.totalCriteria > 0 &&
    isOneOf(value.maturity, ["preliminary", "partial", "broad"] as const) &&
    Array.isArray(value.criteria) && value.criteria.every((item) =>
      isRecord(item) && typeof item.id === "string" && typeof item.label === "string" &&
      isOneOf(item.status, CHECK_STATUSES) && typeof item.weight === "number" && item.weight > 0,
    ) && Array.isArray(value.reasons) && value.reasons.every((reason) => typeof reason === "string") &&
    typeof value.interpretation === "string";
}

function isInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value);
}

function isAnalysisRequest(
  value: unknown,
): value is { hostname: string; state: (typeof ANALYSIS_REQUEST_STATES)[number] } {
  return (
    isRecord(value) &&
    isBoundedString(value.hostname, 253) &&
    typeof value.state === "string" &&
    ANALYSIS_REQUEST_STATES.includes(
      value.state as (typeof ANALYSIS_REQUEST_STATES)[number],
    )
  );
}

function isPublicCheck(value: unknown): value is PublicCheck {
  return (
    isRecord(value) &&
    typeof value.controlId === "string" &&
    /^DS-[A-Z]{2,8}-\d{2}$/u.test(value.controlId) &&
    isOneOf(value.status, CHECK_STATUSES) &&
    value.required === true &&
    isOneOf(value.severity, CHECK_SEVERITIES) &&
    isIsoTimestamp(value.observedAt) &&
    isOneOf(value.targetPath, PUBLIC_SCOPE_PATHS) &&
    isOneOf(value.method, CHECK_METHODS) &&
    isBoundedString(value.summary, 160) &&
    isBoundedString(value.limitation, 220)
  );
}

function isPublicHostname(value: unknown): value is string {
  if (
    typeof value !== "string" ||
    value.length > 253 ||
    value !== value.toLowerCase() ||
    /^\d{1,3}(?:\.\d{1,3}){3}$/u.test(value)
  ) {
    return false;
  }
  const labels = value.split(".");
  return (
    labels.length >= 2 &&
    labels.every(
      (label) =>
        label.length >= 1 &&
        label.length <= 63 &&
        /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/u.test(label),
    )
  );
}

function isUuid(value: unknown): value is string {
  return typeof value === "string" && REPORT_ID_PATTERN.test(value);
}

function isIsoTimestamp(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const timestamp = new Date(value);
  return (
    Number.isFinite(timestamp.getTime()) && timestamp.toISOString() === value
  );
}

function isScope(value: unknown): value is string[] {
  return (
    Array.isArray(value) &&
    value.length >= 1 &&
    value.length <= PUBLIC_SCOPE_PATHS.length &&
    value.every((path) => isOneOf(path, PUBLIC_SCOPE_PATHS)) &&
    value.includes("/") &&
    new Set(value).size === value.length
  );
}

function isBoundedString(
  value: unknown,
  maximumLength: number,
): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= maximumLength
  );
}

function isOneOf<const T extends readonly string[]>(
  value: unknown,
  allowed: T,
): value is T[number] {
  return typeof value === "string" && allowed.includes(value);
}

async function readPublicJson(response: Response): Promise<unknown> {
  const contentType = response.headers
    .get("Content-Type")
    ?.split(";", 1)[0]
    .trim()
    .toLowerCase();
  if (contentType !== ACCEPT_JSON_HEADER && !contentType?.endsWith("+json")) {
    throw new Error("invalid_public_response_content_type");
  }
  return response.json() as Promise<unknown>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function formatDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Fecha no disponible";
  return new Intl.DateTimeFormat("es-ES", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Europe/Madrid",
  }).format(date);
}

function getCheckStatusLabel(status: string): string {
  if (status === "pass") return "Observado";
  if (status === "fail") return "No observado";
  if (status === "not_applicable") return "No aplicable";
  return "Sin conclusión";
}

function getEmptyStateMessage(state: string): string {
  if (state === "updating") return UPDATING_WITHOUT_REPORT_MESSAGE;
  if (state === "unavailable") return UNAVAILABLE_DOMAIN_MESSAGE;
  return NO_REPORT_MESSAGE;
}

function getAnalysisRequestMessage(state: AnalysisRequestState): string {
  if (state === "loading") return "Registrando la solicitud…";
  return ANALYSIS_REQUEST_MESSAGES[state] ?? GENERIC_ERROR;
}

function getReadErrorMessage(response: Response): string {
  if (response.status !== 429) return GENERIC_ERROR;
  const retryAfter = Number(response.headers.get(RETRY_AFTER_HEADER));
  if (
    !Number.isSafeInteger(retryAfter) ||
    retryAfter < 1 ||
    retryAfter > MAX_RETRY_AFTER_SECONDS
  ) {
    return RATE_LIMIT_MESSAGE;
  }
  const unit = retryAfter === 1 ? "segundo" : "segundos";
  return `Has hecho varias consultas seguidas. Espera ${retryAfter} ${unit} y vuelve a intentarlo.`;
}
