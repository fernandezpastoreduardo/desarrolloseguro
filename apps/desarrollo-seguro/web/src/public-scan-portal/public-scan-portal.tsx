import { type FormEvent, useEffect, useRef, useState } from "react";
import "./public-scan-portal.scss";

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
  rate_limited: "La solicitud está limitada temporalmente. Inténtalo más tarde.",
  capacity_reached: "La cola de análisis está completa. Inténtalo más tarde.",
  unavailable: "Este dominio no está disponible para análisis.",
  error: "No se ha podido registrar la solicitud. Inténtalo más tarde.",
  poll_error:
    "No se pudo actualizar el estado automáticamente. Consulta el dominio de nuevo dentro de un momento.",
  poll_timeout:
    "Todavía no hay un informe nuevo. Consulta el dominio de nuevo dentro de un momento.",
  admission_lost:
    "La solicitud se aceptó, pero el estado no muestra ningún trabajo activo ni un informe nuevo. No se puede confirmar el análisis; puedes volver a solicitarlo.",
  failed: "El análisis terminó sin generar un informe. Puedes volver a intentarlo.",
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
const MAX_ANALYSIS_STATUS_POLLS = 180;
const PUBLIC_HISTORY_LIMIT = 12;
const REPORT_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const DOMAIN_STATES = [
  "fresh",
  "updating",
  "stale",
  "not_scanned",
  "unavailable",
  "failed",
] as const;
const SCAN_FAILURE_CODES = [
  "coordinator_unavailable",
  "coordinator_socket_untrusted",
  "runtime_volume_failed",
  "broker_failed",
  "egress_failed",
  "executor_failed",
  "transport_failed",
] as const;
const ENROLLMENTS = ["monitored", "on_demand"] as const;
const PROFILE_VERSIONS = [
  "controls-v1",
  "controls-v2",
  "controls-v3",
  "transport-v1",
  "domain-v1",
  "domain-v2",
  "domain-v3",
] as const;
const SCAN_VERDICTS = ["pass", "fail", "inconclusive"] as const;
const SCAN_TRIGGERS = ["scheduled", "requested"] as const;
const CHECK_STATUSES = ["pass", "fail", "unknown", "not_applicable"] as const;
const CHECK_SEVERITIES = ["critical", "high", "medium", "low", "info"] as const;
const CHECK_METHODS = ["DNS", "TLS", "GET", "HEAD"] as const;
const PUBLIC_SCOPE_PATHS = ["/", "/precios", "/informe"] as const;
const MAX_REPORT_CHECKS = 32;

