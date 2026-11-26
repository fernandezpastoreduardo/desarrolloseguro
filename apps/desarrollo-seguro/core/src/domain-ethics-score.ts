import type { ProcessorTransparencyAssessment } from "./processor-inventory.js";
import { parsePublicPolicyTransparencyAssessment } from "./public-policy-assessment.js";
import { parsePublicServiceComparison } from "./public-service-comparison.js";

export type EthicsCheck = {
  controlId: string;
  status: "pass" | "fail" | "unknown" | "not_applicable";
  summary: string;
};

export type EthicsCriterion = {
  id: string;
  label: string;
  status: "pass" | "fail" | "unknown";
  weight: number;
};

export type DomainEthicsAssessment = {
  policyVersion: "domain-ethics-v3" | "domain-ethics-v4" | "domain-ethics-v5" | "domain-ethics-v6";
  score: number | null;
  assessedCriteria: number;
  totalCriteria: number;
  maturity: "preliminary" | "partial" | "broad";
  criteria: EthicsCriterion[];
  reasons: string[];
  interpretation: string;
};

export function assessDomainEthicsV6(checks: unknown, publicServiceInput: unknown): DomainEthicsAssessment {
  const comparison = parsePublicServiceComparison(publicServiceInput);
  const base = assessDomainEthics(checks);
  const status = comparison?.status ?? "unknown";
  const criteria = base.criteria.map((criterion): EthicsCriterion => criterion.id === "third-party-data-use"
    ? { id: "external-service-transparency", label: "Información pública sobre servicios externos", weight: 10, status }
    : criterion);
  const assessed = criteria.filter(({ status: criterionStatus }) => criterionStatus !== "unknown");
  const assessedWeight = assessed.reduce((sum, criterion) => sum + criterion.weight, 0);
  const passedWeight = assessed.filter(({ status: criterionStatus }) => criterionStatus === "pass")
    .reduce((sum, criterion) => sum + criterion.weight, 0);
  const reason = comparison?.reasonCode === "observed_service_undisclosed"
    ? "Se observó un servicio externo que la información pública no identifica junto con su finalidad."
    : comparison?.reasonCode === "provider_documentation_contradiction"
      ? "La información pública del sitio contradice un hecho documentado por el proveedor del servicio."
    : comparison?.reasonCode === "public_policy_missing"
      ? "No se encontró información pública suficiente para saber qué servicios externos utiliza el sitio."
      : comparison?.reasonCode === "auditor_error"
        ? "La comparación de servicios sigue en revisión porque falló una comprobación técnica."
        : "";
  return {
    policyVersion: "domain-ethics-v6",
    score: assessedWeight === 0 ? null : Math.round((passedWeight / assessedWeight) * 100),
    assessedCriteria: assessed.length,
    totalCriteria: criteria.length,
    maturity: assessed.length < 4 ? "preliminary" : assessed.length < criteria.length ? "partial" : "broad",
    criteria,
    reasons: criteria.flatMap((criterion) => criterion.id === "external-service-transparency"
      ? criterion.status === "pass" ? [] : [reason]
      : criterion.status === "fail" ? [`${criterion.label}: el control observado presenta fallos.`]
        : criterion.status === "unknown" && UNKNOWN_REASONS[criterion.id] ? [UNKNOWN_REASONS[criterion.id]] : []),
    interpretation: "Todos los dominios se valoran con las mismas señales públicas: los servicios observados, lo que el sitio declara y la información que publican los propios proveedores. La información interna que algunos titulares comparten aparece aparte y no altera esta nota.",
  };
}

