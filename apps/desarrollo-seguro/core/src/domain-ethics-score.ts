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
  policyVersion: "domain-ethics-v3" | "domain-ethics-v4";
  score: number | null;
  assessedCriteria: number;
  totalCriteria: number;
  maturity: "preliminary" | "partial" | "broad";
  criteria: EthicsCriterion[];
  reasons: string[];
  interpretation: string;
};

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
    interpretation: "Indicador provisional basado en señales públicas de DNS, TLS, HTTP, cabeceras, cookies, referencias del HTML inicial, rendimiento de respuesta e inventario backend firmado. Las declaraciones de privacidad se atribuyen al titular; la observación de navegador y los procesadores backend son evidencias separadas. No verifica contratos ni prácticas de los proveedores, y no es una certificación.",
  };
}

const CRITERIA = [
  { id: "dns-integrity", label: "Resolución DNS", weight: 10, controls: ["DS-DNS-01"] },
  { id: "transport-security", label: "Seguridad del transporte TLS", weight: 25, controls: ["DS-TLS-01", "DS-TLS-02"] },
  { id: "http-availability", label: "Respuesta HTTP", weight: 15, controls: ["DS-HTTP-01"] },
  { id: "security-headers", label: "Cabeceras de seguridad", weight: 20, controls: ["DS-HDR-01"] },
  { id: "third-party-data-use", label: "Reutilización o venta de datos por terceros", weight: 10, controls: ["DS-PRIV-04"] },
  { id: "initial-cookie-risk", label: "Cookies conocidas en la respuesta inicial", weight: 10, controls: ["DS-PRIV-05"] },
  { id: "tracking", label: "Rastreadores y mapas de calor", weight: 5, controls: ["DS-PRIV-06"] },
  { id: "performance", label: "Rendimiento", weight: 5, controls: ["DS-QUAL-02"] },
] as const;

const UNVERIFIED_THIRD_PARTY_REASON =
  "No hay evidencia verificable sobre reutilización o venta de datos por terceros.";
const UNKNOWN_REASONS: Record<string, string> = {
  "transport-security": "No se han comprobado todas las versiones de TLS incluidas en este criterio.",
  "third-party-data-use": UNVERIFIED_THIRD_PARTY_REASON,
  "initial-cookie-risk": "No se pudo inspeccionar la respuesta inicial; no se ha evaluado el comportamiento posterior del consentimiento.",
  tracking: "No se midieron conexiones ni scripts ejecutados; la comprobación se limita a referencias del HTML inicial.",
  performance: "No se midieron el tiempo y el tamaño de la respuesta inicial.",
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
    interpretation: "Indicador provisional basado en señales públicas de DNS, TLS, HTTP, cabeceras, cookies, referencias del HTML inicial a rastreadores conocidos y una medición de respuesta. No evalúa el consentimiento real, las prácticas de datos de terceros, conexiones o scripts dinámicos, ni la experiencia completa de rendimiento; no es una certificación.",
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
