import { type FormEvent, useEffect, useRef, useState } from "react";
import { parseFirstEntryPolicyAccess, type FirstEntryPolicyAccess } from "@desarrolloseguro/core/first-entry-policy-access";
import { parseLegalCookieFindings, type LegalCookieFinding } from "@desarrolloseguro/core/legal-cookie-findings";
import { parsePublicServiceComparison } from "@desarrolloseguro/core/public-service-comparison";
import { PUBLIC_SERVICE_PROVIDER_INFO } from "@desarrolloseguro/core/public-service-catalog";
import "./public-scan-portal.scss";

const API_ROOT = "/api/desarrollo-seguro/v1";
const DOMAIN_INPUT_ID = "public-scan-domain";
const DOMAIN_ERROR_ID = "ds-portal-domain-error";
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
  "Hay una revisión en curso. Puede tardar unos minutos; vuelve a consultar para ver el resultado cuando termine.";
const UNAVAILABLE_DOMAIN_MESSAGE =
  "Este dominio no está disponible para consulta pública.";
const ANALYSIS_REQUEST_MESSAGES: Record<string, string> = {
  queued: "La solicitud está en cola. El análisis empezará cuando haya un turno disponible.",
  running: "Estamos comprobando el dominio. Puede tardar unos minutos; te avisaremos cuando el informe esté listo.",
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
  "domain-v4",
] as const;
const SCAN_VERDICTS = ["pass", "fail", "inconclusive"] as const;
const SCAN_TRIGGERS = ["scheduled", "requested"] as const;
const CHECK_STATUSES = ["pass", "fail", "unknown", "not_applicable"] as const;
const CHECK_SEVERITIES = ["critical", "high", "medium", "low", "info"] as const;
const CHECK_METHODS = ["DNS", "TLS", "GET", "HEAD"] as const;
const PUBLIC_SCOPE_PATHS = ["/", "/precios", "/informe"] as const;
const MAX_REPORT_CHECKS = 32;