export function assessDomainEthicsV4(
  checks: unknown,
  processorTransparency: import("./processor-inventory.js").ProcessorTransparencyAssessment | null,
): DomainEthicsAssessment {
  const legacy = assessDomainEthics(checks);
  const processorStatus = processorTransparency?.status ?? "unknown";
  const criteria = legacy.criteria.map((criterion): EthicsCriterion => criterion.id === "third-party-data-use"
    ? { id: "backend-processor-transparency", label: "Transparencia de procesadores backend", weight: criterion.weight, status: processorStatus }
    : criterion);
  const assessed = criteria.filter(({ status }) => status !== "unknown");
  const assessedWeight = assessed.reduce((sum, criterion) => sum + criterion.weight, 0);
  const passedWeight = assessed.filter(({ status }) => status === "pass")
    .reduce((sum, criterion) => sum + criterion.weight, 0);
  const processorReason = processorTransparency?.reasonCode === "auditor_error"
    ? "El auditor no pudo verificar el inventario de procesadores backend."
    : processorTransparency?.reasonCode === "endpoint_missing"
      ? "El dominio no ofrece el inventario autenticado de procesadores backend."
      : processorTransparency?.reasonCode === "inventory_incomplete"
        ? "Grumphya declara que su inventario de procesadores backend está incompleto."
        : processorTransparency?.reasonCode === "processor_not_disclosed"
          ? "Hay procesadores backend activos que no aparecen declarados en la política de privacidad."
          : undefined;
  const reasons = criteria.flatMap((criterion) => {
    if (criterion.id === "backend-processor-transparency") {
      if (criterion.status === "fail" && processorReason) return [processorReason];
      if (criterion.status === "unknown") return ["El auditor no obtuvo evidencia verificable del inventario de procesadores backend."];
      return [];
    }
    if (criterion.status === "fail") return [`${criterion.label}: el control observado presenta fallos.`];
    if (criterion.status === "unknown") return UNKNOWN_REASONS[criterion.id] ? [UNKNOWN_REASONS[criterion.id]] : [];
    return [];
  });

  return {
    policyVersion: "domain-ethics-v4",
    score: assessedWeight === 0 ? null : Math.round((passedWeight / assessedWeight) * 100),
    assessedCriteria: assessed.length,
    totalCriteria: criteria.length,
    maturity: assessed.length < 4 ? "preliminary" : assessed.length < criteria.length ? "partial" : "broad",
    criteria,
    reasons,
    interpretation: "Esta nota resume señales observadas en la página y en la información que publica su titular. Comparamos lo publicado con las conexiones y servicios que pudimos revisar. No podemos comprobar contratos privados ni todas las prácticas de esos servicios.",
  };
}

export function assessDomainEthicsV5(
  checks: unknown,
  processorTransparency: ProcessorTransparencyAssessment | null,
  publicPolicyInput?: unknown,
): DomainEthicsAssessment {
  if (publicPolicyInput === undefined) {
  const assessment = processorTransparency
    ? assessDomainEthicsV4(checks, processorTransparency)
    : assessDomainEthics(checks);
  return {
    ...assessment,
    policyVersion: "domain-ethics-v5",
    interpretation: "Ética no es una opinión moral: resume la transparencia del sitio y señales públicas sobre prácticas que pueden afectar a las personas. Las declaraciones del titular se distinguen de lo observado por el auditor; no se afirman como hechos las prácticas internas de proveedores. La falta de información pública exigible se penaliza y un error técnico del auditor deja el punto en revisión.",
  };
  }
  const base = assessDomainEthics(checks);
  // The public comparison is the same for every domain. A signed private
  // inventory is supplementary evidence and must never replace this score.
  const publicPolicy = parsePublicPolicyTransparencyAssessment(publicPolicyInput);
  const transparencyStatus = publicPolicy?.status ?? "unknown";
  const transparencyReason = getV5TransparencyReason(null, publicPolicy);
  const criteria = base.criteria.map((criterion): EthicsCriterion => criterion.id === "third-party-data-use"
    ? {
        id: "external-service-transparency",
        label: "Información pública sobre servicios externos",
        weight: 10,
        status: transparencyStatus,
      }
    : criterion);
  const assessed = criteria.filter(({ status }) => status !== "unknown");
  const assessedWeight = assessed.reduce((sum, criterion) => sum + criterion.weight, 0);
  const passedWeight = assessed.filter(({ status }) => status === "pass")
    .reduce((sum, criterion) => sum + criterion.weight, 0);
  const reasons = criteria.flatMap((criterion) => {
    if (criterion.id === "external-service-transparency") {
      return criterion.status === "pass" ? [] : [transparencyReason];
    }
    if (criterion.status === "fail") return [`${criterion.label}: el control observado presenta fallos.`];
    if (criterion.status === "unknown") return UNKNOWN_REASONS[criterion.id] ? [UNKNOWN_REASONS[criterion.id]] : [];
    return [];
  });

  return {
    policyVersion: "domain-ethics-v5",
    score: assessedWeight === 0 ? null : Math.round((passedWeight / assessedWeight) * 100),
    assessedCriteria: assessed.length,
    totalCriteria: criteria.length,
    maturity: assessed.length < 4 ? "preliminary" : assessed.length < criteria.length ? "partial" : "broad",
    criteria,
    reasons,
    interpretation: "Ética resume señales públicas que pueden afectar a quienes usan el sitio. Todos los dominios se valoran con la misma información pública sobre sus servicios externos. Algunos titulares comparten además datos internos en un bloque separado; ese aporte no cambia esta nota.",
  };
}