const REPORT_CATEGORIES = [
  { id: "ethics", label: "Ética", description: "Busca señales visibles de herramientas de seguimiento. Esta prueba no puede confirmar contratos ni si una empresa vende o reutiliza datos.", criteria: ["third-party-data-use", "tracking"], controls: ["DS-PRIV-04", "DS-PRIV-06"] },
  { id: "privacy", label: "Privacidad", description: "Revisa las cookies que se envían al abrir la portada. No acepta avisos de consentimiento ni navega por la web.", criteria: ["initial-cookie-risk"], controls: ["DS-PRIV-05"] },
  { id: "security", label: "Seguridad", description: "Revisa que el dominio responda, use una conexión cifrada y envíe protecciones básicas al navegador.", criteria: ["dns-integrity", "transport-security", "http-availability", "security-headers"], controls: ["DS-DNS-01", "DS-TLS-01", "DS-TLS-02", "DS-HTTP-01", "DS-HDR-01"] },
  { id: "performance", label: "Rendimiento", description: "Mide cuánto tarda y cuánto pesa la respuesta de portada. No representa toda la experiencia desde otros dispositivos o páginas.", criteria: ["performance"], controls: ["DS-QUAL-02"] },
] as const;
const CRITERION_EXPLANATIONS: Record<string, string> = {
  "dns-integrity": "Comprueba que el nombre del dominio lleva a una dirección pública. No confirma quién es su titular.",
  "transport-security": "Comprueba el certificado y qué versiones de TLS acepta la conexión para proteger los datos en tránsito.",
  "http-availability": "Comprueba si la portada responde y si las visitas terminan en una conexión HTTPS cifrada.",
  "security-headers": "Revisa indicaciones que el sitio envía al navegador para reducir algunos tipos de ataque.",
  "third-party-data-use": "La respuesta técnica no permite verificar contratos ni prácticas de reutilización de datos.",
  "initial-cookie-risk": "Cuenta cookies y coincidencias conocidas en la primera respuesta; no evalúa el consentimiento posterior.",
  tracking: "Cuenta referencias del HTML inicial a una lista local de rastreadores conocidos; no confirma conexiones ni ejecuta scripts.",
  performance: "Mide el tiempo y tamaño de una única respuesta GET inicial. No mide la experiencia completa de una persona ni métricas Core Web Vitals.",
};
const CRITERION_RECOMMENDATIONS: Record<string, string> = {
  "dns-integrity": "Revisa los registros DNS y confirma que apuntan a los servicios previstos.",
  "transport-security": "Revisa el certificado y desactiva las versiones de TLS antiguas.",
  "http-availability": "Comprueba que la portada responde y redirige las visitas a HTTPS.",
  "security-headers": "Revisa las protecciones que faltan, en especial la política de contenido y la conexión segura persistente.",
  "third-party-data-use": "Consulta las políticas y contratos de los proveedores; esta comprobación técnica no puede confirmar cómo tratan los datos.",
  "initial-cookie-risk": "Comprueba la finalidad de las cookies y que las no esenciales esperan al consentimiento cuando sea necesario.",
  tracking: "Revisa las referencias detectadas y confirma que cada herramienta se carga con la información y el consentimiento adecuados.",
  performance: "Mide la página completa en distintos dispositivos antes de decidir qué optimizar.",
};
const CRITERION_FAIL_MEANINGS: Record<string, string> = {
  "dns-integrity": "No se confirmó una resolución pública adecuada para el dominio.",
  "transport-security": "El certificado o la versión de cifrado no superó las comprobaciones; esto puede afectar a la conexión segura.",
  "http-availability": "La portada no respondió según lo esperado o se observó una conexión insegura.",
  "security-headers": "Falta al menos una protección que el navegador puede usar frente a ciertos ataques.",
  "third-party-data-use": "No hay fuentes suficientes para concluir sobre el uso de datos por terceros.",
  "initial-cookie-risk": "Se encontró una cookie cuyo nombre coincide con una categoría de analítica o marketing; esto requiere revisar su finalidad, pero no prueba por sí solo un incumplimiento.",
  tracking: "El HTML inicial contiene referencias a herramientas de seguimiento conocidas; la prueba no confirma que se hayan conectado o ejecutado.",
  performance: "La respuesta inicial fue lenta en esta medición puntual; esto puede afectar a la carga, pero no representa la experiencia completa.",
};
const EVIDENCE_LABELS: Record<string, string> = {
  addressClass: "Tipo de dirección", aRecordCount: "Direcciones IPv4 encontradas", aaaaRecordCount: "Direcciones IPv6 encontradas",
  protocol: "Protocolo TLS negociado", certificateValid: "Certificado válido", hostnameMatches: "Certificado para este dominio",
  tls10Accepted: "TLS 1.0 aceptado", tls11Accepted: "TLS 1.1 aceptado", tls12Accepted: "TLS 1.2 aceptado", tls13Accepted: "TLS 1.3 aceptado",
  tls10ProbeError: "Resultado de la prueba TLS 1.0", tls11ProbeError: "Resultado de la prueba TLS 1.1", tls12ProbeError: "Resultado de la prueba TLS 1.2", tls13ProbeError: "Resultado de la prueba TLS 1.3",
  statusCode: "Código de respuesta HTTP", redirectedToHttps: "Redirige a conexión segura", finalScheme: "Conexión final",
  hsts: "Fuerza conexiones seguras futuras (HSTS)", nosniff: "Evita interpretar archivos con un tipo distinto",
  frameProtection: "Protección frente a inserción en marcos", referrerPolicy: "Limita información enviada al salir del sitio",
  csp: "Política que restringe contenido cargado (CSP)", inspected: "Respuesta inspeccionada", cookieCount: "Cookies en la primera respuesta",
  insecureCookieCount: "Cookies sin atributo Secure", catalogMatchCount: "Coincidencias con cookies conocidas", consentPromptDetected: "Aviso de consentimiento detectado",
  thirdPartyResourceReferences: "Referencias a recursos de terceros en el HTML", knownTrackingResourceReferences: "Referencias a rastreadores conocidos",
  responseTimeMs: "Tiempo de respuesta inicial", responseBytes: "Tamaño recibido de la página",
};

type PortalState = "idle" | "loading" | "ready" | "error";
type AnalysisRequestState =
  | (typeof ANALYSIS_REQUEST_STATES)[number]
  | "loading"
  | "error"
  | "failed"
  | "poll_error"
  | "poll_timeout"
  | "admission_lost";
type DomainState = (typeof DOMAIN_STATES)[number];
type ScanFailureCode = (typeof SCAN_FAILURE_CODES)[number];
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
  evidence: Record<string, string | number | boolean>;
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
    policyVersion: "domain-ethics-v3";
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
  certification: {
    policyVersion: "beta-0.1";
    state: "pending" | "active" | "suspended";
    latestAssessmentStatus: "eligible" | "pending" | "blocked";
    score: number | null;
    lastCheckedAt: string;
    certifiedReportId: string | null;
  } | null;
  scope: string[];
  checks: PublicCheck[];
};
type DomainStatus = {
  hostname: string;
  enrollment: Enrollment;
  state: DomainState;
  failureCode: ScanFailureCode | null;
  activeJobId: string | null;
  lastReport: PublicReport | null;
  checkedAt: string;
};
type PublicReportHistoryEntry = {
  id: string;
  hostname: string;
  profileVersion: ProfileVersion;
  completedAt: string;
  expiresAt: string;
  verdict: ScanVerdict;
  score: number | null;
  assessedCriteria: number;
  totalCriteria: number;
  certificationState: "pending" | "active" | "suspended" | null;
};

