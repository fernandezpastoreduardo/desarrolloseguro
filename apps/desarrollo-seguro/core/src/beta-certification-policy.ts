export type BetaControlId =
  | "DS-TLS-01"
  | "DS-TLS-02"
  | "DS-HDR-01"
  | "DS-PRIV-05";

export type BetaControlObservation = {
  controlId: BetaControlId;
  status: "pass" | "fail" | "unknown";
  summary: string;
};

export type BetaCategoryStatus = "pass" | "fail" | "unknown";

export type BetaCertificationCategory = {
  id: "transport-security" | "security-headers" | "privacy-cookies";
  label: string;
  status: BetaCategoryStatus;
  weight: number;
};

export type BetaCertificationAssessment = {
  policyVersion: "beta-0.1";
  threshold: 90;
  score: number | null;
  eligibility: "eligible" | "pending" | "blocked";
  assessedCategories: number;
  totalCategories: number;
  categories: BetaCertificationCategory[];
  reasons: string[];
};

type CategoryDefinition = Omit<BetaCertificationCategory, "status"> & {
  controlIds: readonly BetaControlId[];
  critical: boolean;
};

const CATEGORY_DEFINITIONS: readonly CategoryDefinition[] = [
  {
    id: "transport-security",
    label: "Seguridad TLS",
    weight: 40,
    controlIds: ["DS-TLS-01", "DS-TLS-02"],
    critical: true,
  },
  {
    id: "security-headers",
    label: "Cabeceras de seguridad",
    weight: 30,
    controlIds: ["DS-HDR-01"],
    critical: false,
  },
  {
    id: "privacy-cookies",
    label: "Cookies y privacidad observable",
    weight: 30,
    controlIds: ["DS-PRIV-05"],
    critical: false,
  },
];

const BETA_SCORE_THRESHOLD = 90;

export function assessBetaCertification(input: unknown): BetaCertificationAssessment {
  const observations = normalizeObservations(input);
  const categories = CATEGORY_DEFINITIONS.map((definition) => ({
    id: definition.id,
    label: definition.label,
    weight: definition.weight,
    status: deriveCategoryStatus(definition.controlIds, observations),
  }));
  const assessed = categories.filter(({ status }) => status !== "unknown");
  const assessedWeight = assessed.reduce((sum, category) => sum + category.weight, 0);
  const passedWeight = assessed
    .filter(({ status }) => status === "pass")
    .reduce((sum, category) => sum + category.weight, 0);
  const score = assessedWeight === 0 ? null : Math.round((passedWeight / assessedWeight) * 100);
  const hasCriticalFailure = CATEGORY_DEFINITIONS.some((definition, index) =>
    definition.critical && categories[index]?.status === "fail",
  );
  const eligibility = deriveEligibility(score, assessed.length, categories.length, hasCriticalFailure);

  return {
    policyVersion: "beta-0.1",
    threshold: BETA_SCORE_THRESHOLD,
    score,
    eligibility,
    assessedCategories: assessed.length,
    totalCategories: categories.length,
    categories,
    reasons: buildReasons(categories, score, hasCriticalFailure),
  };
}

function normalizeObservations(input: unknown): Map<BetaControlId, BetaControlObservation["status"]> {
  const statuses = new Map<BetaControlId, BetaControlObservation["status"]>();
  if (!Array.isArray(input)) return statuses;

  for (const item of input) {
    if (!isBetaControlObservation(item)) continue;
    const previous = statuses.get(item.controlId);
    if (previous === undefined) {
      statuses.set(item.controlId, item.status);
      continue;
    }
    if (previous !== item.status) statuses.set(item.controlId, "unknown");
  }
  return statuses;
}

function isBetaControlObservation(value: unknown): value is BetaControlObservation {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const candidate = value as Record<string, unknown>;
  return isBetaControlId(candidate.controlId) &&
    ["pass", "fail", "unknown"].includes(String(candidate.status)) &&
    typeof candidate.summary === "string";
}

function isBetaControlId(value: unknown): value is BetaControlId {
  return ["DS-TLS-01", "DS-TLS-02", "DS-HDR-01", "DS-PRIV-05"].includes(String(value));
}

function deriveCategoryStatus(
  controlIds: readonly BetaControlId[],
  observations: Map<BetaControlId, BetaControlObservation["status"]>,
): BetaCategoryStatus {
  const statuses = controlIds.map((controlId) => observations.get(controlId));
  if (statuses.some((status) => status === "fail")) return "fail";
  if (statuses.some((status) => status === "unknown" || status === undefined)) return "unknown";
  return "pass";
}

function deriveEligibility(
  score: number | null,
  assessedCategories: number,
  totalCategories: number,
  hasCriticalFailure: boolean,
): BetaCertificationAssessment["eligibility"] {
  if (hasCriticalFailure) return "blocked";
  if (assessedCategories < totalCategories || score === null) return "pending";
  return score >= BETA_SCORE_THRESHOLD ? "eligible" : "blocked";
}

function buildReasons(
  categories: readonly BetaCertificationCategory[],
  score: number | null,
  hasCriticalFailure: boolean,
): string[] {
  const reasons = categories.flatMap((category) => {
    if (category.status === "unknown") return [`${category.label}: falta evidencia concluyente.`];
    if (category.status === "fail" && category.id !== "transport-security") {
      return [`${category.label}: el control observado presenta fallos.`];
    }
    return [];
  });
  if (hasCriticalFailure) reasons.push("Seguridad TLS: existe un incumplimiento crítico.");
  if (score !== null && score < BETA_SCORE_THRESHOLD) {
    reasons.push("La puntuación provisional queda por debajo de 90.");
  }
  return reasons;
}
