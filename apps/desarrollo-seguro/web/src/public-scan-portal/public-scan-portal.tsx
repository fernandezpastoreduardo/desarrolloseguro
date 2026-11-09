import { type FormEvent, useEffect, useState } from "react";
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
const ACCEPT_JSON_HEADER = "application/json";
const RETRY_AFTER_HEADER = "Retry-After";
const MAX_RETRY_AFTER_SECONDS = 3_600;
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
const PROFILE_VERSIONS = ["controls-v1", "controls-v2", "controls-v3"] as const;
const SCAN_VERDICTS = ["pass", "fail", "inconclusive"] as const;
const SCAN_TRIGGERS = ["scheduled", "requested"] as const;
const CHECK_STATUSES = ["pass", "fail", "unknown", "not_applicable"] as const;
const CHECK_SEVERITIES = ["critical", "high", "medium", "low", "info"] as const;
const CHECK_METHODS = ["DNS", "TLS", "GET", "HEAD"] as const;
const PUBLIC_SCOPE_PATHS = ["/", "/precios", "/informe"] as const;
const MAX_REPORT_CHECKS = 32;

type PortalState = "idle" | "loading" | "ready" | "error";
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

  useEffect(() => {
    if (reportId) void loadReport(reportId);
  }, [reportId]);

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

  return (
    <main className="ds-portal" data-theme={darkTheme ? "dark" : "light"}>
      <header className="ds-portal__topbar">
        <a
          className="ds-portal__brand"
          href="/"
          aria-label="Desarrollo Seguro, volver a presentación"
        >
          <span>Desarrollo Seguro</span>
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
        <p className="ds-portal__eyebrow">Observación técnica acotada</p>
        <h1 id="ds-portal-heading">¿Qué se ve desde fuera?</h1>
        <p className="ds-portal__intro">
          Consulta el estado y los controles observados de un dominio. Esta
          lectura no inicia un análisis.
        </p>
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
            Esta consulta no inicia un análisis ni comprueba el dominio en
            tiempo real.
          </p>
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