const STATE_LABELS: Record<string, string> = {
  fresh: "Informe vigente",
  updating: "Actualización en curso",
  stale: "Informe histórico",
  not_scanned: "Sin informe",
  unavailable: "Dominio no disponible",
  failed: "El último análisis falló",
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
  const [history, setHistory] = useState<PublicReportHistoryEntry[]>([]);
  const [message, setMessage] = useState("");
  const [darkTheme, setDarkTheme] = useState(false);
  const [authorizationConfirmed, setAuthorizationConfirmed] = useState(false);
  const [analysisRequestState, setAnalysisRequestState] =
    useState<AnalysisRequestState | null>(null);
  const analysisStatusPollCount = useRef(0);
  const reportBeforeAnalysisId = useRef<string | null>(null);
  const analysisRequestInFlight = useRef(false);

  useEffect(() => {
    if (reportId) void loadReport(reportId);
  }, [reportId]);

  useEffect(() => {
    const pollingHostname = status?.hostname;
    if (
      !pollingHostname ||
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
          `${API_ROOT}/domains/${encodeURIComponent(pollingHostname)}/status`,
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
          void loadHistory(payload.hostname);
          setAnalysisRequestState(null);
          return;
        }
        if (payload.state === "unavailable") {
          setAnalysisRequestState("unavailable");
          return;
        }
        if (payload.state === "failed") {
          setAnalysisRequestState("failed");
          return;
        }
        if (
          payload.activeJobId === null &&
          (payload.lastReport?.id ?? null) === reportBeforeAnalysisId.current
        ) {
          setAnalysisRequestState("admission_lost");
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
  }, [analysisRequestState, status?.hostname]);

  async function loadReport(id: string) {
    setState("loading");
    setMessage("");
    setStatus(null);
    setHistory([]);
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
      await loadHistory(payload.hostname);
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
    setHistory([]);
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
      if (payload.lastReport) void loadHistory(payload.hostname);
      setState("ready");
    } catch {
      setStatus(null);
      setReport(null);
      setState("error");
      setMessage(publicError);
    }
  }

  async function loadHistory(hostname: string): Promise<void> {
    try {
      const response = await fetch(
        `${API_ROOT}/domains/${encodeURIComponent(hostname)}/history`,
        {
          method: "GET",
          headers: { Accept: ACCEPT_JSON_HEADER },
          credentials: "omit",
          cache: "no-store",
        },
      );
      if (!response.ok) throw new Error("invalid_history_response");
      const payload: unknown = await readPublicJson(response);
      if (!isPublicReportHistory(payload)) throw new Error("invalid_history_response");
      setHistory(payload.slice(0, PUBLIC_HISTORY_LIMIT));
    } catch {
      setHistory([]);
    }
  }

  async function requestAnalysis() {
    if (
      !status ||
      !authorizationConfirmed ||
      state === "loading" ||
      analysisRequestInFlight.current
    ) return;
    analysisStatusPollCount.current = 0;
    reportBeforeAnalysisId.current = status.lastReport?.id ?? null;
    analysisRequestInFlight.current = true;
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
    } finally {
      analysisRequestInFlight.current = false;
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
          <img
            className="ds-portal__brand-logo"
            src="/app/assets/desarrollo-seguro-logo-v1.svg"
            alt="DesarrolloSeguro.org"
          />
          <span className="ds-portal__brand-note">Consulta de informes</span>
        </a>
        <nav className="ds-portal__nav" aria-label="Navegación principal">
          <a href="/desarrollo-seguro/">Inicio</a>
          <a href="/desarrollo-seguro/metodologia.html">Metodología</a>
          <a href="/desarrollo-seguro/privacidad.html">Privacidad</a>
          <a href="/desarrollo-seguro/sello.html">Sello</a>
        </nav>
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
        <DomainResult
          status={status}
          report={report}
          history={history}
          authorizationConfirmed={authorizationConfirmed}
          onAuthorizationChange={setAuthorizationConfirmed}
          analysisRequestState={analysisRequestState}
          onRequestAnalysis={() => void requestAnalysis()}
        />
      )}
      {state === "ready" && !status && report && (
        <ReportResult report={report} history={history} />
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
          <AnalysisRequestPanel
            authorizationConfirmed={authorizationConfirmed}
            onAuthorizationChange={setAuthorizationConfirmed}
            requestState={analysisRequestState}
            onRequest={() => void requestAnalysis()}
          />
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
  history,
  authorizationConfirmed,
  onAuthorizationChange,
  analysisRequestState,
  onRequestAnalysis,
}: {
  status: DomainStatus;
  report: PublicReport | null;
  history: PublicReportHistoryEntry[];
  authorizationConfirmed: boolean;
  onAuthorizationChange: (confirmed: boolean) => void;
  analysisRequestState: AnalysisRequestState | null;
  onRequestAnalysis: () => void;
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
        {status.state === "failed" && (
          <>
            <p className="ds-portal__failure" role="alert">
              {getScanFailureMessage(status.failureCode)}
            </p>
            <AnalysisRequestPanel
              authorizationConfirmed={authorizationConfirmed}
              onAuthorizationChange={onAuthorizationChange}
              requestState={analysisRequestState}
              onRequest={onRequestAnalysis}
            />
          </>
        )}
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
      {status.state === "failed" && (
        <>
          <p className="ds-portal__failure" role="alert">
            {getScanFailureMessage(status.failureCode)}
          </p>
          <p className="ds-portal__disclaimer">
            El informe anterior se conserva como histórico. Puedes solicitar una comprobación nueva si tienes autorización.
          </p>
          <AnalysisRequestPanel
            authorizationConfirmed={authorizationConfirmed}
            onAuthorizationChange={onAuthorizationChange}
            requestState={analysisRequestState}
            onRequest={onRequestAnalysis}
          />
        </>
      )}
      {(status.state === "fresh" || status.state === "stale") && (
        <>
          <p className="ds-portal__disclaimer">
            {status.state === "stale"
              ? "Este informe es histórico. Puedes solicitar un análisis nuevo si tienes autorización."
              : "Este informe está vigente. Puedes solicitar una nueva comprobación si tienes autorización."}
          </p>
          <AnalysisRequestPanel
            authorizationConfirmed={authorizationConfirmed}
            onAuthorizationChange={onAuthorizationChange}
            requestState={analysisRequestState}
            onRequest={onRequestAnalysis}
          />
        </>
      )}
      <ReportSummary report={report} state={status.state} history={history} />
    </section>
  );
}