function getV5TransparencyReason(
  processorTransparency: ProcessorTransparencyAssessment | null,
  publicPolicy: ReturnType<typeof parsePublicPolicyTransparencyAssessment>,
): string {
  if (processorTransparency) {
    if (processorTransparency.reasonCode === "auditor_error") return "El auditor no pudo verificar el inventario de procesadores backend.";
    if (processorTransparency.reasonCode === "endpoint_missing") return "El dominio no ofrece el inventario autenticado de procesadores backend.";
    if (processorTransparency.reasonCode === "inventory_incomplete") return "El dominio declara que su inventario de procesadores backend está incompleto.";
    if (processorTransparency.reasonCode === "processor_not_disclosed") return "Hay procesadores backend activos que no aparecen declarados en la política de privacidad.";
    return "No hay evidencia verificable del inventario backend.";
  }
  switch (publicPolicy?.reasonCode) {
    case "policy_link_missing": return "No se encontró una política pública que explique los servicios externos.";
    case "policy_content_missing": return "No se pudo leer el contenido de la política enlazada.";
    case "policy_page_unavailable": return "Una política enlazada no está disponible (404, 410 o error del servidor).";
    case "service_purpose_missing": return "La información pública no explica qué servicios externos se usan ni para qué.";
    case "access_denied": return "El sitio impidió consultar información pública sobre sus servicios externos.";
    case "auditor_error": return "Un error del auditor impidió comprobar la información pública sobre servicios externos.";
    case "budget_exhausted": return "El auditor alcanzó el límite aprobado para consultar políticas; el resultado queda sin evaluar.";
    case "disclosure_found": return "La información pública sobre servicios externos está disponible.";
    default: return "El auditor no generó una evaluación válida de la política pública.";
  }
}

const CRITERIA = [
  { id: "dns-integrity", label: "Resolución DNS", weight: 10, controls: ["DS-DNS-01"] },
  { id: "transport-security", label: "Seguridad del transporte TLS", weight: 25, controls: ["DS-TLS-01", "DS-TLS-02"] },
  { id: "http-availability", label: "Respuesta HTTP", weight: 15, controls: ["DS-HTTP-01"] },
  { id: "security-headers", label: "Cabeceras de seguridad", weight: 20, controls: ["DS-HDR-01"] },
  { id: "third-party-data-use", label: "Transparencia sobre servicios externos", weight: 10, controls: ["DS-PRIV-04"] },
  { id: "initial-cookie-risk", label: "Cookies conocidas en la respuesta inicial", weight: 10, controls: ["DS-PRIV-05"] },
  { id: "tracking", label: "Rastreadores y mapas de calor", weight: 5, controls: ["DS-PRIV-06"] },
  { id: "performance", label: "Rendimiento", weight: 5, controls: ["DS-QUAL-02"] },
] as const;