const REPORT_CATEGORIES = [
  { id: "ethics", label: "Ética", description: "Valora la transparencia sobre servicios externos y otras prácticas que pueden afectar a las personas. Separa lo que el sitio declara de lo que el análisis observa.", criteria: ["third-party-data-use", "external-service-transparency", "backend-processor-transparency", "tracking"], controls: ["DS-PRIV-06"] },
  { id: "privacy", label: "Privacidad", description: "Comprueba qué datos guarda la página, si se conecta con otros servicios y si respeta la opción de rechazarlos. Después vuelve a cargarla para comprobar que la elección se mantiene.", criteria: ["initial-cookie-risk"], controls: ["DS-PRIV-05"] },
  { id: "security", label: "Seguridad", description: "Comprueba que el dominio se encuentre, que la conexión proteja la información y que el navegador reciba barreras frente a algunos ataques.", criteria: ["dns-integrity", "transport-security", "http-availability", "security-headers"], controls: ["DS-DNS-01", "DS-TLS-01", "DS-TLS-02", "DS-HTTP-01", "DS-HDR-01"] },
  { id: "performance", label: "Rendimiento", description: "Mide cuánto tarda y cuánto ocupa la respuesta inicial. Es una medición puntual: otras páginas, dispositivos y conexiones pueden dar resultados distintos.", criteria: ["performance"], controls: ["DS-QUAL-02"] },
] as const;
const BETA_EVALUATION_LEVELS = [
  { id: "observed", label: "Observado", statuses: ["pass"] },
  { id: "not-observed", label: "No observado", statuses: ["fail"] },
  { id: "review", label: "En revisión", statuses: ["unknown"] },
  { id: "not-applicable", label: "No aplica", statuses: ["not_applicable"] },
] as const;
const CRITERION_EXPLANATIONS: Record<string, string> = {
  "dns-integrity": "Comprobamos que el dominio se encuentre en Internet. Esto no confirma quién es su titular.",
  "transport-security": "Revisamos si la conexión cifra la información y si su certificado corresponde a este sitio.",
  "http-availability": "Comprobamos si la página principal responde y si termina en una conexión cifrada.",
  "security-headers": "Revisamos instrucciones que ayudan al navegador a proteger a quienes visitan el sitio.",
  "third-party-data-use": "Buscamos información pública sobre qué servicios externos participan y qué explican sobre el uso de datos.",
  "external-service-transparency": "Comparamos los servicios externos que se observaron con los que el sitio identifica y la finalidad que declara para cada uno.",
  "backend-processor-transparency": "Comparamos los servicios que el titular declara con su lista interna de sistemas activos. No podemos comprobar aquí si cada proveedor cumple lo declarado.",
  "initial-cookie-risk": "Revisamos los datos que la página guarda en el navegador al abrirla. Esta comprobación no cubre lo que ocurre después.",
  tracking: "Buscamos en el contenido inicial referencias a herramientas de seguimiento conocidas. Esto no confirma que se conecten o se ejecuten.",
  performance: "Medimos cuánto tarda y cuánto ocupa la primera respuesta. No representa toda la experiencia de uso.",
};
const CRITERION_FAIL_MEANINGS: Record<string, string> = {
  "dns-integrity": "No pudimos encontrar la dirección pública del dominio.",
  "transport-security": "La conexión o su certificado no superó una de las comprobaciones de protección.",
  "http-availability": "La página principal no respondió como se esperaba o no terminó en una conexión cifrada.",
  "security-headers": "Falta al menos una indicación que ayuda al navegador a proteger la visita.",
  "third-party-data-use": "Falta información pública necesaria sobre los servicios externos o el acceso a esa información fue denegado.",
  "external-service-transparency": "Se observó un servicio externo que no aparece explicado junto con su finalidad en la información pública.",
  "initial-cookie-risk": "El nombre de un dato guardado coincide con los que suelen usar herramientas de análisis o publicidad. Esto no basta por sí solo para confirmar un incumplimiento.",
  tracking: "El contenido inicial menciona herramientas de seguimiento conocidas, pero esta prueba no confirma que se conecten o se ejecuten.",
  performance: "La primera respuesta tardó más de lo esperado en esta medición puntual.",
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
  policyLanguageCatalogVersion: "Catálogo local de información pública",
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
type PublicProcessorDisclosure = {
  providerId: string;
  displayName: string;
  product: string;
  disclosureStatus: "published" | "missing";
  purpose?: string;
  policyUrl?: string;
  declaredStatements?: string[];
};
type PublicProcessorTransparencyAssessment = {
  policyVersion: "processor-inventory-v1";
  status: "pass" | "fail" | "unknown";
  reasonCode: string;
  inventory: {
    policyVersion: "processor-inventory-v1";
    observedAt: string;
    validUntil: string;
    hostname: "grumphya.com" | "desarrolloseguro.org";
    deploymentDigest: string;
    inventoryStatus: "complete" | "incomplete";
    privacyPolicy: { url: string; revision: string };
    processors: PublicProcessorDisclosure[];
    attestation: { verified: true; keyId: string };
    evidenceSource?: "grumphya_signed_attestation" | "desarrolloseguro_source_registry";
  } | null;
};
type PublicPolicyTransparencyAssessment = {
  policyVersion: "public-policy-v1";
  status: "pass" | "fail" | "unknown";
  reasonCode: "disclosure_found" | "policy_link_missing" | "policy_content_missing" | "policy_page_unavailable" | "service_purpose_missing" | "access_denied" | "auditor_error" | "budget_exhausted";
  evidence: {
    linksFound: number;
    pagesInspected: number;
    unavailablePages: number;
    accessDeniedPages: number;
    providerMentions: number;
    providersMissingPurpose: number;
    categories: Array<"analytics" | "advertising" | "social" | "consent" | "other">;
  };
};
type PublicServiceComparison = {
  policyVersion: "public-service-comparison-v1";
  status: "pass" | "fail" | "unknown";
  reasonCode: "services_disclosed" | "observed_service_undisclosed" | "provider_documentation_contradiction" | "public_policy_missing" | "auditor_error";
  items: Array<{
    providerId: string;
    observation: "observed" | "declared" | "observed_and_declared";
    observedDomains: string[];
    declaredPurposes: string[];
  }>;
  providerDocumentation?: Array<{
    providerId: string;
    status: "contradiction_confirmed" | "consistent" | "not_comparable" | "source_not_located" | "source_unavailable";
    sourceEvidence?: Array<{ documentId: string; title: string; url: string; status: "seeded" | "fetched" | "unavailable" | "failed" | "not_localized"; sha256: string | null; checkedAt: string }>;
    comparisons: Array<{
      factId: string;
      siteStatement: { title: string; url: string; excerpt: string };
      siteValue: boolean;
      providerFact: { title: string; url: string; excerpt: string };
      providerValue: boolean;
      relation: "opposes" | "supports";
      legalFinding?: {
        status: "infraccion_legal_acreditada";
        instrument: string;
        articles: string[];
        authority: string;
        sanction: { alternatives: Array<{ type: string; amount?: number; percentage?: number; currency?: string }> };
        officialSources?: Array<{ sourceId: string; title: string; url: string; issuer: string; version: string; checkedAt: string }>;
        supportingSources?: Record<string, Array<{ sourceId: string; title: string; url: string; excerpt: string }>>;
      };
    }>;
  }>;
};
type InternalAuditCriterionId =
  | "infrastructure.tls" | "infrastructure.headers" | "infrastructure.network"
  | "application.dependencies" | "application.secrets" | "authentication.authorization"
  | "quality.e2e" | "quality.accessibility" | "performance.page_load"
  | "privacy.cookies" | "privacy.third_parties" | "privacy.consent"
  | "ethics.transparency" | "ai.disclosure";
type InternalAuditPublicSummary = {
  policyVersion: "internal-audit-public-v1";
  status: "complete" | "review";
  observedAt: string | null;
  criteria: Array<{ id: InternalAuditCriterionId; status: CheckStatus }>;
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
  globalAssessment: {
    policyVersion: "mvp-global-v2";
    status: "scored" | "review" | "not_available";
    score: number | null;
    legalViolationAccredited: boolean;
    weights: { ethics: 50; privacy: 50 };
    ethicsCoverage: { assessedCriteria: number; totalCriteria: number };
    privacyCoverage: {
      assessedCriteria: number;
      unknownCriteria: number;
      notApplicableCriteria: number;
      totalCriteria: number;
    } | null;
  };
  ethicsAssessment: {
    policyVersion: "domain-ethics-v3" | "domain-ethics-v4" | "domain-ethics-v5" | "domain-ethics-v6";
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
  privacyAssessment?: {
    policyVersion: "privacy-v1";
    score: number | null;
    assessedCriteria: number;
    unknownCriteria: number;
    notApplicableCriteria: number;
    totalCriteria: number;
    evidence: { cookieNames: string[]; providers: string[]; domains: string[] };
    criteria: Array<{
      id: string;
      label: string;
      status: "evaluated" | "unknown" | "not_applicable";
      weight: number;
      deduction: number | null;
      awarded: number | null;
      confirmedFindings: number;
      unknownFindings: number;
    }>;
  } | null;
  processorTransparencyAssessment: PublicProcessorTransparencyAssessment | null;
  publicPolicyTransparencyAssessment: PublicPolicyTransparencyAssessment | null;
  publicServiceComparison?: PublicServiceComparison | null;
  legalCookieFindings?: LegalCookieFinding[];
  providerCatalogVersion?: string | null;
  firstEntryPolicyAccess?: FirstEntryPolicyAccess | null;
  internalAuditSummary?: InternalAuditPublicSummary | null;
  internalAuditState?: "running" | "review" | "complete" | null;
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
  hostnameResolution?: {
    observedReportId: string;
    requestedHostname: string;
    canonicalHostname: string;
    statusCode: 301 | 308;
    responseStatusCode: number;
    fromHostname: string;
    toHostname: string;
  };
  checkedAt: string;
};
type PublicReportHistoryEntry = {
  id: string;
  hostname: string;
  profileVersion: ProfileVersion;
  completedAt: string;
  expiresAt: string;
  verdict: ScanVerdict;
  globalAssessment: PublicReport["globalAssessment"];
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
  inconclusive: "En revisión · el análisis no pudo completar todas las comprobaciones",
};

export function PublicScanPortal() {
  const reportId = getReportIdFromLocation();
  const [domain, setDomain] = useState("");
  const [state, setState] = useState<PortalState>("idle");
  const [status, setStatus] = useState<DomainStatus | null>(null);
  const [report, setReport] = useState<PublicReport | null>(null);
  const [history, setHistory] = useState<PublicReportHistoryEntry[]>([]);
  const [message, setMessage] = useState("");
  const [domainInputInvalid, setDomainInputInvalid] = useState(false);
  const [darkTheme, setDarkTheme] = useState(false);
  const [authorizationConfirmed, setAuthorizationConfirmed] = useState(false);
  const [analysisRequestState, setAnalysisRequestState] =
    useState<AnalysisRequestState | null>(null);
  const analysisStatusPollCount = useRef(0);
  const reportBeforeAnalysisId = useRef<string | null>(null);
  const analysisRequestInFlight = useRef(false);
  const domainInputRef = useRef<HTMLInputElement>(null);
  const scanAnnouncement = useRef<"queued" | "running" | "complete" | "failed" | null>(null);
  const [scanAnnouncementText, setScanAnnouncementText] = useState("");

  function announceScanPhase(
    phase: "queued" | "running" | "complete" | "failed",
    text: string,
  ): void {
    if (scanAnnouncement.current === phase) return;
    scanAnnouncement.current = phase;
    setScanAnnouncementText(text);
  }

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
          announceScanPhase(
            "complete",
            "El análisis ha terminado y el informe está disponible.",
          );
          void loadHistory(payload.hostname);
          setAnalysisRequestState(null);
          return;
        }
        if (payload.state === "unavailable") {
          announceScanPhase(
            "failed",
            "El dominio no está disponible para este análisis.",
          );
          setAnalysisRequestState("unavailable");
          return;
        }
        if (payload.state === "failed") {
          announceScanPhase(
            "failed",
            "El análisis ha terminado sin generar un informe.",
          );
          setAnalysisRequestState("failed");
          return;
        }
        if (payload.state === "updating") {
          announceScanPhase(
            "running",
            "La comprobación del dominio está en curso. Te avisaremos cuando el informe esté listo.",
          );
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
        if (!controller.signal.aborted) {
          announceScanPhase(
            "failed",
            "No se pudo actualizar el estado del análisis.",
          );
          setAnalysisRequestState("poll_error");
        }
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
    setDomainInputInvalid(false);
    setScanAnnouncementText("");
    scanAnnouncement.current = null;
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
      setDomainInputInvalid(true);
      setStatus(null);
      setReport(null);
      domainInputRef.current?.focus();
      return;
    }

    setDomain(hostname);
    setDomainInputInvalid(false);
    setAuthorizationConfirmed(false);
    setAnalysisRequestState(null);
    setState("loading");
    setMessage("");
    setScanAnnouncementText("");
    scanAnnouncement.current = null;
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
    setScanAnnouncementText("");
    scanAnnouncement.current = null;
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
      announceScanPhase(
        "queued",
        "Tu solicitud está en cola. Te avisaremos cuando empiece la comprobación.",
      );
      setAnalysisRequestState(payload.state);
    } catch {
      announceScanPhase(
        "failed",
        "No se pudo registrar la solicitud de análisis.",
      );
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
              ref={domainInputRef}
              type="text"
              inputMode="url"
              autoComplete="url"
              placeholder="ejemplo.es"
              value={domain}
              onChange={(event) => setDomain(event.currentTarget.value)}
              aria-describedby="ds-portal-help"
              aria-errormessage={domainInputInvalid ? DOMAIN_ERROR_ID : undefined}
              aria-invalid={domainInputInvalid}
            />
            <button type="submit" disabled={state === "loading"}>
              {state === "loading" && <span className="ds-portal__spinner" aria-hidden="true" />}
              {state === "loading" ? "Consultando el informe…" : SEARCH_BUTTON_TEXT}
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
          <p id={domainInputInvalid ? DOMAIN_ERROR_ID : undefined}>{message}</p>
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
      {scanAnnouncementText && (
        <p
          className="ds-portal__scan-announcement"
          aria-live="polite"
          aria-atomic="true"
        >
          {scanAnnouncementText}
        </p>
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
            La revisión sigue en curso. Puede tardar unos minutos; vuelve a consultar para ver el resultado cuando termine.
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
      {status.hostnameResolution && (
        <div className="ds-portal__disclaimer" role="status">
          <p>{status.hostnameResolution.requestedHostname} respondió con una redirección permanente HTTP {status.hostnameResolution.statusCode} a {status.hostnameResolution.canonicalHostname}; la respuesta final fue HTTP {status.hostnameResolution.responseStatusCode}. {status.lastReport?.hostname === status.hostnameResolution.canonicalHostname
            ? "Se muestra el informe vigente de ese destino."
            : "El informe vigente de ese destino todavía no está disponible; no se presenta su puntuación desde este análisis."}</p>
          <a href={`/app/?report=${encodeURIComponent(status.hostnameResolution.observedReportId)}`}>Consultar la evidencia de redirección</a>
        </div>
      )}
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
    if (["loading", "queued", "running"].includes(requestState)) return null;
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

function ScanProgress({ phase }: { phase: "submitting" | "queued" | "running" }) {
  const description =
    phase === "submitting"
      ? "Estamos registrando la solicitud. Puede tardar unos segundos."
      : phase === "queued"
        ? "La solicitud está en cola y empezará cuando haya un turno disponible."
        : "Estamos comprobando el dominio. Puede tardar unos minutos; no hay un porcentaje fiable porque cada prueba tarda distinto.";

  return (
    <div
      className="ds-portal__scan-progress"
      role="progressbar"
      aria-label="Progreso del análisis"
      aria-valuetext={description}
      aria-busy="true"
      data-phase={phase}
    >
      <span className="ds-portal__spinner" aria-hidden="true" />
      <span className="ds-portal__scan-progress-label">{description}</span>
      {(phase === "queued" || phase === "running") && (
        <span className="ds-portal__scan-progress-track" aria-hidden="true">
          <span className="ds-portal__scan-progress-indicator" />
        </span>
      )}
    </div>
  );
}

function isScanInProgress(
  status: DomainStatus | null,
  requestState: AnalysisRequestState | null,
): boolean {
  return (
    status?.state === "updating" ||
    requestState === "loading" ||
    requestState === "queued" ||
    requestState === "running"
  );
}

function getScanProgressPhase(
  status: DomainStatus | null,
  requestState: AnalysisRequestState | null,
): "submitting" | "queued" | "running" {
  if (requestState === "loading") return "submitting";
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
  const [activeCategoryId, setActiveCategoryId] = useState<string | null>(null);

  return (
    <>
      <CertificationStatus certification={report.certification} />
      <section className="ds-portal__ethics" aria-labelledby="ethics-summary-heading">
        <div className="ds-portal__score-lead">
          <GlobalScoreRing score={report.globalAssessment.score} status={report.globalAssessment.status} />
          <div className="ds-portal__score-copy">
            <p className="ds-portal__eyebrow">Resultado de la evaluación</p>
            <h3 id="ethics-summary-heading">Qué significa esta valoración</h3>
            <p className="ds-portal__report-takeaway">{getReportTakeaway(report, state)}</p>
          </div>
        </div>
        <p className="ds-portal__ethics-score">
          <strong>Ética</strong><br />
          {report.ethicsAssessment.score === null
            ? `En revisión · ${report.ethicsAssessment.assessedCriteria} de ${report.ethicsAssessment.totalCriteria} comprobaciones completas`
            : `${report.ethicsAssessment.score}/100 · ${report.ethicsAssessment.assessedCriteria} de ${report.ethicsAssessment.totalCriteria} comprobaciones completas`}
        </p>
        <BetaEvaluationCharts criteria={report.ethicsAssessment.criteria} />
        <div className="ds-portal__report-categories">
          {REPORT_CATEGORIES.map((category) => {
            const criteria = report.ethicsAssessment.criteria.filter((criterion) =>
              (category.criteria as readonly string[]).includes(criterion.id),
            );
            const isExpanded = activeCategoryId === category.id;
            return (
              <section
                className="ds-portal__report-category"
                key={category.id}
                data-expanded={isExpanded}
                data-dialog-open={isExpanded}
              >
                <div className="ds-portal__category-heading">
                  <div>
                    <h4>{category.label}</h4>
                    <strong>{getCategoryScoreLabel(criteria)}</strong>
                  </div>
                  <CategoryScoreRing label={category.label} criteria={criteria} />
                </div>
                <p className="ds-portal__category-summary">{getCategorySummary(criteria, state)}</p>
                <button
                  className="ds-portal__category-more"
                  type="button"
                  aria-expanded={isExpanded}
                  aria-haspopup="dialog"
                  data-category-id={category.id}
                  onClick={() => setActiveCategoryId(category.id)}
                >
                  <span>Ver detalle</span>
                  <span className="ds-portal__category-more-icon" aria-hidden="true">
                    +
                  </span>
                </button>
              </section>
            );
          })}
        </div>
        {activeCategoryId !== null && (() => {
          const activeCategory = REPORT_CATEGORIES.find(
            (category) => category.id === activeCategoryId,
          );
          if (!activeCategory) return null;
          const activeCriteria = report.ethicsAssessment.criteria.filter((criterion) =>
            (activeCategory.criteria as readonly string[]).includes(criterion.id),
          );
          const activeChecks = report.checks.filter((check) =>
            (activeCategory.controls as readonly string[]).includes(check.controlId),
          );
          return (
            <CategoryDetailsModal
              category={activeCategory}
              criteria={activeCriteria}
              checks={activeChecks}
              publicPolicyAssessment={report.publicPolicyTransparencyAssessment}
              detailsId={`report-category-details-${activeCategory.id}`}
              onClose={() => setActiveCategoryId(null)}
            />
          );
        })()}
        {report.ethicsAssessment.reasons.length > 0 && (
          <ul className="ds-portal__ethics-reasons">
            {report.ethicsAssessment.reasons.map((reason) => <li key={reason}>{reason}</li>)}
          </ul>
        )}
        {report.processorTransparencyAssessment && (
          <section className="ds-portal__processors" aria-labelledby="processor-transparency-heading">
            <h3 id="processor-transparency-heading">
                Información adicional compartida por {(report.processorTransparencyAssessment.inventory?.hostname ?? report.hostname) === "desarrolloseguro.org" ? "Desarrollo Seguro" : "Grumphya"}
            </h3>
            <p>
              {getProcessorTransparencySummary(report.processorTransparencyAssessment)}
            </p>
            {report.processorTransparencyAssessment.inventory && (
              <>
                {report.processorTransparencyAssessment.inventory.processors.length > 0 ? (
                  <ul className="ds-portal__processor-list">
                    {report.processorTransparencyAssessment.inventory.processors.map((processor) => (
                      <li key={processor.providerId}>
                        <h4>{processor.displayName} <span>({processor.product})</span></h4>
                        {processor.disclosureStatus === "published" ? (
                          <>
                            <p><strong>Propósito declarado:</strong> {processor.purpose}</p>
                            {processor.declaredStatements && processor.declaredStatements.length > 0 && (
                              <>
                                  <p className="ds-portal__declared-label">
                                    {report.hostname === "desarrolloseguro.org"
                                      ? "Declaraciones de Desarrollo Seguro:"
                                      : "Declaraciones de Grumphya:"}
                                  </p>
                                <ul>
                                  {processor.declaredStatements.map((statement, index) => (
                                    <li key={`${processor.providerId}-${index}`}>{statement}</li>
                                  ))}
                                </ul>
                              </>
                            )}
                            {processor.policyUrl && (
                              <a href={processor.policyUrl} target="_blank" rel="noopener noreferrer">
                                Ver política de privacidad de {report.hostname === "desarrolloseguro.org" ? "Desarrollo Seguro" : "Grumphya"}
                              </a>
                            )}
                          </>
                        ) : (
                          <p>Proveedor activo sin propósito ni condiciones declarados en la política.</p>
                        )}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p>El inventario completo no encontró procesadores backend externos activos en el registro cubierto.</p>
                )}
                <div className="ds-portal__processor-evidence-note">
                  <h4>Lo que declara el sitio</h4>
                  <p>Esta lista procede de la información publicada por {report.processorTransparencyAssessment.inventory.hostname === "desarrolloseguro.org" ? "Desarrollo Seguro" : "Grumphya"}. El análisis comprueba que incluya los servicios identificados; no confirma que cada proveedor cumpla lo declarado.</p>
                  <h4>Lo que observamos desde fuera</h4>
                  <p>Las conexiones y páginas descritas en el informe muestran señales visibles durante la revisión. No permiten conocer todo lo que cada proveedor hace con la información recibida.</p>
                </div>
              </>
            )}
          </section>
        )}
        {report.publicServiceComparison && (
          <PublicServiceComparisonSection comparison={report.publicServiceComparison} observedDomains={report.privacyAssessment?.evidence.domains ?? []} catalogVersion={report.providerCatalogVersion} />
        )}
        {report.legalCookieFindings && report.legalCookieFindings.length > 0 && (
          <LegalCookieFindingsSection findings={report.legalCookieFindings} />
        )}
        {report.firstEntryPolicyAccess && (
          <FirstEntryPolicyAccessSection access={report.firstEntryPolicyAccess} />
        )}
        {report.publicPolicyTransparencyAssessment && !report.publicServiceComparison && (
          <section className="ds-portal__public-policy" aria-labelledby="public-policy-transparency-heading">
            <h3 id="public-policy-transparency-heading">Servicios externos detectados</h3>
            <p>{getPublicPolicyTransparencySummary(report.publicPolicyTransparencyAssessment)}</p>
            <p className="ds-portal__public-policy-note">
              Esta parte compara los servicios visibles desde fuera con los que el sitio explica en su información pública. Las declaraciones de cada proveedor se enlazan como fuente.
            </p>
          </section>
        )}
      </section>
      {report.hostname === "grumphya.com" && (
        <InternalAuditSummary
          summary={report.internalAuditSummary ?? null}
          state={report.internalAuditState ?? (state === "updating"
            ? "running"
            : report.internalAuditSummary?.status === "complete" ? "complete" : "review")}
        />
      )}
      {report.privacyAssessment && (
        <section className="ds-portal__privacy" aria-labelledby="privacy-summary-heading">
          <p className="ds-portal__eyebrow">Nota independiente</p>
          <h3 id="privacy-summary-heading">Privacidad</h3>
          <p>
            {report.privacyAssessment.score === null
              ? `Sin puntuación: falta evidencia del navegador · ${report.privacyAssessment.assessedCriteria} de ${report.privacyAssessment.totalCriteria} criterios evaluados · ${report.privacyAssessment.unknownCriteria} desconocidos · ${report.privacyAssessment.notApplicableCriteria} no aplican`
              : `${report.privacyAssessment.score}/100 · ${report.privacyAssessment.assessedCriteria} de ${report.privacyAssessment.totalCriteria} criterios evaluados · ${report.privacyAssessment.unknownCriteria} desconocidos · ${report.privacyAssessment.notApplicableCriteria} no aplican`}
          </p>
          <dl className="ds-portal__privacy-evidence">
            <div><dt>Cookies observadas</dt><dd>{report.privacyAssessment.evidence.cookieNames.join(", ") || "Ninguna detectada"}</dd></div>
            <div><dt>Proveedores identificados</dt><dd>{report.privacyAssessment.evidence.providers.join(", ") || "Ninguno identificado"}</dd></div>
            <div><dt>Dominios de terceros</dt><dd>{report.privacyAssessment.evidence.domains.join(", ") || "Ninguno observado"}</dd></div>
          </dl>
        </section>
      )}
      <div className="ds-portal__verdict" data-verdict={report.verdict}>
        <span>{isCurrent ? "Vigente" : "Histórico"}</span>
        <strong>
          {VERDICT_LABELS[report.verdict] ?? "En revisión"}
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
      <section className="ds-portal__report-method" aria-labelledby="report-method-heading">
        <p className="ds-portal__eyebrow">Notas de lectura</p>
        <h3 id="report-method-heading">Cómo se calcula esta nota</h3>
        <p className="ds-portal__score-method">
          La nota global combina por igual Ética y Privacidad. Las categorías describen aspectos distintos que pueden afectar a las personas; no son una opinión moral. Ética valora lo que el sitio explica sobre sus prácticas y los indicios públicos observados. Si falta información que debería ser pública, se señala como falta de transparencia. Si falla una comprobación técnica del auditor, el resultado queda en revisión. Una nota alta no garantiza que nunca vaya a ocurrir un problema.
        </p>
        <p>{report.ethicsAssessment.interpretation}</p>
      </section>
    </>
  );
}

function PublicServiceComparisonSection({ comparison, observedDomains, catalogVersion }: { comparison: PublicServiceComparison; observedDomains: string[]; catalogVersion?: string | null }) {
  const classifiedDomains = new Set(comparison.items.flatMap(({ observedDomains: domains }) => domains));
  const otherObservedDomains = observedDomains.filter((domain) => !classifiedDomains.has(domain));
  const summary = comparison.reasonCode === "auditor_error"
    ? "La comparación de servicios sigue en revisión porque falló una comprobación técnica."
    : comparison.reasonCode === "public_policy_missing"
      ? "No se encontró información pública suficiente para conocer y contrastar los servicios externos del sitio."
      : comparison.reasonCode === "observed_service_undisclosed"
        ? "Incumplimiento observado: se detectó un servicio externo sin información pública del sitio que identifique su finalidad."
        : comparison.reasonCode === "provider_documentation_contradiction"
          ? "Se confirmó una contradicción entre lo que declara el sitio y la documentación oficial de un proveedor."
        : "Los servicios externos observados aparecen explicados por el sitio. Los servicios declarados que no se vieron durante esta revisión se muestran aparte y no se consideran actividad confirmada.";
  return (
    <section className="ds-portal__public-services" aria-labelledby="public-services-heading">
      <h3 id="public-services-heading">Servicios externos detectados</h3>
      <p>{summary}</p>
      {catalogVersion && <p>Versión del catálogo oficial aplicado: <code>{catalogVersion}</code></p>}
      {comparison.items.length > 0 && (
        <ul className="ds-portal__public-service-list">
          {comparison.items.map((item) => {
            const info = PUBLIC_SERVICE_PROVIDER_INFO[item.providerId] ?? null;
            const label = info?.displayName ?? (item.providerId.startsWith("dst_") ? "Destino externo sin proveedor atribuido" : item.providerId);
            const stateLabel = item.observation === "observed_and_declared"
              ? "Correcto · observado y explicado"
              : item.observation === "observed"
                ? comparison.status === "unknown"
                  ? "Servicio observado · declaración sin comprobar"
                  : "Servicio observado · sin finalidad declarada"
                : comparison.status === "unknown"
                  ? "Declarado · observación incompleta"
                  : "Declarado · no observado en esta revisión";
            return (
              <li key={item.providerId} data-observation={item.observation}>
                <div className="ds-portal__public-service-heading">
                  <h4>{label}</h4>
                  <strong>{stateLabel}</strong>
                </div>
                {item.declaredPurposes.length > 0 && (
                  <p><b>Qué explica el sitio:</b> {item.declaredPurposes.map(getPublicPurposeLabel).join(", ")}.</p>
                )}
                {item.observedDomains.length > 0 && (
                  <p><b>Conexiones observadas:</b> {item.observedDomains.join(", ")}.</p>
                )}
                {info && (
                  <>
                    <p>{info.serviceSummary}</p>
                    <p className="ds-portal__public-service-sources">
                      Fuentes oficiales del proveedor: {info.officialDocuments?.length
                        ? info.officialDocuments.map((document, index) => (
                          <span key={document.documentId}>
                            {index > 0 ? " · " : ""}
                            <a href={document.url} target="_blank" rel="noopener noreferrer">
                              {getOfficialDocumentLabel(document.kind)}
                            </a>
                          </span>
                        ))
                        : <>
                          <a href={info.serviceSourceUrl} target="_blank" rel="noopener noreferrer">descripción del servicio</a>
                          {" · "}<a href={info.privacyPolicyUrl} target="_blank" rel="noopener noreferrer">política de privacidad</a>
                        </>}.
                    </p>
                  </>
                )}
              </li>
            );
          })}
        </ul>
      )}
      {comparison.providerDocumentation?.filter(({ status }) => status === "contradiction_confirmed").map((finding) => (
        <article className="ds-portal__provider-contradiction" key={finding.providerId}>
          <h4>{PUBLIC_SERVICE_PROVIDER_INFO[finding.providerId]?.displayName ?? finding.providerId}: contradicción documental confirmada</h4>
          {finding.comparisons.filter(({ relation }) => relation === "opposes").map((item) => (
            <div className="ds-portal__provider-contradiction-evidence" key={`${finding.providerId}-${item.factId}`}>
              <p><b>Declaración del sitio:</b> {item.siteStatement.excerpt}</p>
              <p><b>Fuente del sitio:</b> <a href={item.siteStatement.url} target="_blank" rel="noopener noreferrer">{item.siteStatement.title}</a></p>
              <p><b>Hecho documentado por el proveedor:</b> {item.providerFact.excerpt}</p>
              <p><b>Fuente oficial del proveedor:</b> <a href={item.providerFact.url} target="_blank" rel="noopener noreferrer">{item.providerFact.title}</a></p>
              {item.legalFinding && (
                <div className="ds-portal__provider-legal-finding" data-status="infraccion_legal_acreditada">
                  <strong>Incumplimiento legal acreditado</strong>
                  <p>{item.legalFinding.instrument}, artículos {item.legalFinding.articles.join(", ")}. Organismo competente: {item.legalFinding.authority}.</p>
                  {item.legalFinding.officialSources && (
                    <p>Fuentes jurídicas oficiales: {item.legalFinding.officialSources.map((source, index) => (
                      <span key={source.sourceId}>
                        {index > 0 ? " · " : ""}<a href={source.url} target="_blank" rel="noopener noreferrer">{source.title}</a>
                        {` (${source.issuer}; ${source.checkedAt.slice(0, 10)})`}
                      </span>
                    ))}.</p>
                  )}
                  <p>Escala sancionadora prevista: {item.legalFinding.sanction.alternatives.map((scale) =>
                    scale.type === "fixed_amount" ? `${scale.amount?.toLocaleString("es-ES")} ${scale.currency}` : `${scale.percentage} % del volumen de negocio mundial anual`,
                  ).join(" o ")} (la cuantía concreta la determina el organismo competente).</p>
                  {item.legalFinding.supportingSources && (
                    <details>
                      <summary>Fuentes de los elementos legales</summary>
                      <ul>
                        {Object.entries(item.legalFinding.supportingSources).flatMap(([element, sources]) =>
                          sources.map((source) => (
                            <li key={`${element}-${source.sourceId}`}>
                              <b>{getLegalEvidenceElementLabel(element)}:</b>{" "}
                              <a href={source.url} target="_blank" rel="noopener noreferrer">{source.title}</a>
                              {source.excerpt ? <blockquote>{source.excerpt}</blockquote> : null}
                            </li>
                          )),
                        )}
                      </ul>
                    </details>
                  )}
                </div>
              )}
            </div>
          ))}
        </article>
      ))}
      {comparison.providerDocumentation?.filter(({ status }) => status === "source_not_located" || status === "source_unavailable" || status === "not_comparable").map((finding) => (
        <article className="ds-portal__provider-contradiction" key={`documentation-${finding.providerId}`}>
          <h4>{PUBLIC_SERVICE_PROVIDER_INFO[finding.providerId]?.displayName ?? (finding.providerId.startsWith("dst_") ? "Destino externo sin proveedor atribuido" : finding.providerId)}: documentación oficial</h4>
          {finding.status === "source_not_located" && <p>No se localizó documentación oficial con las fuentes permitidas. Esto no demuestra que el proveedor carezca de documentación.</p>}
          {finding.status === "source_unavailable" && <p>La documentación oficial localizada no pudo recuperarse; se conserva su enlace y estado técnico.</p>}
          {finding.status === "not_comparable" && <p>Hay documentación oficial catalogada, pero no se pudo comparar con una declaración explícita equivalente del sitio.</p>}
          {finding.sourceEvidence && finding.sourceEvidence.length > 0 && (
            <ul>{finding.sourceEvidence.map((source) => (
              <li key={source.documentId}>
                <a href={source.url} target="_blank" rel="noopener noreferrer">{source.title}</a>
                {` · ${source.status} · ${source.checkedAt}`}
                {source.sha256 ? ` · SHA-256 ${source.sha256}` : ""}
              </li>
            ))}</ul>
          )}
        </article>
      ))}
      {otherObservedDomains.length > 0 && (
        <div className="ds-portal__unclassified-services">
          <h4>Otros dominios externos observados</h4>
          <p>Estos dominios se registraron en la observación; no se atribuyen a una empresa ni a un tratamiento sin evidencia que los vincule.</p>
          <ul>{otherObservedDomains.map((domain) => <li key={domain}>{domain}</li>)}</ul>
        </div>
      )}
    </section>
  );
}

function FirstEntryPolicyAccessSection({ access }: { access: FirstEntryPolicyAccess }) {
  const statusLabel = access.status === "pass" ? "Enlace comprobado"
    : access.status === "fail" ? "Comprobación incumplida"
      : "No se pudo comprobar";
  const summary = access.reasonCode === "consent_component_link_accessible"
    ? "El aviso de consentimiento contiene un enlace visible y accesible a documentación legal."
    : access.reasonCode === "information_notice_link_accessible_without_consent"
      ? "El aviso informativo de primera entrada contiene un enlace visible y accesible a la política. No se solicitó consentimiento y no se detectaron cookies de terceros."
    : access.reasonCode === "consent_link_missing"
      ? "El aviso de consentimiento no contiene un enlace visible a documentación legal. Un enlace que solo aparece en el footer no satisface esta comprobación."
      : access.reasonCode === "consent_link_unavailable"
        ? "El enlace legal visible no permitió abrir un documento accesible."
        : access.reasonCode === "footer_link_accessible_without_consent"
          ? "No se solicitó consentimiento ni se detectaron cookies de terceros en la entrada inicial; el enlace del footer permitió abrir la documentación."
          : access.reasonCode === "footer_insufficient_with_third_party_cookies"
            ? "Se detectó una cookie de un dominio de terceros en la entrada inicial. Un enlace que solo aparece en el footer no satisface esta comprobación."
            : access.reasonCode === "information_notice_insufficient_with_third_party_cookies"
              ? "Se detectó una cookie de un dominio de terceros en la entrada inicial. El enlace del aviso informativo no sustituye el consentimiento requerido."
            : access.reasonCode === "policy_link_missing"
              ? "No se encontró un enlace visible a documentación legal pertinente en el lugar requerido."
              : "La evidencia del navegador está incompleta; no se califica como cumplimiento ni como incumplimiento.";
  const locationLabel = access.linkLocation === "consent_component" ? "aviso de consentimiento"
    : access.linkLocation === "information_notice" ? "aviso informativo de primera entrada"
    : access.linkLocation === "footer" ? "footer"
      : access.linkLocation === "none" ? "ningún lugar requerido" : "ubicación no determinada";
  const linkUrl = access.link ? `https://${access.link.hostname}${access.link.path}` : null;
  return (
    <section className="ds-portal__first-entry-policy-access" data-status={access.status} aria-labelledby="first-entry-policy-access-heading">
      <div className="ds-portal__first-entry-policy-heading">
        <div>
          <p className="ds-portal__eyebrow">Entrada inicial</p>
          <h3 id="first-entry-policy-access-heading">Acceso a información legal</h3>
        </div>
        <strong>{statusLabel}</strong>
      </div>
      <p>{summary}</p>
      <dl>
        <div><dt>Consentimiento</dt><dd>{access.consentPromptDetected === true ? "Solicitado" : access.consentPromptDetected === false ? "No solicitado" : "No determinado"}</dd></div>
        <div><dt>Cookie de terceros</dt><dd>{access.thirdPartyCookieDetected === true ? "Detectada" : access.thirdPartyCookieDetected === false ? "No detectada en una lectura completa" : "No se pudo determinar"}</dd></div>
        <div><dt>Ubicación del enlace</dt><dd>{locationLabel}</dd></div>
        <div><dt>Acceso al documento</dt><dd>{access.documentAccess === "accessible" ? "Accesible" : access.documentAccess === "unavailable" ? "No accesible" : access.documentAccess === "not_checked" ? "No comprobado" : "No se pudo determinar"}</dd></div>
      </dl>
      {access.nonEssentialThirdPartyStorageDetected === true && (
        <p className="ds-portal__first-entry-policy-separate-finding">Se identificó almacenamiento de terceros no esencial. Se evalúa como hallazgo independiente de la ubicación del enlace legal.</p>
      )}
      {access.nonEssentialThirdPartyStorageDetected === null && (
        <p className="ds-portal__first-entry-policy-note">No se pudo atribuir todo el almacenamiento observado a una finalidad no esencial.</p>
      )}
      {linkUrl && (
        <p className="ds-portal__first-entry-policy-link">
          Enlace registrado: <a href={linkUrl} target="_blank" rel="noopener noreferrer">{access.link?.hostname}{access.link?.path}</a>
        </p>
      )}
      {access.policyLinkVisit && (
        <details className="ds-portal__first-entry-policy-visit">
          <summary>Estado observado al abrir el enlace en un contexto nuevo</summary>
          <p>
            {access.policyLinkVisit.status === "not_applicable" ? "No había un enlace pertinente que visitar." :
              access.policyLinkVisit.status === "unknown" ? "La visita o su inventario no pudo comprobarse por completo." :
                `Documento ${access.policyLinkVisit.documentAccess === "accessible" ? "accesible" : "no accesible"}.`}
          </p>
          {access.policyLinkVisit.navigationStartedAtMs !== null && (
            <p>Inicio de navegación: {access.policyLinkVisit.navigationStartedAtMs} ms desde el inicio de esta fase.</p>
          )}
          {(["beforeNavigation", "afterNavigation"] as const).map((phase) => {
            const snapshot = access.policyLinkVisit?.[phase];
            if (!snapshot) return null;
            return (
              <div key={phase}>
                <h4>{phase === "beforeNavigation" ? "Antes de abrir el documento" : "Después de abrir el documento"} · {snapshot.capturedAtMs} ms</h4>
                <p>Lectura de cookies: {snapshot.cookieReadComplete ? "completa" : "incompleta"}; almacenamiento: {snapshot.storageReadComplete ? "completa" : "incompleta"}.</p>
                <ul>
                  {snapshot.cookies.map((cookie, index) => (
                    <li key={`${phase}-cookie-${index}`}>
                      Cookie {cookie.name} · {cookie.domain} · {cookie.secure ? "Secure" : "sin Secure"} · {cookie.httpOnly ? "HttpOnly" : "accesible desde JavaScript"} · SameSite={cookie.sameSite} · {cookie.expiresAtUnixSeconds === null ? "cookie de sesión" : `expira ${new Date(cookie.expiresAtUnixSeconds * 1000).toISOString().slice(0, 10)}`}
                    </li>
                  ))}
                  {snapshot.storageKeys.map((entry, index) => (
                    <li key={`${phase}-storage-${index}`}>
                      Almacenamiento {entry.kind} · {entry.name} · {entry.domain}
                    </li>
                  ))}
                  {snapshot.cookies.length === 0 && snapshot.storageKeys.length === 0 && (
                    <li>No se observaron nombres de cookies ni claves de almacenamiento en esta instantánea.</li>
                  )}
                </ul>
              </div>
            );
          })}
        </details>
      )}
    </section>
  );
}

function LegalCookieFindingsSection({ findings }: { findings: LegalCookieFinding[] }) {
  return (
    <section className="ds-portal__provider-contradiction" aria-labelledby="legal-cookie-findings-heading">
      <h3 id="legal-cookie-findings-heading">Incumplimientos legales acreditados</h3>
      {findings.map((finding) => (
        <article key={finding.ruleId} data-status="infraccion_legal_acreditada">
          <h4>{finding.title}</h4>
          <p>{finding.description}</p>
          <p>
            Norma: LSSI, artículos {finding.articles.map(({ article }) => article).join(", ")}.
            {" "}Autoridad competente: {finding.authority}.
          </p>
          <p>
            Máximo legal previsto: {finding.sanction.maximum.toLocaleString("es-ES")} {finding.sanction.currency}.
          </p>
          <p>Hechos observados:</p>
          <ul>
            {finding.evidence.map((evidence, index) => (
              <li key={finding.ruleId + "-" + index}>
                Cookie {evidence.cookieName} en {evidence.cookieDomain}; {evidence.provider}, finalidad {evidence.purpose};
                {" "}{evidence.flow === "initial" ? "antes de elegir" : evidence.phase === "after_choice" ? "después de rechazar" : "después de recargar el rechazo"}
                {" "}({evidence.capturedAtMs} ms).
              </li>
            ))}
          </ul>
          <p>
            Fuentes oficiales: {finding.articles.map((article, index) => (
              <span key={finding.ruleId + "-" + article.article}>
                {index > 0 ? " · " : ""}<a href={article.url} target="_blank" rel="noopener noreferrer">LSSI, artículo {article.article}</a>
              </span>
            ))}.
          </p>
        </article>
      ))}
    </section>
  );
}

function getLegalEvidenceElementLabel(element: string): string {
  const labels: Record<string, string> = {
    site_denies_or_omits_recipient: "Lo que declara el sitio sobre el destinatario",
    provider_receives_matching_data: "Lo que documenta el proveedor sobre la recepción",
    personal_data_in_flow: "Datos personales identificados en el flujo",
    audited_entity_is_controller: "Identificación de la entidad responsable",
    data_origin_is_established: "Origen de los datos",
    aepd_jurisdiction_is_established: "Competencia de la AEPD",
  };
  return labels[element] ?? "Elemento legal acreditado";
}

function getOfficialDocumentLabel(kind: string): string {
  const labels: Record<string, string> = {
    privacy: "información de privacidad",
    terms: "términos y condiciones",
    dpa: "acuerdo de tratamiento de datos",
    subprocessors: "lista de subencargados",
    "service-documentation": "documentación del servicio",
  };
  return labels[kind] ?? "documentación oficial";
}

function getPublicPurposeLabel(purposeId: string): string {
  const labels: Record<string, string> = {
    analytics: "medición de visitas y uso",
    advertising: "publicidad y medición de campañas",
    social: "integración con redes sociales",
    consent: "gestión de preferencias de privacidad",
    payments: "gestión de pagos",
    hosting: "alojamiento e infraestructura",
    support: "atención y soporte",
    security: "seguridad y prevención del fraude",
    ai_processing: "procesamiento de solicitudes de inteligencia artificial",
  };
  return labels[purposeId] ?? "una finalidad que el sitio identifica en su política";
}

const INTERNAL_AUDIT_COPY: Record<InternalAuditCriterionId, { label: string; pass: string; fail: string }> = {
  "infrastructure.tls": { label: "Conexión protegida", pass: "La conexión observada protege la información durante el envío.", fail: "Una conexión débil podría dejar la información expuesta o permitir que se altere durante el envío." },
  "infrastructure.headers": { label: "Protecciones del navegador", pass: "La respuesta incluye las protecciones del navegador comprobadas.", fail: "El navegador podría carecer de barreras que ayudan a frenar algunos ataques." },
  "infrastructure.network": { label: "Acceso a servicios", pass: "Los servicios comprobados responden dentro del alcance previsto.", fail: "Podrían quedar accesibles servicios que deberían permanecer restringidos." },
  "application.dependencies": { label: "Programas que usa la aplicación", pass: "Los programas revisados no muestran señales de riesgo conocidas en esta comprobación.", fail: "Un programa con riesgos conocidos podría afectar al funcionamiento o a la protección de la aplicación." },
  "application.secrets": { label: "Protección de claves de acceso", pass: "La revisión no encontró claves de acceso expuestas en los archivos de la aplicación.", fail: "Una clave expuesta podría permitir el acceso sin autorización a servicios o información." },
  "authentication.authorization": { label: "Acceso a cuentas y funciones", pass: "Las pruebas comprobaron que cada función revisada respeta quién puede usarla.", fail: "Una persona podría acceder a información o funciones que no le corresponden." },
  "quality.e2e": { label: "Recorridos principales", pass: "Las tareas principales comprobadas se completaron correctamente.", fail: "Algunas tareas importantes podrían no completarse como se espera." },
  "quality.accessibility": { label: "Accesibilidad", pass: "Las comprobaciones de accesibilidad cubiertas no encontraron barreras críticas.", fail: "Algunas personas podrían encontrar barreras para utilizar la aplicación." },
  "performance.page_load": { label: "Rapidez de carga y respuesta", pass: "La aplicación respondió dentro de los límites comprobados.", fail: "La aplicación podría tardar en mostrar contenido o responder a una acción." },
  "privacy.cookies": { label: "Datos guardados en el navegador", pass: "La comprobación no encontró almacenamiento de seguimiento no permitido.", fail: "Podrían guardarse datos de seguimiento o preferencias de forma no esperada." },
  "privacy.third_parties": { label: "Conexiones con otros servicios", pass: "Los servicios externos observados coinciden con la información publicada por Grumphya.", fail: "Podría compartirse información con servicios externos de forma no esperada." },
  "privacy.consent": { label: "Elección de privacidad", pass: "Las preferencias de privacidad comprobadas se respetaron.", fail: "La elección de privacidad podría no respetarse correctamente." },
  "ethics.transparency": { label: "Información sobre servicios externos", pass: "La información publicada incluye los servicios externos revisados.", fail: "Las personas podrían no saber qué servicios participan o para qué se usan." },
  "ai.disclosure": { label: "Información sobre inteligencia artificial", pass: "La información revisada explica dónde participa la inteligencia artificial.", fail: "Podría faltar información sobre el uso de inteligencia artificial." },
};

const INTERNAL_AUDIT_GROUPS: Array<{ title: string; criteria: InternalAuditCriterionId[] }> = [
  { title: "Conexión y protección", criteria: ["infrastructure.tls", "infrastructure.headers", "infrastructure.network"] },
  { title: "Aplicación y acceso", criteria: ["application.dependencies", "application.secrets", "authentication.authorization"] },
  { title: "Uso y experiencia", criteria: ["quality.e2e", "quality.accessibility", "performance.page_load"] },
  { title: "Datos e información", criteria: ["privacy.cookies", "privacy.third_parties", "privacy.consent", "ethics.transparency", "ai.disclosure"] },
];

function InternalAuditSummary({
  summary,
  state,
}: {
  summary: InternalAuditPublicSummary | null;
  state: "running" | "review" | "complete";
}) {
  const running = state === "running";
  const complete = state === "complete" && summary?.status === "complete";
  const review = !running && !complete;
  const states = new Map(summary?.criteria.map((criterion) => [criterion.id, criterion.status]));
  return (
    <section className="ds-portal__internal-audit" aria-labelledby="internal-audit-heading" data-status={running ? "running" : review ? "review" : "complete"} aria-busy={running}>
      <p className="ds-portal__eyebrow">Transparencia sobre la aplicación</p>
      <h3 id="internal-audit-heading">Lo que ocurre dentro de Grumphya</h3>
      <p>Grumphya ha decidido permitir una revisión de aspectos internos de su aplicación y compartir los resultados. Así puedes conocer más sobre cómo funciona y se protege. Estas comprobaciones amplían la información visible desde fuera; no cambian las notas de Ética o Privacidad ni garantizan que no vaya a haber problemas.</p>
      <p className="ds-portal__internal-audit-status" role="status" aria-live="polite" aria-atomic="true">
        {running
          ? <><span className="ds-portal__spinner" aria-hidden="true" />El informe se está actualizando. Estos resultados aparecerán cuando termine.</>
          : review
            ? "En revisión · todavía no hay un resultado vigente para mostrar."
            : summary?.observedAt
              ? `Revisión completada el ${formatDate(summary.observedAt)}.`
              : "Revisión completada; la fecha no está disponible."}
      </p>
      <div className="ds-portal__internal-audit-groups">
        {INTERNAL_AUDIT_GROUPS.map((group, index) => (
          <section className="ds-portal__internal-audit-group" key={group.title} aria-labelledby={`internal-audit-group-${index}`}>
            <h4 id={`internal-audit-group-${index}`}>{group.title}</h4>
            <ul className="ds-portal__internal-audit-list">
              {group.criteria.map((id) => {
          const status = review ? "unknown" : states.get(id) ?? "unknown";
          const copy = INTERNAL_AUDIT_COPY[id];
                const label = status === "pass" ? "Correcto" : status === "fail" ? "Atención" : status === "not_applicable" ? "No aplica" : running ? "Pendiente" : "En revisión";
                const description = status === "pass" ? copy.pass : status === "fail" ? copy.fail : status === "not_applicable" ? "Este aspecto no corresponde a la configuración observada." : running ? "El resultado estará disponible cuando termine la revisión." : "Todavía no hay un resultado vigente para este aspecto.";
                return <li key={id} data-status={status}><div><strong>{copy.label}</strong><p>{description}</p></div><span className="ds-portal__internal-audit-state" data-status={status}>{label}</span></li>;
        })}
            </ul>
          </section>
        ))}
      </div>
    </section>
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
              <strong>{getHistoryGlobalScoreLabel(entry.globalAssessment)}</strong>
              <small>
                {entry.profileVersion} · Ética {entry.score === null ? "sin nota" : `${entry.score}/100`} · {getHistoryVerdictLabel(entry.verdict)}
              </small>
            </a>
          </li>
        ))}
      </ol>
    </section>
  );
}

type PublicEthicsCriterion = PublicReport["ethicsAssessment"]["criteria"][number];

type CategoryScore = {
  score: number | null;
  assessedCriteria: number;
  totalCriteria: number;
};

type ReportCategory = (typeof REPORT_CATEGORIES)[number];

function useRevealOnView<T extends HTMLElement>() {
  const ref = useRef<T | null>(null);
  const [isVisible, setIsVisible] = useState(false);

  useEffect(() => {
    const element = ref.current;
    if (!element) return;

    if (typeof IntersectionObserver === "undefined") {
      setIsVisible(true);
      return;
    }

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry?.isIntersecting) return;
        setIsVisible(true);
        observer.disconnect();
      },
      { threshold: 0.25 },
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  return { ref, isVisible };
}

function GlobalScoreRing({ score, status }: { score: number | null; status: PublicReport["globalAssessment"]["status"] }) {
  const { ref, isVisible } = useRevealOnView<HTMLElement>();
  const value = score ?? 0;
  const radius = 52;
  const circumference = 2 * Math.PI * radius;
  const progress = Math.min(100, Math.max(0, value));
  const accessibleLabel =
    status === "review"
      ? "Puntuación global: en revisión"
      : status === "not_available"
        ? "Puntuación global: no disponible en este informe"
        : `Puntuación global: ${score} de 100 puntos`;

  return (
    <section
      ref={ref}
      className="ds-portal__score-ring"
      data-visible={isVisible}
      data-score-band={getScoreBand(score)}
      aria-label={accessibleLabel}
    >
      <svg
        className="ds-portal__score-ring-svg"
        viewBox="0 0 140 140"
        role="img"
        aria-label={accessibleLabel}
        focusable="false"
      >
        <circle className="ds-portal__score-ring-track" cx="70" cy="70" r={radius} />
        <circle
          className="ds-portal__score-ring-halo"
          cx="70"
          cy="70"
          r="60"
        />
        <circle
          className="ds-portal__score-ring-progress"
          cx="70"
          cy="70"
          r={radius}
          strokeDasharray={circumference}
          strokeDashoffset={
            isVisible ? circumference * (1 - progress / 100) : circumference
          }
        />
        <text className="ds-portal__score-ring-value" x="70" y="67" textAnchor="middle">
          {score === null ? "—" : score}
        </text>
        <text className="ds-portal__score-ring-unit" x="70" y="85" textAnchor="middle">
          /100
        </text>
      </svg>
      <span className="ds-portal__score-ring-caption">Valoración global</span>
    </section>
  );
}

function BetaEvaluationCharts({ criteria }: { criteria: PublicEthicsCriterion[] }) {
  return (
    <section className="ds-portal__beta-evaluation" aria-labelledby="beta-evaluation-heading">
      <div className="ds-portal__beta-evaluation-heading">
        <div>
          <p className="ds-portal__eyebrow">Lectura beta</p>
          <h3 id="beta-evaluation-heading">Niveles de evaluación</h3>
        </div>
        <p>La lectura separa lo observado, lo que no se observó y lo que todavía no tiene evidencia suficiente.</p>
      </div>
      <div className="ds-portal__beta-charts">
        {BETA_EVALUATION_LEVELS.map((level) => {
          const count = criteria.filter((criterion) =>
            (level.statuses as readonly string[]).includes(criterion.status),
          ).length;
          return (
            <BetaEvaluationChart
              key={level.id}
              id={level.id}
              label={level.label}
              value={count}
              max={criteria.length}
              valueLabel={`${criteria.length === 0 ? 0 : Math.round((count / criteria.length) * 100)}%`}
              detail={`${count} de ${criteria.length} criterios`}
              accessibleLabel={`${level.label}: ${count} de ${criteria.length} criterios (${criteria.length === 0 ? 0 : Math.round((count / criteria.length) * 100)}%)`}
            />
          );
        })}
      </div>
    </section>
  );
}

function BetaEvaluationChart({
  id,
  label,
  value,
  max,
  valueLabel,
  detail,
  accessibleLabel,
}: {
  id: string;
  label: string;
  value: number;
  max: number;
  valueLabel: string;
  detail: string;
  accessibleLabel: string;
}) {
  const { ref, isVisible } = useRevealOnView<HTMLElement>();
  const progress = max === 0 ? 0 : Math.min(100, Math.max(0, Math.round((value / max) * 100)));
  const radius = 44;
  const circumference = 2 * Math.PI * radius;

  return (
    <article
      ref={ref}
      className="ds-portal__beta-chart"
      data-level={id}
      data-visible={isVisible}
    >
      <svg
        className="ds-portal__beta-chart-svg"
        viewBox="0 0 120 120"
        role="img"
        aria-label={accessibleLabel}
        focusable="false"
      >
        <circle className="ds-portal__beta-chart-track" cx="60" cy="60" r={radius} />
        <circle
          className="ds-portal__beta-chart-progress"
          cx="60"
          cy="60"
          r={radius}
          strokeDasharray={circumference}
          strokeDashoffset={isVisible ? circumference * (1 - progress / 100) : circumference}
        />
        <text className="ds-portal__beta-chart-value" x="60" y="63" textAnchor="middle">
          {valueLabel}
        </text>
      </svg>
      <div>
        <h4>{label}</h4>
        <p>{detail}</p>
      </div>
    </article>
  );
}

function CategoryScoreRing({
  label,
  criteria,
}: {
  label: string;
  criteria: PublicEthicsCriterion[];
}) {
  const { ref, isVisible } = useRevealOnView<HTMLDivElement>();
  const categoryScore = getCategoryScore(criteria);
  const value = categoryScore.score ?? 0;
  const radius = 30;
  const circumference = 2 * Math.PI * radius;
  const accessibleLabel = categoryScore.score === null
    ? `${label}: sin puntuación; ${categoryScore.assessedCriteria} de ${categoryScore.totalCriteria} aspectos evaluados`
    : `${label}: ${categoryScore.score} de 100 puntos; ${categoryScore.assessedCriteria} de ${categoryScore.totalCriteria} aspectos evaluados`;

  return (
    <div
      ref={ref}
      className="ds-portal__category-score-ring"
      data-visible={isVisible}
      data-score-state={categoryScore.score === null ? "unknown" : "scored"}
      data-score-band={getScoreBand(categoryScore.score)}
      aria-label={accessibleLabel}
    >
      <svg
        className="ds-portal__category-score-ring-svg"
        viewBox="0 0 84 84"
        role="img"
        aria-label={accessibleLabel}
        focusable="false"
      >
        <circle className="ds-portal__category-score-ring-track" cx="42" cy="42" r={radius} />
        <circle
          className="ds-portal__category-score-ring-progress"
          cx="42"
          cy="42"
          r={radius}
          strokeDasharray={circumference}
          strokeDashoffset={isVisible ? circumference * (1 - value / 100) : circumference}
        />
        <text className="ds-portal__category-score-ring-value" x="42" y="40" textAnchor="middle">
          {categoryScore.score === null ? "—" : categoryScore.score}
        </text>
        <text className="ds-portal__category-score-ring-unit" x="42" y="53" textAnchor="middle">
          /100
        </text>
      </svg>
    </div>
  );
}

function CategoryDetailsModal({
  category,
  criteria,
  checks,
  publicPolicyAssessment,
  detailsId,
  onClose,
}: {
  category: ReportCategory;
  criteria: PublicEthicsCriterion[];
  checks: PublicReport["checks"];
  publicPolicyAssessment: PublicPolicyTransparencyAssessment | null;
  detailsId: string;
  onClose: () => void;
}) {
  const closeButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const previousFocus = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;
    const previousOverflow = document.body.style.overflow;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };

    document.body.style.overflow = "hidden";
    document.addEventListener("keydown", handleKeyDown);
    closeButtonRef.current?.focus();

    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", handleKeyDown);
      previousFocus?.focus();
    };
  }, [onClose]);

  return (
    <div
      className="ds-portal__category-modal-backdrop"
      role="presentation"
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        className="ds-portal__category-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby={`${detailsId}-heading`}
      >
        <header className="ds-portal__category-modal-heading">
          <div>
            <p className="ds-portal__eyebrow">Detalle de la evaluación</p>
            <h3 id={`${detailsId}-heading`}>{category.label}</h3>
          </div>
          <button
            ref={closeButtonRef}
            className="ds-portal__category-modal-close"
            type="button"
            onClick={onClose}
          >
            <span>Cerrar detalle</span>
            <span aria-hidden="true">×</span>
          </button>
        </header>
        <div className="ds-portal__category-details" id={detailsId}>
          <p>{category.description}</p>
          <ul className="ds-portal__ethics-criteria">
            {criteria.map((criterion) => (
              <li key={criterion.id} data-status={criterion.status}>
                <div>
                  <strong>{getCriterionDisplayLabel(criterion.id, criterion.label)}</strong>
                  <p><b>Comprobación:</b> {CRITERION_EXPLANATIONS[criterion.id]}</p>
                  <p><b>Qué implica:</b> {getCriterionOutcome(criterion.id, criterion.status)}</p>
                  <p className="ds-portal__criterion-evidence"><b>Dato observado:</b> {getCriterionEvidenceSummary(criterion.id, checks, publicPolicyAssessment)}</p>
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
                  <li
                    key={`${check.controlId}-${check.targetPath}-${check.method}`}
                    data-status={check.status}
                  >
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
        </div>
      </div>
    </div>
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
    (value.hostnameResolution !== undefined && !isHostnameResolution(value.hostnameResolution)) ||
    !isIsoTimestamp(value.checkedAt)
  ) {
    return false;
  }
  return (
    value.lastReport === null || value.lastReport.hostname === value.hostname ||
    (isHostnameResolution(value.hostnameResolution) &&
      value.lastReport.hostname === value.hostnameResolution.canonicalHostname)
  );
}

function isHostnameResolution(value: unknown): value is NonNullable<DomainStatus["hostnameResolution"]> {
  return isRecord(value) &&
    isUuid(value.observedReportId) &&
    (value.requestedHostname === "grumphya.com" || value.requestedHostname === "www.grumphya.com") &&
    (value.canonicalHostname === "grumphya.com" || value.canonicalHostname === "www.grumphya.com") &&
    value.requestedHostname !== value.canonicalHostname &&
    (value.statusCode === 301 || value.statusCode === 308) &&
    typeof value.responseStatusCode === "number" && Number.isInteger(value.responseStatusCode) && value.responseStatusCode >= 100 && value.responseStatusCode <= 599 &&
    value.fromHostname === value.requestedHostname &&
    value.toHostname === value.canonicalHostname;
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
    !isPrivacyAssessment(value.privacyAssessment) ||
    !isProcessorTransparencyAssessment(value.processorTransparencyAssessment) ||
    !isPublicPolicyTransparencyAssessment(value.publicPolicyTransparencyAssessment) ||
    !isPublicServiceComparison(value.publicServiceComparison) ||
    !(value.legalCookieFindings === undefined || parseLegalCookieFindings(value.legalCookieFindings) !== null) ||
    !(value.providerCatalogVersion === undefined || value.providerCatalogVersion === null || typeof value.providerCatalogVersion === "string" && /^[a-f0-9]{64}$/u.test(value.providerCatalogVersion)) ||
    !isFirstEntryPolicyAccess(value.firstEntryPolicyAccess) ||
    !isInternalAuditPublicSummary(value.internalAuditSummary) ||
    value.internalAuditState !== undefined && value.internalAuditState !== null &&
      !isOneOf(value.internalAuditState, ["running", "review", "complete"] as const) ||
    value.internalAuditSummary != null && value.hostname !== "grumphya.com" ||
    !isGlobalAssessment(value.globalAssessment) ||
    !isPublicCertification(value.certification) ||
    !Array.isArray(value.checks) ||
    value.checks.length === 0 ||
    value.checks.length > MAX_REPORT_CHECKS ||
    !value.checks.every(isPublicCheck)
  ) {
    return false;
  }
  const hasProcessorAssessment = value.processorTransparencyAssessment !== null;
  const hasPublicPolicyAssessment = value.publicPolicyTransparencyAssessment !== null;
  const hasPublicServiceComparison = value.publicServiceComparison != null;
  const usesV5PublicPolicy = value.ethicsAssessment.policyVersion === "domain-ethics-v5" &&
    value.profileVersion === "domain-v4" && value.scannerVersion === "domain-v4-network-adapter-2";
  const usesV6ServiceComparison = value.ethicsAssessment.policyVersion === "domain-ethics-v6" &&
    value.profileVersion === "domain-v4" && value.scannerVersion === "domain-v4-network-adapter-3";
  if ((value.ethicsAssessment.policyVersion === "domain-ethics-v3" && (hasProcessorAssessment || hasPublicPolicyAssessment)) ||
      (value.ethicsAssessment.policyVersion === "domain-ethics-v4" && (!hasProcessorAssessment || hasPublicPolicyAssessment)) ||
      usesV5PublicPolicy && !hasPublicPolicyAssessment ||
      usesV6ServiceComparison && !hasPublicServiceComparison ||
      hasPublicServiceComparison && !usesV6ServiceComparison ||
      value.ethicsAssessment.policyVersion === "domain-ethics-v5" && !hasProcessorAssessment && !hasPublicPolicyAssessment ||
      hasProcessorAssessment && !["grumphya.com", "desarrolloseguro.org"].includes(value.hostname)) return false;
  if (!isGlobalAssessmentConsistent(
    value.globalAssessment as PublicReport["globalAssessment"],
    value.ethicsAssessment as PublicReport["ethicsAssessment"],
    value.privacyAssessment as PublicReport["privacyAssessment"],
    hasAccreditedLegalViolation(value.legalCookieFindings, value.publicServiceComparison),
  )) return false;
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

function isFirstEntryPolicyAccess(value: unknown): value is FirstEntryPolicyAccess | null | undefined {
  return value === undefined || value === null || parseFirstEntryPolicyAccess(value) !== null;
}

function isInternalAuditPublicSummary(value: unknown): value is InternalAuditPublicSummary | null | undefined {
  if (value === undefined || value === null) return true;
  const ids: InternalAuditCriterionId[] = [
    "infrastructure.tls", "infrastructure.headers", "infrastructure.network",
    "application.dependencies", "application.secrets", "authentication.authorization",
    "quality.e2e", "quality.accessibility", "performance.page_load",
    "privacy.cookies", "privacy.third_parties", "privacy.consent",
    "ethics.transparency", "ai.disclosure",
  ];
  if (!isRecord(value) || value.policyVersion !== "internal-audit-public-v1" ||
      !isOneOf(value.status, ["complete", "review"] as const) ||
      !(value.observedAt === null || isIsoTimestamp(value.observedAt)) ||
      !Array.isArray(value.criteria) || value.criteria.length !== ids.length) return false;
  const criteria = value.criteria;
  if (!criteria.every((item, index) => isRecord(item) && item.id === ids[index] &&
      isOneOf(item.status, CHECK_STATUSES))) return false;
  return value.status === "complete"
    ? value.observedAt !== null && criteria.every((item) => isRecord(item) && item.status !== "unknown")
    : criteria.every((item) => isRecord(item) && item.status === "unknown");
}

function isPrivacyAssessment(value: unknown): value is NonNullable<PublicReport["privacyAssessment"]> | null | undefined {
  if (value === null || value === undefined) return true;
  if (!isRecord(value) || value.policyVersion !== "privacy-v1" ||
      (value.score !== null && (!isInteger(value.score) || value.score < 0 || value.score > 100)) ||
      !isInteger(value.assessedCriteria) || !isInteger(value.unknownCriteria) ||
      !isInteger(value.notApplicableCriteria) || value.totalCriteria !== 5 ||
      !isRecord(value.evidence) || !isEvidenceNames(value.evidence.cookieNames, 128) ||
      !isEvidenceNames(value.evidence.providers, 100) || !isEvidenceNames(value.evidence.domains, 253) ||
      !Array.isArray(value.criteria) || value.criteria.length !== 5) return false;
  const expected = [
    ["preference-before-tracking", 30], ["contextual-excess", 10], ["choice-parity", 20],
    ["rejection-persistence", 20], ["vendor-controls", 20],
  ] as const;
  if (!value.criteria.every((item, index) => {
    const [id, weight] = expected[index]!;
    return isRecord(item) && item.id === id && item.weight === weight && typeof item.label === "string" &&
      isOneOf(item.status, ["evaluated", "unknown", "not_applicable"] as const) &&
      (item.deduction === null || typeof item.deduction === "number" && Number.isFinite(item.deduction)) &&
      (item.awarded === null || typeof item.awarded === "number" && Number.isFinite(item.awarded)) &&
      isInteger(item.confirmedFindings) && item.confirmedFindings >= 0 &&
      isInteger(item.unknownFindings) && item.unknownFindings >= 0;
  })) return false;
  return value.criteria.filter((item) => isRecord(item) && item.status === "evaluated").length === value.assessedCriteria &&
    value.criteria.filter((item) => isRecord(item) && item.status === "unknown").length === value.unknownCriteria &&
    value.criteria.filter((item) => isRecord(item) && item.status === "not_applicable").length === value.notApplicableCriteria;
}

function isGlobalAssessment(value: unknown): value is PublicReport["globalAssessment"] {
  if (!isRecord(value) || value.policyVersion !== "mvp-global-v2" ||
      !isOneOf(value.status, ["scored", "review", "not_available"] as const) ||
      (value.score !== null && (!isInteger(value.score) || value.score < 0 || value.score > 100)) ||
      typeof value.legalViolationAccredited !== "boolean" ||
      !isRecord(value.weights) || value.weights.ethics !== 50 || value.weights.privacy !== 50 ||
      !isRecord(value.ethicsCoverage) || !isInteger(value.ethicsCoverage.assessedCriteria) ||
      !isInteger(value.ethicsCoverage.totalCriteria) ||
      !(value.privacyCoverage === null || isRecord(value.privacyCoverage) &&
        isInteger(value.privacyCoverage.assessedCriteria) &&
        isInteger(value.privacyCoverage.unknownCriteria) &&
        isInteger(value.privacyCoverage.notApplicableCriteria) &&
        isInteger(value.privacyCoverage.totalCriteria))) return false;
  if (value.status === "scored") return value.score !== null && value.privacyCoverage !== null;
  return value.score === null;
}

function hasAccreditedLegalViolation(cookieFindings: unknown, serviceComparison: unknown): boolean {
  const parsedCookieFindings = parseLegalCookieFindings(cookieFindings);
  const parsedServiceComparison = parsePublicServiceComparison(serviceComparison);
  return Boolean(parsedCookieFindings?.length) || Boolean(
    parsedServiceComparison?.providerDocumentation?.some(({ comparisons }) =>
      comparisons.some(({ legalFinding }) => legalFinding?.status === "infraccion_legal_acreditada"),
    ),
  );
}

function isGlobalAssessmentConsistent(
  global: PublicReport["globalAssessment"],
  ethics: PublicReport["ethicsAssessment"],
  privacy: PublicReport["privacyAssessment"],
  legalViolationAccredited: boolean,
): boolean {
  if (global.legalViolationAccredited !== legalViolationAccredited) return false;
  if (global.ethicsCoverage.assessedCriteria !== ethics.assessedCriteria ||
      global.ethicsCoverage.totalCriteria !== ethics.totalCriteria) return false;
  if (legalViolationAccredited) {
    if (global.status !== "scored" || global.score !== 0) return false;
    return privacy === null || privacy === undefined
      ? global.privacyCoverage === null
      : global.privacyCoverage !== null &&
        global.privacyCoverage.assessedCriteria === privacy.assessedCriteria &&
        global.privacyCoverage.unknownCriteria === privacy.unknownCriteria &&
        global.privacyCoverage.notApplicableCriteria === privacy.notApplicableCriteria &&
        global.privacyCoverage.totalCriteria === privacy.totalCriteria;
  }
  if (privacy === null || privacy === undefined) {
    return global.status === "not_available" && global.score === null && global.privacyCoverage === null;
  }
  const coverage = global.privacyCoverage;
  if (coverage === null || coverage.assessedCriteria !== privacy.assessedCriteria ||
      coverage.unknownCriteria !== privacy.unknownCriteria ||
      coverage.notApplicableCriteria !== privacy.notApplicableCriteria ||
      coverage.totalCriteria !== privacy.totalCriteria) return false;
  const complete = ethics.score !== null && ethics.assessedCriteria === ethics.totalCriteria &&
    privacy.score !== null && privacy.unknownCriteria === 0 &&
    privacy.assessedCriteria + privacy.notApplicableCriteria === privacy.totalCriteria;
  if (!complete) return global.status === "review" && global.score === null;
  return global.status === "scored" && global.score === Math.round((ethics.score! + privacy.score!) / 2);
}

function isEvidenceNames(value: unknown, maxLength: number): value is string[] {
  return Array.isArray(value) && value.length <= 100 && value.every((item) =>
    typeof item === "string" && item.length > 0 && item.length <= maxLength && isCleanEvidenceText(item),
  ) && new Set(value).size === value.length;
}

function isCleanEvidenceText(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code <= 31 || code === 127) return false;
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
      isGlobalAssessment(entry.globalAssessment) &&
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
    !isOneOf(value.policyVersion, ["domain-ethics-v3", "domain-ethics-v4", "domain-ethics-v5", "domain-ethics-v6"] as const) ||
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

function isPublicPolicyTransparencyAssessment(value: unknown): value is PublicPolicyTransparencyAssessment | null {
  if (value === null) return true;
  if (!isRecord(value) || value.policyVersion !== "public-policy-v1" ||
      !isOneOf(value.status, ["pass", "fail", "unknown"] as const) ||
      !isOneOf(value.reasonCode, [
        "disclosure_found", "policy_link_missing", "policy_content_missing",
        "policy_page_unavailable", "service_purpose_missing", "access_denied",
        "auditor_error", "budget_exhausted",
      ] as const) || !isRecord(value.evidence)) return false;
  const evidence = value.evidence;
  if (!isInteger(evidence.linksFound) || evidence.linksFound < 0 || evidence.linksFound > 30 ||
      !isInteger(evidence.pagesInspected) || evidence.pagesInspected < 0 || evidence.pagesInspected > 30 ||
      !isInteger(evidence.unavailablePages) || evidence.unavailablePages < 0 || evidence.unavailablePages > 30 ||
      !isInteger(evidence.accessDeniedPages) || evidence.accessDeniedPages < 0 || evidence.accessDeniedPages > 30 ||
      !isInteger(evidence.providerMentions) || evidence.providerMentions < 0 || evidence.providerMentions > 300 ||
      !isInteger(evidence.providersMissingPurpose) || evidence.providersMissingPurpose < 0 || evidence.providersMissingPurpose > 30 || evidence.providersMissingPurpose > evidence.providerMentions ||
      !Array.isArray(evidence.categories) || evidence.categories.length > 5 ||
      !evidence.categories.every((category) => isOneOf(category, ["analytics", "advertising", "social", "consent", "other"] as const)) ||
      new Set(evidence.categories).size !== evidence.categories.length) return false;
  if (value.reasonCode === "auditor_error" || value.reasonCode === "budget_exhausted") {
    return value.status === "unknown" && evidence.unavailablePages === 0 && evidence.accessDeniedPages === 0;
  }
  if (value.reasonCode === "access_denied") return value.status === "fail" && evidence.accessDeniedPages > 0;
  if (value.reasonCode === "policy_page_unavailable") return value.status === "fail" && evidence.unavailablePages > 0;
  if (value.reasonCode === "policy_link_missing") return value.status === "fail" && evidence.linksFound === 0;
  if (value.reasonCode === "policy_content_missing") return value.status === "fail" && evidence.linksFound > 0 && evidence.pagesInspected === 0;
  if (value.reasonCode === "service_purpose_missing") return value.status === "fail" && evidence.pagesInspected > 0 && (evidence.providerMentions === 0 || evidence.providersMissingPurpose > 0 || evidence.categories.length === 0);
  return value.status === "pass" && evidence.linksFound > 0 && evidence.pagesInspected > 0 && evidence.providerMentions > 0 && evidence.providersMissingPurpose === 0 && evidence.categories.length > 0;
}

function isPublicServiceComparison(value: unknown): value is PublicServiceComparison | null | undefined {
  return value === undefined || value === null || parsePublicServiceComparison(value) !== null;
}

function isProcessorTransparencyAssessment(value: unknown): value is PublicProcessorTransparencyAssessment | null {
  if (value === null) return true;
  if (!isRecord(value) || value.policyVersion !== "processor-inventory-v1" ||
      !isOneOf(value.status, ["pass", "fail", "unknown"] as const) ||
      !isOneOf(value.reasonCode, [
        "inventory_complete_and_disclosed", "inventory_complete_empty", "processor_not_disclosed",
        "inventory_incomplete", "endpoint_missing", "auditor_error",
      ] as const)) return false;
  if (value.inventory === null) {
    return value.status === "fail" && value.reasonCode === "endpoint_missing" ||
      value.status === "unknown" && value.reasonCode === "auditor_error";
  }
  if (!isRecord(value.inventory)) return false;
  const inventory = value.inventory;
  if (inventory.policyVersion !== "processor-inventory-v1" ||
      !isOneOf(inventory.hostname, ["grumphya.com", "desarrolloseguro.org"] as const) ||
      !isIsoTimestamp(inventory.observedAt) || !isIsoTimestamp(inventory.validUntil) ||
      typeof inventory.deploymentDigest !== "string" || !/^sha256:[a-f0-9]{64}$/u.test(inventory.deploymentDigest) ||
      !isOneOf(inventory.inventoryStatus, ["complete", "incomplete"] as const) ||
      !isRecord(inventory.privacyPolicy) ||
      typeof inventory.privacyPolicy.revision !== "string" || !/^v[1-9][0-9]*$/u.test(inventory.privacyPolicy.revision) ||
      !isRecord(inventory.attestation) || inventory.attestation.verified !== true ||
      typeof inventory.attestation.keyId !== "string" || !Array.isArray(inventory.processors) ||
      inventory.processors.length > 32 || !inventory.processors.every(isProcessorDisclosure)) return false;
  const grumphyaInventory = inventory.hostname === "grumphya.com" &&
    inventory.privacyPolicy.url === "https://grumphya.com/politica-de-privacidad" &&
    inventory.attestation.keyId === "grumphya-release-2026" &&
    (inventory.evidenceSource === undefined || inventory.evidenceSource === "grumphya_signed_attestation");
  const selfInventory = inventory.hostname === "desarrolloseguro.org" &&
    inventory.privacyPolicy.url === "https://desarrolloseguro.org/desarrollo-seguro/privacidad.html" &&
    inventory.attestation.keyId === "desarrolloseguro-source-registry-v1" &&
    inventory.evidenceSource === "desarrolloseguro_source_registry" &&
    inventory.inventoryStatus === "complete";
  if (!grumphyaInventory && !selfInventory) return false;
  const expected = inventory.inventoryStatus === "incomplete"
    ? ["fail", "inventory_incomplete"]
    : inventory.processors.some((processor) => isRecord(processor) && processor.disclosureStatus === "missing")
      ? ["fail", "processor_not_disclosed"]
      : inventory.processors.length === 0
        ? ["pass", "inventory_complete_empty"]
        : ["pass", "inventory_complete_and_disclosed"];
  return value.status === expected[0] && value.reasonCode === expected[1];
}

function isProcessorDisclosure(value: unknown): value is PublicProcessorDisclosure {
  if (!isRecord(value) || typeof value.providerId !== "string" || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(value.providerId) ||
      !isBoundedString(value.displayName, 120) || !isBoundedString(value.product, 120)) return false;
  if (value.disclosureStatus === "missing") {
    return Object.keys(value).sort((left, right) => left.localeCompare(right, "en")).join(",") === "disclosureStatus,displayName,product,providerId";
  }
  return value.disclosureStatus === "published" &&
    Object.keys(value).sort((left, right) => left.localeCompare(right, "en")).join(",") === "declaredStatements,disclosureStatus,displayName,policyUrl,product,providerId,purpose" &&
    isBoundedString(value.purpose, 500) && typeof value.policyUrl === "string" &&
    (value.policyUrl.startsWith("https://grumphya.com/politica-de-privacidad#") ||
      value.policyUrl.startsWith("https://desarrolloseguro.org/desarrollo-seguro/privacidad.html#")) &&
    Array.isArray(value.declaredStatements) && value.declaredStatements.length <= 10 &&
    value.declaredStatements.every((statement) => isBoundedString(statement, 500));
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

function getScoreBand(score: number | null): "excellent" | "good" | "low" | "unknown" {
  if (score === null) return "unknown";
  if (score >= 90) return "excellent";
  if (score >= 75) return "good";
  return "low";
}

function getCategoryScore(criteria: Array<{ status: string; weight: number }>): CategoryScore {
  const assessed = criteria.filter((criterion) => criterion.status !== "unknown");
  if (assessed.length === 0) {
    return { score: null, assessedCriteria: 0, totalCriteria: criteria.length };
  }
  const totalWeight = assessed.reduce((sum, criterion) => sum + criterion.weight, 0);
  const passedWeight = assessed
    .filter((criterion) => criterion.status === "pass")
    .reduce((sum, criterion) => sum + criterion.weight, 0);
  return {
    score: totalWeight === 0 ? null : Math.round((passedWeight / totalWeight) * 100),
    assessedCriteria: assessed.length,
    totalCriteria: criteria.length,
  };
}

function getCategoryScoreLabel(criteria: Array<{ status: string; weight: number }>): string {
  const categoryScore = getCategoryScore(criteria);
  if (categoryScore.score === null) return "Sin datos suficientes";
  const coverage = `${categoryScore.assessedCriteria} de ${categoryScore.totalCriteria} aspectos evaluados`;
  if (categoryScore.assessedCriteria < categoryScore.totalCriteria) {
    return `${categoryScore.score}/100 provisional · ${coverage}`;
  }
  return `${categoryScore.score}/100 · ${coverage}`;
}

function getCategorySummary(criteria: Array<{ status: string }>, state: string): string {
  const assessed = criteria.filter((criterion) => criterion.status !== "unknown");
  const problems = assessed.filter((criterion) => criterion.status === "fail").length;
  const unknown = criteria.length - assessed.length;
  if (assessed.length === 0) {
    return state === "updating"
      ? "Esta comprobación está en curso."
      : "No se pudo completar esta comprobación.";
  }
  if (problems > 0) {
    return unknown > 0
      ? `${problems} comprobación${problems === 1 ? "" : "es"} con hallazgos; ${unknown} no se pudo${unknown === 1 ? "" : "n"} completar.`
      : `${problems} comprobación${problems === 1 ? "" : "es"} con hallazgos.`;
  }
  if (unknown > 0) {
    return state === "updating"
      ? "Esta parte sigue en comprobación."
      : `${unknown} comprobación${unknown === 1 ? "" : "es"} no se pudo${unknown === 1 ? "" : "n"} completar.`;
  }
  return "Las comprobaciones de esta parte no encontraron riesgos.";
}

function getReportTakeaway(report: PublicReport, state: string): string {
  const criteria = report.ethicsAssessment.criteria;
  const assessed = criteria.filter((criterion) => criterion.status !== "unknown");
  const problems = assessed.filter((criterion) => criterion.status === "fail").length;
  const unknown = criteria.length - assessed.length;
  if (report.globalAssessment.legalViolationAccredited) {
    return "Se ha acreditado un incumplimiento legal; la puntuación global es 0/100. Las valoraciones técnicas por área se muestran por separado.";
  }
  if (report.globalAssessment.status === "not_available") {
    return state === "updating"
      ? "La revisión sigue en curso."
      : "El informe terminó sin datos suficientes para una valoración global.";
  }
  if (report.globalAssessment.status === "review") {
    if (state !== "updating") {
      return problems > 0
        ? `El informe terminó con ${problems} hallazgo${problems === 1 ? "" : "s"} y ${unknown} comprobación${unknown === 1 ? "" : "es"} sin completar.`
        : "El informe terminó con comprobaciones sin completar.";
    }
    return problems > 0
      ? "Hay hallazgos y la revisión sigue en curso."
      : "La revisión sigue en curso.";
  }
  if (assessed.length === 0) {
    return state === "updating"
      ? "La revisión sigue en curso."
      : "El informe terminó sin datos suficientes para una valoración.";
  }
  if (problems > 0) {
    return `La revisión encontró ${problems} hallazgo${problems === 1 ? "" : "s"}. Consulta el detalle.`;
  }
  if (unknown > 0) {
    return state === "updating"
      ? "Las comprobaciones restantes siguen en curso."
      : "El informe terminó con comprobaciones sin completar.";
  }
  return "La revisión no encontró riesgos en los aspectos comprobados.";
}

function getCriterionOutcome(criterionId: string, status: string): string {
  if (status === "unknown") return "Comprobación incompleta por un error técnico del auditor; no se atribuye al dominio.";
  if (status === "fail") return CRITERION_FAIL_MEANINGS[criterionId] ?? "La comprobación detectó un incumplimiento del criterio.";
  const outcomes: Record<string, string> = {
    "dns-integrity": "El dominio resolvió a direcciones públicas durante esta comprobación; esto no confirma quién lo controla.",
    "transport-security": "La conexión superó las comprobaciones de TLS incluidas en este informe.",
    "http-availability": "La portada respondió según lo esperado y usó una conexión segura en esta comprobación.",
    "security-headers": "Las protecciones comprobadas estaban presentes en la respuesta observada.",
    "third-party-data-use": "No se ha podido confirmar el uso que terceros hacen de los datos.",
    "external-service-transparency": "Comparamos las conexiones observadas con la información que publica el sitio sobre sus proveedores y para qué los utiliza.",
    "initial-cookie-risk": "No se reconocieron cookies con riesgo en la primera respuesta observada.",
    tracking: "No se encontraron referencias conocidas a rastreadores en el HTML inicial; no se ejecutaron scripts.",
    performance: "La respuesta inicial quedó dentro del umbral orientativo de esta comprobación; no representa la experiencia completa.",
  };
  return outcomes[criterionId] ?? "Esta comprobación no encontró una señal de riesgo.";
}

function getCriterionEvidenceSummary(
  criterionId: string,
  checks: PublicCheck[],
  publicPolicyAssessment: PublicPolicyTransparencyAssessment | null = null,
): string {
  if (criterionId === "external-service-transparency" && publicPolicyAssessment) {
    return publicPolicyAssessment.status === "pass"
      ? "La información pública del sitio explica servicios externos y para qué se usan."
      : publicPolicyAssessment.status === "fail"
        ? getPublicPolicyTransparencySummary(publicPolicyAssessment)
        : "La comprobación de la información pública sigue en revisión.";
  }
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
    case "third-party-data-use": {
      const inspected = flag("inspected");
      const privacyLinks = number("privacyPolicyLinksFound");
      const pagesFetched = number("policyPagesFetched");
      const missingPages = number("policyPagesMissing");
      const deniedPages = number("policyPagesDenied");
      const recipients = flag("policyRecipientsMentioned");
      const purposes = flag("policyPurposesMentioned");
      const blocked = flag("policyTextBlocked");
      if (inspected === null) break;
      if (privacyLinks === 0) return "No se encontró un enlace a la política de privacidad del sitio.";
      if (deniedPages !== null && deniedPages > 0 || blocked === true) {
        return "El sitio que publica la política denegó el acceso al auditor.";
      }
      if (missingPages !== null && missingPages > 0) {
        return `No se pudo abrir ${missingPages} enlace${missingPages === 1 ? "" : "s"} a información pública.`;
      }
      if (pagesFetched !== null && pagesFetched > 0) {
        return `Se revisaron ${pagesFetched} documento${pagesFetched === 1 ? "" : "s"} público${pagesFetched === 1 ? "" : "s"}; ${recipients ? "se encontró información sobre destinatarios" : "no se encontró información sobre destinatarios"} y ${purposes ? "sobre finalidades" : "sobre finalidades no se encontró información"}.`;
      }
      break;
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
    "external-service-transparency": [],
    "backend-processor-transparency": [],
    "initial-cookie-risk": ["DS-PRIV-05"],
    tracking: ["DS-PRIV-06"],
    performance: ["DS-QUAL-02"],
  };
  return controlIds[criterionId] ?? [];
}

function getProcessorTransparencySummary(
  assessment: PublicProcessorTransparencyAssessment,
): string {
  if (assessment.reasonCode === "auditor_error") {
    return "No pudimos completar esta comprobación por un error técnico de nuestro sistema. Queda en revisión y no cuenta como un incumplimiento del dominio.";
  }
  if (assessment.reasonCode === "endpoint_missing") {
    return "No está disponible la información pública necesaria para comprobar qué servicios externos participan y para qué. Esto se considera una falta de transparencia.";
  }
  if (assessment.reasonCode === "inventory_incomplete") {
    return "Grumphya declara que su lista no incluye todos los servicios externos que utiliza.";
  }
  if (assessment.reasonCode === "processor_not_disclosed") {
    return "Hay servicios externos activos que no aparecen en la información publicada.";
  }
  if (assessment.reasonCode === "inventory_complete_empty") {
    return assessment.inventory?.hostname === "desarrolloseguro.org"
      ? "Desarrollo Seguro declara que no hay proveedores externos activos en el inventario de producción publicado."
      : "La revisión interna no encontró servicios externos activos en los sistemas de producción cubiertos.";
  }
  return assessment.inventory?.hostname === "desarrolloseguro.org"
    ? "Desarrollo Seguro declara que su inventario de producción está completo; los proveedores incluidos aparecen en su política de privacidad."
    : "Grumphya declara que la lista de servicios externos está completa y los servicios incluidos aparecen en su política de privacidad.";
}

function getPublicPolicyTransparencySummary(
  assessment: PublicPolicyTransparencyAssessment,
): string {
  switch (assessment.reasonCode) {
    case "disclosure_found":
      return "La información pública del sitio identifica servicios externos y explica para qué se usan.";
    case "policy_link_missing":
      return "No encontramos información pública que explique qué servicios externos usa el sitio. Por eso no se puede saber qué entidades pueden recibir datos.";
    case "policy_content_missing":
      return "El sitio enlaza información sobre sus servicios, pero su contenido no se pudo consultar.";
    case "policy_page_unavailable":
      return "La información pública enlazada no estaba disponible. Así, las personas no pueden revisar qué servicios se usan.";
    case "service_purpose_missing":
      return "La información pública no explica con claridad qué servicios externos se usan ni para qué.";
    case "access_denied":
      return "No fue posible consultar la información pública sobre los servicios externos.";
    case "auditor_error":
      return "La comprobación terminó sin resultado por un error técnico del auditor.";
    case "budget_exhausted":
      return "La comprobación terminó incompleta al alcanzar el límite del auditor.";
  }
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
    "external-service-transparency": "Información pública sobre servicios externos",
    "backend-processor-transparency": "Servicios externos declarados por el titular",
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
    "DS-PRIV-04": "Información pública sobre servicios externos",
    "DS-PRIV-05": "Cookies de la primera respuesta",
    "DS-PRIV-06": "Referencias a rastreadores conocidos",
    "DS-QUAL-02": "Tiempo y tamaño de respuesta",
  };
  return labels[controlId] ?? controlId;
}

function getHistoryVerdictLabel(verdict: ScanVerdict): string {
  return VERDICT_LABELS[verdict] ?? "En revisión";
}

function getHistoryGlobalScoreLabel(assessment: PublicReportHistoryEntry["globalAssessment"]): string {
  if (assessment.status === "scored") return `Global ${assessment.score}/100`;
  return assessment.status === "review" ? "En revisión" : "Sin nota global";
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
  if (state === "loading") return "Estamos registrando la solicitud. Puede tardar unos segundos.";
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