function AnalysisRequestPanel({
  authorizationConfirmed,
  onAuthorizationChange,
  requestState,
  onRequest,
}: {
  authorizationConfirmed: boolean;
  onAuthorizationChange: (confirmed: boolean) => void;
  requestState: AnalysisRequestState | null;
  onRequest: () => void;
}) {
  if (requestState !== null) {
    if (isRetryableAnalysisRequestState(requestState)) {
      return (
        <div className="ds-portal__analysis-status">
          <p className="ds-portal__failure" role="alert">
            {getAnalysisRequestMessage(requestState)}
          </p>
          <button type="button" onClick={onRequest}>
            Volver a solicitar análisis
          </button>
        </div>
      );
    }
    return (
      <p className="ds-portal__analysis-status" role="status">
        {getAnalysisRequestMessage(requestState)}
      </p>
    );
  }

  return (
    <div className="ds-portal__analysis-request">
      <label>
        <input
          type="checkbox"
          checked={authorizationConfirmed}
          onChange={(event) => onAuthorizationChange(event.currentTarget.checked)}
        />
        Confirmo que tengo autorización para solicitar este análisis.
      </label>
      <button
        type="button"
        disabled={!authorizationConfirmed}
        onClick={onRequest}
      >
        Solicitar análisis
      </button>
    </div>
  );
}

function isRetryableAnalysisRequestState(
  requestState: AnalysisRequestState,
): boolean {
  return [
    "error",
    "poll_error",
    "poll_timeout",
    "admission_lost",
    "failed",
  ].includes(requestState);
}

