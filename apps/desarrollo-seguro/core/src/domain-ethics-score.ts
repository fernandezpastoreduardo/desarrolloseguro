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
  policyVersion: "domain-ethics-v3";
  score: number | null;
  assessedCriteria: number;
  totalCriteria: number;
  maturity: "preliminary" | "partial" | "broad";
  criteria: EthicsCriterion[];
  reasons: string[];
  interpretation: string;
};

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
  tracking: "No se han inspeccionado scripts de analítica, rastreadores o mapas de calor.",
  performance: "No se han medido métricas de rendimiento de página.",
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
    interpretation: "Indicador provisional de DNS, TLS, HTTP, cabeceras y cookies conocidas en la respuesta inicial. No evalúa el consentimiento real, las prácticas de datos de terceros, los rastreadores dinámicos ni el rendimiento; no es una certificación.",
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