const UNKNOWN_REASONS: Record<string, string> = {
  "transport-security": "No se han comprobado todas las versiones de TLS incluidas en este criterio.",
  "third-party-data-use": "El auditor no pudo terminar la revisión de la información pública sobre servicios externos.",
  "initial-cookie-risk": "No se pudo inspeccionar la respuesta inicial; no se ha evaluado el comportamiento posterior del consentimiento.",
  tracking: "No se midieron conexiones ni scripts ejecutados; la comprobación se limita a referencias del HTML inicial.",
  performance: "Faltan métricas requeridas de móvil o escritorio.",
};

export function assessDomainEthics(checks: unknown): DomainEthicsAssessment {
  const observed = normalizeChecks(checks);
  const criteria: EthicsCriterion[] = CRITERIA.map((criterion) => ({
    id: criterion.id,
    label: criterion.label,
    weight: criterion.weight,
    status: deriveStatus(criterion.controls, observed),
  }));
  const assessed = criteria.filter(({ status }) => status !== "unknown");
  const assessedWeight = assessed.reduce((sum, criterion) => sum + criterion.weight, 0);
  const passedWeight = assessed
    .filter(({ status }) => status === "pass")
    .reduce((sum, criterion) => sum + criterion.weight, 0);
  const score = assessedWeight === 0 ? null : Math.round((passedWeight / assessedWeight) * 100);
  const reasons = criteria.flatMap((criterion) => {
    if (criterion.status === "fail") return [`${criterion.label}: el control observado presenta fallos.`];
    if (criterion.status === "unknown") return UNKNOWN_REASONS[criterion.id] ? [UNKNOWN_REASONS[criterion.id]] : [];
    return [];
  });

  return {
    policyVersion: "domain-ethics-v3",
    score,
    assessedCriteria: assessed.length,
    totalCriteria: criteria.length,
    maturity: assessed.length < 4 ? "preliminary" : assessed.length < criteria.length ? "partial" : "broad",
    criteria,
    reasons,
    interpretation: "Ética no es una opinión moral: resume la transparencia del sitio y señales públicas sobre prácticas que pueden afectar a las personas. Las declaraciones del titular se distinguen de lo observado por el auditor; no se afirman como hechos las prácticas internas de proveedores. La falta de información pública exigible se penaliza y un error técnico del auditor deja el punto en revisión.",
  };
}

function normalizeChecks(input: unknown): Map<string, Array<EthicsCheck["status"]>> {
  const result = new Map<string, Array<EthicsCheck["status"]>>();
  if (!Array.isArray(input)) return result;

  for (const item of input) {
    if (!isEthicsCheck(item)) continue;
    const statuses = result.get(item.controlId) ?? [];
    if (statuses.length > 0 && !statuses.includes(item.status)) {
      result.set(item.controlId, ["unknown"]);
      continue;
    }
    statuses.push(item.status);
    result.set(item.controlId, statuses);
  }
  return result;
}

function isEthicsCheck(value: unknown): value is EthicsCheck {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const candidate = value as Record<string, unknown>;
  return typeof candidate.controlId === "string" &&
    ["pass", "fail", "unknown", "not_applicable"].includes(String(candidate.status)) &&
    typeof candidate.summary === "string";
}

function deriveStatus(
  controls: readonly string[],
  checks: Map<string, Array<EthicsCheck["status"]>>,
): EthicsCriterion["status"] {
  if (controls.length === 0) return "unknown";
  const statuses = controls.map((control) => checks.get(control));
  if (statuses.some((controlStatuses) => controlStatuses?.includes("fail"))) {
    return "fail";
  }
  if (statuses.some((controlStatuses) => controlStatuses?.includes("unknown"))) {
    return "unknown";
  }
  if (statuses.some((controlStatuses) => !controlStatuses || controlStatuses.length === 0)) {
    return "unknown";
  }
  if (statuses.some((controlStatuses) => controlStatuses?.includes("not_applicable"))) {
    return "unknown";
  }
  return "pass";
}