function ReportResult({ report, history }: { report: PublicReport; history: PublicReportHistoryEntry[] }) {
  return (
    <section className="ds-portal__result" aria-labelledby="ds-result-heading">
      <p className="ds-portal__eyebrow">Informe público · {report.hostname}</p>
      <h2 id="ds-result-heading">Detalle del informe</h2>
      <ReportSummary report={report} state="historical" history={history} />
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
  if (status?.state === "updating" || requestState === "running") {
    return "running";
  }
  return "queued";
}

function ReportSummary({
  report,
  state,
  history,
}: {
  report: PublicReport;
  state: string;
  history: PublicReportHistoryEntry[];
}) {
  const isCurrent = state === "fresh";
  return (
    <>
      <CertificationStatus certification={report.certification} />
      <section className="ds-portal__ethics" aria-labelledby="ethics-summary-heading">
        <p className="ds-portal__eyebrow">Resumen del dominio</p>
        <h3 id="ethics-summary-heading">Resumen y puntuación</h3>
        <p className="ds-portal__ethics-score">
          {report.ethicsAssessment.score === null
            ? `Sin puntuación: faltan controles observables · ${report.ethicsAssessment.assessedCriteria} de ${report.ethicsAssessment.totalCriteria} criterios evaluados`
            : `${report.ethicsAssessment.score}/100${report.ethicsAssessment.assessedCriteria < report.ethicsAssessment.totalCriteria ? " · provisional" : ""} · ${report.ethicsAssessment.assessedCriteria} de ${report.ethicsAssessment.totalCriteria} criterios evaluados`}
        </p>
        <p className="ds-portal__score-method">
          La puntuación solo se calcula con los criterios evaluados. Los que no
          tienen evidencia quedan como desconocidos y no suman ni restan; una
          puntuación alta con pocos datos no significa que el sitio esté libre de problemas.
        </p>
        <p className="ds-portal__report-takeaway">{getReportTakeaway(report.ethicsAssessment.criteria)}</p>
        <p>{report.ethicsAssessment.interpretation}</p>
        <div className="ds-portal__report-categories">
          {REPORT_CATEGORIES.map((category) => {
            const criteria = report.ethicsAssessment.criteria.filter((criterion) =>
              (category.criteria as readonly string[]).includes(criterion.id),
            );
            const checks = report.checks.filter((check) =>
              (category.controls as readonly string[]).includes(check.controlId),
            );
            return (
              <section className="ds-portal__report-category" key={category.id}>
                <div className="ds-portal__category-heading">
                  <h4>{category.label}</h4>
                  <strong>{getCategoryScoreLabel(criteria)}</strong>
                </div>
                <p>{category.description}</p>
                <p className="ds-portal__category-summary">{getCategorySummary(criteria)}</p>
                <ul className="ds-portal__ethics-criteria">
                  {criteria.map((criterion) => (
                    <li key={criterion.id} data-status={criterion.status}>
                      <div>
                        <strong>{getCriterionDisplayLabel(criterion.id, criterion.label)}</strong>
                        <p><b>Qué comprueba:</b> {CRITERION_EXPLANATIONS[criterion.id]}</p>
                        <p><b>Qué significa:</b> {getCriterionOutcome(criterion.id, criterion.status)}</p>
                        <p className="ds-portal__criterion-evidence"><b>Dato observado:</b> {getCriterionEvidenceSummary(criterion.id, checks)}</p>
                        {criterion.status !== "pass" && (
                          <p><b>Qué revisar:</b> {CRITERION_RECOMMENDATIONS[criterion.id]}</p>
                        )}
                      </div>
                      <span>{getCheckStatusLabel(criterion.status)}</span>
                    </li>
                  ))}
                </ul>
                {checks.length > 0 && (
                  <details className="ds-portal__technical-details">
                    <summary>Ver evidencias técnicas ({checks.length} comprobación{checks.length === 1 ? "" : "es"})</summary>
                    <ul className="ds-portal__checks">
                      {checks.map((check) => (
                        <li key={`${check.controlId}-${check.targetPath}-${check.method}`}>
                          <div><strong>{getControlLabel(check.controlId)}</strong><span>{getCheckStatusLabel(check.status)}</span></div>
                          <p>{check.summary}</p>
                          {Object.keys(check.evidence).length > 0 && (
                            <dl className="ds-portal__evidence">
                              {Object.entries(check.evidence).map(([key, value]) => (
                                <div key={key}><dt>{EVIDENCE_LABELS[key] ?? key}</dt><dd>{formatEvidenceValue(value, key)}</dd></div>
                              ))}
                            </dl>
                          )}
                          <small>{check.method} {check.targetPath} · {check.limitation}</small>
                        </li>
                      ))}
                    </ul>
                  </details>
                )}
              </section>
            );
          })}
        </div>
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
      <ReportHistory history={history} currentReportId={report.id} />
      <h3>Alcance observado</h3>
      <ul className="ds-portal__scope">
        {report.scope.map((scopeItem) => (
          <li key={scopeItem}>{scopeItem}</li>
        ))}
      </ul>
      <p className="ds-portal__disclaimer">
        Un resultado vigente describe solo las rutas y señales incluidas en este
        informe. No acredita la seguridad completa del sitio.
      </p>
    </>
  );
}

function ReportHistory({
  history,
  currentReportId,
}: {
  history: PublicReportHistoryEntry[];
  currentReportId: string;
}) {
  if (history.length === 0) return null;
  return (
    <section className="ds-portal__history" aria-labelledby="report-history-heading">
      <div className="ds-portal__history-heading">
        <div>
          <p className="ds-portal__eyebrow">Trazabilidad pública</p>
          <h3 id="report-history-heading">Historial de observaciones</h3>
        </div>
        <span>{history.length} informe{history.length === 1 ? "" : "s"}</span>
      </div>
      <p className="ds-portal__disclaimer">
        Las puntuaciones solo son comparables cuando comparten el mismo perfil de controles.
        Cada ficha conserva su fecha y alcance originales.
      </p>
      <ol className="ds-portal__history-list">
        {history.map((entry) => (
          <li key={entry.id} data-current={entry.id === currentReportId}>
            <a href={`?report=${encodeURIComponent(entry.id)}`}>
              <span>{formatDate(entry.completedAt)}</span>
              <strong>{entry.score === null ? "Sin puntuación" : `${entry.score}/100`}</strong>
              <small>{entry.profileVersion} · {getHistoryVerdictLabel(entry.verdict)}</small>
            </a>
          </li>
        ))}
      </ol>
    </section>
  );
}

function CertificationStatus({ certification }: { certification: PublicReport["certification"] }) {
  if (!certification) return null;
  const labels = {
    pending: "En revisión",
    active: "Certificación beta activa",
    suspended: "Certificación suspendida",
  } as const;
  const explanations = {
    pending: "Todavía no hay evidencia suficiente para emitir el sello.",
    active: "El último informe elegible mantiene el sello verificable.",
    suspended: "El sello permanece oculto hasta obtener una evaluación elegible.",
  } as const;
  return (
    <section className="ds-portal__certification" data-state={certification.state} aria-labelledby="certification-heading">
      <p className="ds-portal__eyebrow">Certificación beta · {certification.policyVersion}</p>
      <h3 id="certification-heading">{labels[certification.state]}</h3>
      <p>{explanations[certification.state]}</p>
      <p className="ds-portal__certification-meta">
        Última evaluación: {formatDate(certification.lastCheckedAt)}
        {certification.score === null ? " · puntuación pendiente" : ` · ${certification.score}/100`}
      </p>
    </section>
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
    (value.failureCode !== null &&
      !isOneOf(value.failureCode, SCAN_FAILURE_CODES)) ||
    (value.state === "failed" && value.failureCode === null) ||
    (value.state !== "failed" && value.failureCode !== null) ||
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
    !isPublicCertification(value.certification) ||
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

function isPublicReportHistory(value: unknown): value is PublicReportHistoryEntry[] {
  return Array.isArray(value) && value.length <= PUBLIC_HISTORY_LIMIT && value.every((entry) => {
    if (!isRecord(entry)) return false;
    return (
      isUuid(entry.id) &&
      isPublicHostname(entry.hostname) &&
      isOneOf(entry.profileVersion, PROFILE_VERSIONS) &&
      isIsoTimestamp(entry.completedAt) &&
      isIsoTimestamp(entry.expiresAt) &&
      isOneOf(entry.verdict, SCAN_VERDICTS) &&
      (entry.score === null || (isInteger(entry.score) && entry.score >= 0 && entry.score <= 100)) &&
      isInteger(entry.assessedCriteria) && entry.assessedCriteria >= 0 &&
      isInteger(entry.totalCriteria) && entry.totalCriteria > 0 &&
      entry.assessedCriteria <= entry.totalCriteria &&
      (entry.certificationState === null || isOneOf(entry.certificationState, ["pending", "active", "suspended"] as const))
    );
  });
}

function isPublicCertification(value: unknown): value is PublicReport["certification"] {
  if (value === null || value === undefined) return true;
  return isRecord(value) &&
    value.policyVersion === "beta-0.1" &&
    isOneOf(value.state, ["pending", "active", "suspended"] as const) &&
    isOneOf(value.latestAssessmentStatus, ["eligible", "pending", "blocked"] as const) &&
    (value.score === null || (isInteger(value.score) && value.score >= 0 && value.score <= 100)) &&
    isIsoTimestamp(value.lastCheckedAt) &&
    (value.certifiedReportId === null || isUuid(value.certifiedReportId));
}

function isEthicsAssessment(value: unknown): value is PublicReport["ethicsAssessment"] {
  if (!isRecord(value)) return false;
  if (
    value.policyVersion !== "domain-ethics-v3" ||
    (value.score !== null && (!isInteger(value.score) || value.score < 0 || value.score > 100)) ||
    !isInteger(value.assessedCriteria) || value.assessedCriteria < 0 ||
    !isInteger(value.totalCriteria) || value.totalCriteria <= 0 ||
    !isOneOf(value.maturity, ["preliminary", "partial", "broad"] as const) ||
    !Array.isArray(value.criteria) || value.criteria.length !== value.totalCriteria ||
    !value.criteria.every((item) =>
      isRecord(item) && typeof item.id === "string" && typeof item.label === "string" &&
      isOneOf(item.status, ["pass", "fail", "unknown"] as const) &&
      typeof item.weight === "number" && Number.isFinite(item.weight) && item.weight > 0,
    ) ||
    !Array.isArray(value.reasons) || !value.reasons.every((reason) => typeof reason === "string") ||
    typeof value.interpretation !== "string"
  ) {
    return false;
  }
  const assessedCount = value.criteria.filter(
    (criterion) => isRecord(criterion) && criterion.status !== "unknown",
  ).length;
  return assessedCount === value.assessedCriteria &&
    ((value.assessedCriteria === 0 && value.score === null) ||
      (value.assessedCriteria > 0 && value.score !== null));
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
    isBoundedString(value.summary, 500) &&
    isBoundedString(value.limitation, 220) &&
    isRecord(value.evidence) &&
    Object.keys(value.evidence).length <= 20 &&
    Object.entries(value.evidence).every(([key, item]) =>
      /^[a-z][a-zA-Z0-9]{0,39}$/u.test(key) &&
      ((typeof item === "string" && item.length <= 40) ||
        (typeof item === "number" && Number.isSafeInteger(item) && item >= 0 && item <= 1_000_000) ||
        typeof item === "boolean"),
    )
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
  if (status === "pass") return "Correcto";
  if (status === "fail") return "Problema detectado";
  if (status === "not_applicable") return "No evaluado";
  return "Sin datos";
}

function getCategoryScoreLabel(criteria: Array<{ status: string; weight: number }>): string {
  const assessed = criteria.filter((criterion) => criterion.status !== "unknown");
  if (assessed.length === 0) return "Sin datos suficientes";
  const totalWeight = assessed.reduce((sum, criterion) => sum + criterion.weight, 0);
  const passedWeight = assessed
    .filter((criterion) => criterion.status === "pass")
    .reduce((sum, criterion) => sum + criterion.weight, 0);
  const score = Math.round((passedWeight / totalWeight) * 100);
  const coverage = `${assessed.length} de ${criteria.length} aspectos evaluados`;
  if (assessed.length < criteria.length) return `${score}/100 provisional · ${coverage}`;
  return `${score}/100 · ${coverage}`;
}

function getCategorySummary(criteria: Array<{ status: string }>): string {
  const assessed = criteria.filter((criterion) => criterion.status !== "unknown");
  const problems = assessed.filter((criterion) => criterion.status === "fail").length;
  const unknown = criteria.length - assessed.length;
  if (assessed.length === 0) return "Todavía no hay datos suficientes para valorar esta categoría.";
  if (problems > 0) {
    return `Hay ${problems} aspecto${problems === 1 ? "" : "s"} que conviene revisar de ${assessed.length} evaluado${assessed.length === 1 ? "" : "s"}.`;
  }
  if (unknown > 0) {
    return `Se revisaron ${assessed.length} de ${criteria.length} aspectos; no se detectaron problemas en el observado. Faltan datos de ${unknown}.`;
  }
  return `No se detectaron problemas en los ${assessed.length} aspectos evaluados.`;
}

function getReportTakeaway(criteria: Array<{ status: string }>): string {
  const assessed = criteria.filter((criterion) => criterion.status !== "unknown");
  const problems = assessed.filter((criterion) => criterion.status === "fail").length;
  const unknown = criteria.length - assessed.length;
  if (assessed.length === 0) return "Aún no hay comprobaciones suficientes para valorar el dominio.";
  if (problems > 0) {
    return `Se detectaron problemas en ${problems} de ${assessed.length} aspectos evaluados. Revisa los detalles por categoría.`;
  }
  if (unknown > 0) {
    return `No se detectaron problemas en ${assessed.length} aspecto${assessed.length === 1 ? "" : "s"} evaluado${assessed.length === 1 ? "" : "s"}. ${unknown} aspecto${unknown === 1 ? "" : "s"} aún no tienen datos.`;
  }
  return `No se detectaron problemas en los ${assessed.length} aspectos evaluados.`;
}

function getCriterionOutcome(criterionId: string, status: string): string {
  if (status === "unknown") return "No hay datos suficientes para confirmar si este punto está bien o necesita cambios.";
  if (status === "fail") return CRITERION_FAIL_MEANINGS[criterionId] ?? "La comprobación encontró una condición que conviene revisar.";
  const outcomes: Record<string, string> = {
    "dns-integrity": "El dominio resolvió a direcciones públicas durante esta comprobación; esto no confirma quién lo controla.",
    "transport-security": "La conexión superó las comprobaciones de TLS incluidas en este informe.",
    "http-availability": "La portada respondió según lo esperado y usó una conexión segura en esta comprobación.",
    "security-headers": "Las protecciones comprobadas estaban presentes en la respuesta observada.",
    "third-party-data-use": "No se ha podido confirmar el uso que terceros hacen de los datos.",
    "initial-cookie-risk": "No se reconocieron cookies con riesgo en la primera respuesta observada.",
    tracking: "No se encontraron referencias conocidas a rastreadores en el HTML inicial; no se ejecutaron scripts.",
    performance: "La respuesta inicial quedó dentro del umbral orientativo de esta comprobación; no representa la experiencia completa.",
  };
  return outcomes[criterionId] ?? "La comprobación no detectó un problema en este punto.";
}

function getCriterionEvidenceSummary(criterionId: string, checks: PublicCheck[]): string {
  const evidence = checks
    .filter((check) => getCriterionControlIds(criterionId).includes(check.controlId))
    .map((check) => check.evidence);
  const values = Object.assign({}, ...evidence);
  const number = (key: string) => typeof values[key] === "number" ? values[key] as number : null;
  const flag = (key: string) => typeof values[key] === "boolean" ? values[key] as boolean : null;
  const text = (key: string) => typeof values[key] === "string" ? values[key] as string : null;

  switch (criterionId) {
    case "dns-integrity": {
      const ipv4 = number("aRecordCount");
      const ipv6 = number("aaaaRecordCount");
      if (ipv4 === null && ipv6 === null) break;
      return `El dominio resolvió a ${ipv4 ?? "sin dato"} dirección${ipv4 === 1 ? "" : "es"} IPv4 y ${ipv6 ?? "sin dato"} IPv6.`;
    }
    case "transport-security": {
      const protocol = text("protocol");
      const certificateValid = flag("certificateValid");
      const hostnameMatches = flag("hostnameMatches");
      const tls12 = flag("tls12Accepted");
      const tls13 = flag("tls13Accepted");
      const details = [
        protocol ? `conexión negociada con ${protocol}` : null,
        certificateValid !== null ? `certificado ${certificateValid ? "válido" : "no válido"}` : null,
        hostnameMatches !== null ? `nombre ${hostnameMatches ? "coincidente" : "no coincidente"}` : null,
        tls12 !== null || tls13 !== null ? `TLS 1.2 ${tls12 === null ? "sin dato" : tls12 ? "aceptado" : "rechazado"} y TLS 1.3 ${tls13 === null ? "sin dato" : tls13 ? "aceptado" : "rechazado"}` : null,
      ].filter(Boolean);
      if (details.length > 0) return `${details.join("; ")}.`;
      break;
    }
    case "http-availability": {
      const statusCode = number("statusCode");
      const finalScheme = text("finalScheme");
      const redirected = flag("redirectedToHttps");
      const details = [
        statusCode !== null ? `la página respondió con código ${statusCode}` : null,
        finalScheme ? `la conexión terminó en ${finalScheme.toUpperCase()}` : null,
        redirected !== null ? `redirección a conexión segura ${redirected ? "observada" : "no observada"}` : null,
      ].filter(Boolean);
      if (details.length > 0) return `${details.join("; ")}.`;
      break;
    }
    case "security-headers": {
      const labels = [
        ["hsts", "HSTS"], ["nosniff", "protección de tipo de contenido"],
        ["frameProtection", "protección frente a marcos"], ["referrerPolicy", "política de referencia"], ["csp", "política de contenido CSP"],
      ] as const;
      const known = labels.filter(([key]) => flag(key) !== null);
      if (known.length === 0) break;
      const missing = known.filter(([key]) => flag(key) === false).map(([, label]) => label);
      const present = known.filter(([key]) => flag(key) === true).map(([, label]) => label);
      const observed = present.length > 0 ? `incluía ${present.join(", ")}` : "no incluía las protecciones comprobadas";
      return missing.length > 0
        ? `La respuesta ${observed}; faltaba${missing.length === 1 ? "" : "n"} ${missing.join(", ")}.`
        : `La respuesta incluía las ${present.length} protecciones comprobadas: ${present.join(", " )}.`;
    }
    case "initial-cookie-risk": {
      const count = number("cookieCount");
      const matches = number("catalogMatchCount");
      const insecure = number("insecureCookieCount");
      if (count === null && matches === null && insecure === null) break;
      return `En la primera respuesta se observaron ${count ?? "sin dato"} cookies; ${matches ?? "sin dato"} coincidían con el catálogo de nombres conocidos y ${insecure ?? "sin dato"} no incluían el atributo Secure.`;
    }
    case "tracking": {
      const thirdParty = number("thirdPartyResourceReferences");
      const known = number("knownTrackingResourceReferences");
      if (thirdParty === null && known === null) break;
      return `El HTML inicial contenía ${thirdParty ?? "sin dato"} referencias a recursos de terceros y ${known ?? "sin dato"} coincidencias con rastreadores conocidos.`;
    }
    case "performance": {
      const responseTime = number("responseTimeMs");
      const responseBytes = number("responseBytes");
      if (responseTime === null && responseBytes === null) break;
      return `La respuesta inicial tardó ${responseTime === null ? "sin dato" : `${responseTime} ms`} y recibió ${responseBytes === null ? "un tamaño no medido" : `${formatByteCount(responseBytes)} de datos`}.`;
    }
    default:
      break;
  }
  return "El análisis no obtuvo un dato verificable para este aspecto.";
}

function getCriterionControlIds(criterionId: string): readonly string[] {
  const controlIds: Record<string, readonly string[]> = {
    "dns-integrity": ["DS-DNS-01"],
    "transport-security": ["DS-TLS-01", "DS-TLS-02"],
    "http-availability": ["DS-HTTP-01"],
    "security-headers": ["DS-HDR-01"],
    "third-party-data-use": ["DS-PRIV-04"],
    "initial-cookie-risk": ["DS-PRIV-05"],
    tracking: ["DS-PRIV-06"],
    performance: ["DS-QUAL-02"],
  };
  return controlIds[criterionId] ?? [];
}

function formatByteCount(value: number): string {
  if (value < 1_000) return `${value} bytes`;
  return `${(value / 1_000).toFixed(1)} kB`;
}

function getCriterionDisplayLabel(criterionId: string, fallback: string): string {
  const labels: Record<string, string> = {
    "dns-integrity": "El dominio apunta a una dirección pública",
    "transport-security": "La conexión protege los datos",
    "http-availability": "La página responde de forma segura",
    "security-headers": "El navegador recibe protecciones",
    "third-party-data-use": "Uso de datos por servicios externos",
    "initial-cookie-risk": "Cookies potencialmente no esenciales",
    tracking: "Rastreadores conocidos en la página",
    performance: "Rapidez de la respuesta inicial",
  };
  return labels[criterionId] ?? fallback;
}

function getControlLabel(controlId: string): string {
  const labels: Record<string, string> = {
    "DS-DNS-01": "Resolución del dominio",
    "DS-TLS-01": "Certificado de conexión segura",
    "DS-TLS-02": "Versiones de conexión segura",
    "DS-HTTP-01": "Respuesta de la página",
    "DS-HDR-01": "Protecciones del navegador",
    "DS-PRIV-05": "Cookies de la primera respuesta",
    "DS-PRIV-06": "Referencias a rastreadores conocidos",
    "DS-QUAL-02": "Tiempo y tamaño de respuesta",
  };
  return labels[controlId] ?? controlId;
}

function getHistoryVerdictLabel(verdict: ScanVerdict): string {
  return VERDICT_LABELS[verdict] ?? "Resultado no concluyente";
}

function formatEvidenceValue(value: string | number | boolean, key: string): string {
  if (typeof value === "boolean") return value ? "Sí" : "No";
  if (typeof value === "number") {
    if (key === "responseTimeMs") return `${value} ms`;
    if (key === "responseBytes") return `${new Intl.NumberFormat("es-ES").format(value)} bytes`;
    return String(value);
  }
  const labels: Record<string, string> = {
    public: "Pública", private: "Privada", reserved: "Reservada", unresolved: "Sin resolver",
    "TLSv1.2": "TLS 1.2", "TLSv1.3": "TLS 1.3", http: "HTTP", https: "HTTPS",
    dns_resolution_failed: "No se pudo resolver el dominio", connection_failed: "No se pudo completar la conexión",
    broker_failed: "El servicio de medición no respondió", request_aborted: "Prueba interrumpida",
    request_timeout: "Tiempo de espera agotado", response_size_limit_exceeded: "Respuesta mayor al límite permitido",
    https_request_failed: "Falló la solicitud HTTPS", http_request_failed: "Falló la solicitud de prueba",
    invalid_http_response: "Respuesta no válida", redirect_limit_exceeded: "Demasiadas redirecciones",
    redirect_origin_not_allowlisted: "Redirección fuera del dominio permitido", redirect_path_not_allowlisted: "Redirección fuera de la ruta permitida",
    tls_certificate_invalid: "Certificado no válido", tls_handshake_failed: "El servidor rechazó el cifrado",
    transport_failed: "Error de transporte",
  };
  return labels[value] ?? value;
}

function getEmptyStateMessage(state: string): string {
  if (state === "updating") return UPDATING_WITHOUT_REPORT_MESSAGE;
  if (state === "unavailable") return UNAVAILABLE_DOMAIN_MESSAGE;
  if (state === "failed") {
    return "El último análisis terminó sin generar un informe.";
  }
  return NO_REPORT_MESSAGE;
}

function getScanFailureMessage(code: ScanFailureCode | null): string {
  if (code === "coordinator_unavailable") {
    return "El servicio de análisis no está disponible ahora.";
  }
  if (code === "coordinator_socket_untrusted" || code === "runtime_volume_failed") {
    return "No se pudo preparar el entorno aislado de análisis.";
  }
  if (code === "broker_failed") {
    return "No se pudo iniciar la comprobación del dominio.";
  }
  if (code === "egress_failed") {
    return "No se pudo completar la conexión pública con el dominio.";
  }
  if (code === "transport_failed") {
    return "El dominio no respondió por el transporte esperado.";
  }
  return "El análisis terminó con un error. Puedes intentarlo de nuevo.";
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
