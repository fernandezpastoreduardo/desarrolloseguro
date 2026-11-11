import { normalizeHostname } from "./scan-policy.js";

const PROFILE_VERSION_V1 = "controls-v1";
const PROFILE_VERSION_V2 = "controls-v2";
const PROFILE_VERSION_V3 = "controls-v3";
const PROFILE_VERSION_TRANSPORT_V1 = "transport-v1";
const PROFILE_VERSION_DOMAIN_V1 = "domain-v1";
type ProfileVersion =
  | typeof PROFILE_VERSION_V1
  | typeof PROFILE_VERSION_V2
  | typeof PROFILE_VERSION_V3
  | typeof PROFILE_VERSION_TRANSPORT_V1
  | typeof PROFILE_VERSION_DOMAIN_V1;
const MAX_SCOPE_PATHS = 3;
const MAX_CHECKS = 32;
const MAX_EVIDENCE_COUNT = 100_000;
const ALLOWED_SCOPE_PATHS = ["/", "/precios", "/informe"] as const;
const ALLOWED_SEVERITIES = ["critical", "high", "medium", "low", "info"];
const ALLOWED_STATUSES = ["pass", "fail", "unknown", "not_applicable"];

type SafeEvidenceValue = boolean | number | string;

export type SanitizedScanCheck = {
  controlId: string;
  status: "pass" | "fail" | "unknown" | "not_applicable";
  required: true;
  severity: string;
  observedAt: Date;
  targetPath: string;
  method: string;
  summary: string;
  limitation: string;
  evidence: Record<string, SafeEvidenceValue>;
};

export type SanitizedScanObservations = {
  scope: readonly string[];
  checks: readonly SanitizedScanCheck[];
};

export function getCanonicalScanPaths(hostname: unknown): readonly string[] {
  normalizeHostname(hostname);
  return ALLOWED_SCOPE_PATHS;
}

type ControlContract = {
  methodsByPath: Readonly<Record<string, readonly string[]>>;
  evidence: Readonly<
    Record<string, "boolean" | "count" | "http_status" | readonly string[]>
  >;
};

const PAGE_PATHS = ALLOWED_SCOPE_PATHS;
const READ_METHODS = ["GET"] as const;
const HTTP_METHODS = ["HEAD", "GET"] as const;
const TRANSPORT_V1_CONTROLS = [
  "DS-DNS-01",
  "DS-TLS-01",
  "DS-HTTP-01",
  "DS-HDR-01",
] as const;
const DOMAIN_V1_CONTROLS = [...TRANSPORT_V1_CONTROLS, "DS-PRIV-05"] as const;
const CONTROLS: Readonly<Record<string, ControlContract>> = {
  "DS-DNS-01": {
    methodsByPath: { "/": ["DNS"] },
    evidence: {
      addressClass: ["public", "private", "reserved", "unresolved"],
      aRecordCount: "count",
      aaaaRecordCount: "count",
    },
  },
  "DS-TLS-01": {
    methodsByPath: { "/": ["TLS"] },
    evidence: {
      protocol: ["TLSv1.2", "TLSv1.3"],
      certificateValid: "boolean",
      hostnameMatches: "boolean",
    },
  },
  "DS-TLS-02": {
    methodsByPath: { "/": ["TLS"] },
    evidence: {
      tls10Accepted: "boolean",
      tls11Accepted: "boolean",
      tls12Accepted: "boolean",
      tls13Accepted: "boolean",
    },
  },
  "DS-HTTP-01": {
    methodsByPath: pathsFor(HTTP_METHODS),
    evidence: {
      statusCode: "http_status",
      redirectedToHttps: "boolean",
      finalScheme: ["http", "https"],
    },
  },
  "DS-HDR-01": {
    methodsByPath: pathsFor(READ_METHODS),
    evidence: {
      finalScheme: ["http", "https"],
      hsts: "boolean",
      nosniff: "boolean",
      frameProtection: "boolean",
      referrerPolicy: "boolean",
      csp: "boolean",
    },
  },
  "DS-PRIV-01": {
    methodsByPath: pathsFor(READ_METHODS),
    evidence: {
      thirdPartyAttempts: "count",
      blockedRequests: "count",
    },
  },
  "DS-PRIV-02": {
    methodsByPath: pathsFor(READ_METHODS),
    evidence: {
      cookieCount: "count",
      insecureCookieCount: "count",
      thirdPartyCookieCount: "count",
      inspected: "boolean",
    },
  },
  "DS-PRIV-03": {
    methodsByPath: pathsFor(READ_METHODS),
    evidence: {
      mixedContentCount: "count",
      insecureNavigationCount: "count",
    },
  },
  "DS-PRIV-05": {
    methodsByPath: pathsFor(READ_METHODS),
    evidence: {
      inspected: "boolean",
      cookieCount: "count",
      insecureCookieCount: "count",
      catalogMatchCount: "count",
      consentPromptDetected: "boolean",
    },
  },
  "DS-QUAL-01": {
    methodsByPath: pathsFor(READ_METHODS),
    evidence: {
      documentStatusCode: "http_status",
      failedEssentialResourceCount: "count",
    },
  },
};
const ALL_CONTROL_IDS = Object.keys(CONTROLS).filter(
  (controlId) => controlId !== "DS-PRIV-05",
);
const PROFILE_CONTROLS: Readonly<Record<ProfileVersion, readonly string[]>> = {
  [PROFILE_VERSION_V1]: ALL_CONTROL_IDS,
  [PROFILE_VERSION_V2]: ALL_CONTROL_IDS,
  [PROFILE_VERSION_V3]: ALL_CONTROL_IDS,
  [PROFILE_VERSION_TRANSPORT_V1]: TRANSPORT_V1_CONTROLS,
  [PROFILE_VERSION_DOMAIN_V1]: DOMAIN_V1_CONTROLS,
};

export function sanitizeScanObservations(
  hostname: unknown,
  profileVersion: unknown,
  scope: unknown,
  checks: unknown,
): SanitizedScanObservations {
  const safeHostname = normalizeHostname(hostname);
  if (!isProfileVersion(profileVersion)) {
    throw new Error("scan_profile_not_allowlisted");
  }

  const allowedPaths = getCanonicalScanPaths(safeHostname);
  const profilePaths =
    profileVersion === PROFILE_VERSION_TRANSPORT_V1 ||
    profileVersion === PROFILE_VERSION_DOMAIN_V1
      ? ["/"]
      : allowedPaths;
  const safeScope = sanitizeScope(scope, profilePaths);
  if (
    !Array.isArray(checks) ||
    checks.length === 0 ||
    checks.length > MAX_CHECKS
  ) {
    throw new Error("scan_checks_required");
  }

  const allowedControlIds = PROFILE_CONTROLS[profileVersion];
  const safeChecks = checks.map((check) =>
    sanitizeCheck(check, safeScope, profileVersion, allowedControlIds),
  );
  const controlPaths = new Set(
    safeChecks.map(
      (check) => `${check.controlId}:${check.targetPath}:${check.method}`,
    ),
  );
  if (controlPaths.size !== safeChecks.length) {
    throw new Error("scan_check_duplicate");
  }
  if (
    profileVersion === PROFILE_VERSION_V2 ||
    profileVersion === PROFILE_VERSION_V3 ||
    profileVersion === PROFILE_VERSION_TRANSPORT_V1 ||
    profileVersion === PROFILE_VERSION_DOMAIN_V1
  ) {
    assertCompleteCoverage(safeScope, safeChecks, allowedControlIds);
  }

  return { scope: safeScope, checks: safeChecks };
}

function isProfileVersion(value: unknown): value is ProfileVersion {
  return (
    value === PROFILE_VERSION_V1 ||
    value === PROFILE_VERSION_V2 ||
    value === PROFILE_VERSION_V3 ||
    value === PROFILE_VERSION_TRANSPORT_V1 ||
    value === PROFILE_VERSION_DOMAIN_V1
  );
}

function assertCompleteCoverage(
  scope: readonly string[],
  checks: readonly SanitizedScanCheck[],
  allowedControlIds: readonly string[],
): void {
  const expectedCoverage = new Set<string>();
  for (const controlId of allowedControlIds) {
    const contract = CONTROLS[controlId];
    if (!contract) throw new Error("scan_profile_not_allowlisted");
    for (const targetPath of scope) {
      const methods = contract.methodsByPath[targetPath] ?? [];
      for (const method of methods) {
        expectedCoverage.add(coverageKey(controlId, targetPath, method));
      }
    }
  }

  const submittedCoverage = new Set(
    checks.map((check) =>
      coverageKey(check.controlId, check.targetPath, check.method),
    ),
  );
  if (
    expectedCoverage.size !== submittedCoverage.size ||
    [...expectedCoverage].some((key) => !submittedCoverage.has(key))
  ) {
    throw new Error("scan_check_coverage_incomplete");
  }
}

function coverageKey(controlId: string, targetPath: string, method: string) {
  return `${controlId}:${targetPath}:${method}`;
}

function sanitizeScope(
  scope: unknown,
  allowedPaths: readonly string[],
): readonly string[] {
  if (
    !Array.isArray(scope) ||
    scope.length === 0 ||
    scope.length > MAX_SCOPE_PATHS ||
    scope.some(
      (path) => typeof path !== "string" || !allowedPaths.includes(path),
    ) ||
    new Set(scope).size !== scope.length ||
    !scope.includes("/")
  ) {
    throw new Error("scan_scope_not_allowlisted");
  }
  return [...scope];
}

function sanitizeCheck(
  check: unknown,
  scope: readonly string[],
  profileVersion: ProfileVersion,
  allowedControlIds: readonly string[],
): SanitizedScanCheck {
  if (!isPlainRecord(check)) throw new Error("scan_check_invalid");

  const controlId = check.controlId;
  if (
    typeof controlId !== "string" ||
    !allowedControlIds.includes(controlId) ||
    !Object.hasOwn(CONTROLS, controlId)
  ) {
    throw new Error("scan_control_not_allowlisted");
  }
  const contract = CONTROLS[controlId];
  const targetPath = check.targetPath;
  const method = check.method;
  if (
    typeof targetPath !== "string" ||
    typeof method !== "string" ||
    !contract.methodsByPath[targetPath]?.includes(method) ||
    (method !== "DNS" && method !== "TLS" && !scope.includes(targetPath))
  ) {
    throw new Error("scan_check_scope_not_allowlisted");
  }

  if (
    !ALLOWED_STATUSES.includes(String(check.status)) ||
    check.required !== true ||
    typeof check.severity !== "string" ||
    !ALLOWED_SEVERITIES.includes(check.severity) ||
    !isValidDate(check.observedAt)
  ) {
    throw new Error("scan_check_invalid");
  }

  const evidence = sanitizeEvidence(
    contract,
    controlId,
    profileVersion,
    check.evidence,
  );
  if (
    controlId === "DS-DNS-01" &&
    ["private", "reserved"].includes(String(evidence.addressClass))
  ) {
    throw new Error("scan_destination_not_public");
  }
  const status = deriveSafeStatus(
    profileVersion,
    controlId,
    method,
    String(check.status),
    evidence,
  );

  return {
    controlId,
    status,
    required: true,
    severity: check.severity,
    observedAt: new Date(check.observedAt),
    targetPath,
    method,
    summary: getSafeCheckSummary(controlId, status, evidence),
    limitation: `Resultado limitado a las rutas públicas declaradas del perfil ${profileVersion}.`,
    evidence,
  };
}

function getSafeCheckSummary(
  controlId: string,
  status: string,
  evidence: Record<string, SafeEvidenceValue>,
): string {
  if (controlId !== "DS-PRIV-05") {
    return `Comprobación ${controlId}: ${status}.`;
  }
  if (
    evidence.inspected !== true ||
    typeof evidence.cookieCount !== "number" ||
    typeof evidence.insecureCookieCount !== "number" ||
    typeof evidence.catalogMatchCount !== "number" ||
    typeof evidence.consentPromptDetected !== "boolean"
  ) {
    return "No se pudo inspeccionar la respuesta inicial para detectar cookies conocidas; criterio no evaluado.";
  }
  return `Cookies en respuesta inicial: ${evidence.cookieCount}; coincidencias con la tabla local Analytics/Marketing: ${evidence.catalogMatchCount}; sin atributo Secure: ${evidence.insecureCookieCount}. No se interactuó con el banner de consentimiento.`;
}

function deriveSafeStatus(
  profileVersion: ProfileVersion,
  controlId: string,
  method: string,
  submittedStatus: string,
  evidence: Record<string, SafeEvidenceValue>,
): SanitizedScanCheck["status"] {
  if (
    (profileVersion === PROFILE_VERSION_V2 ||
      profileVersion === PROFILE_VERSION_V3 ||
      profileVersion === PROFILE_VERSION_TRANSPORT_V1 ||
      profileVersion === PROFILE_VERSION_DOMAIN_V1) &&
    controlId === "DS-HTTP-01" &&
    method === "HEAD" &&
    [405, 501].includes(Number(evidence.statusCode)) &&
    evidence.redirectedToHttps === true &&
    evidence.finalScheme === "https"
  ) {
    return "unknown";
  }
  if (
    (profileVersion === PROFILE_VERSION_V3 ||
      profileVersion === PROFILE_VERSION_TRANSPORT_V1 ||
      profileVersion === PROFILE_VERSION_DOMAIN_V1) &&
    controlId === "DS-HDR-01" &&
    evidence.finalScheme !== "https"
  ) {
    return "unknown";
  }
  if (submittedStatus === "not_applicable") return "unknown";
  if (submittedStatus !== "pass") {
    return submittedStatus as SanitizedScanCheck["status"];
  }

  const requiredEvidence = getRequiredEvidence(profileVersion, controlId);
  if (!requiredEvidence || !requiredEvidence.every((key) => key in evidence)) {
    return "unknown";
  }

  const failed = CONTROL_FAILURES[controlId]?.(evidence) ?? false;
  if (failed) return "fail";

  return CONTROL_PASSES[controlId]?.(evidence) ? "pass" : "unknown";
}

const REQUIRED_EVIDENCE: Readonly<Record<string, readonly string[]>> = {
  "DS-DNS-01": ["addressClass", "aRecordCount", "aaaaRecordCount"],
  "DS-TLS-01": ["protocol", "certificateValid", "hostnameMatches"],
  "DS-TLS-02": [
    "tls10Accepted",
    "tls11Accepted",
    "tls12Accepted",
    "tls13Accepted",
  ],
  "DS-HTTP-01": ["statusCode", "redirectedToHttps", "finalScheme"],
  "DS-HDR-01": ["hsts", "nosniff", "frameProtection", "referrerPolicy", "csp"],
  "DS-PRIV-01": ["thirdPartyAttempts", "blockedRequests"],
  "DS-PRIV-02": [
    "cookieCount",
    "insecureCookieCount",
    "thirdPartyCookieCount",
    "inspected",
  ],
  "DS-PRIV-05": [
    "inspected",
    "cookieCount",
    "insecureCookieCount",
    "catalogMatchCount",
    "consentPromptDetected",
  ],
  "DS-PRIV-03": ["mixedContentCount", "insecureNavigationCount"],
  "DS-QUAL-01": ["documentStatusCode", "failedEssentialResourceCount"],
};

function getRequiredEvidence(
  profileVersion: ProfileVersion,
  controlId: string,
): readonly string[] | undefined {
  const controlEvidence = REQUIRED_EVIDENCE[controlId];
  if (
    (profileVersion === PROFILE_VERSION_V3 ||
      profileVersion === PROFILE_VERSION_TRANSPORT_V1 ||
      profileVersion === PROFILE_VERSION_DOMAIN_V1) &&
    controlId === "DS-HDR-01"
  ) {
    return [...(controlEvidence ?? []), "finalScheme"];
  }
  return controlEvidence;
}

type EvidencePredicate = (
  evidence: Record<string, SafeEvidenceValue>,
) => boolean;

const CONTROL_FAILURES: Readonly<Record<string, EvidencePredicate>> = {
  "DS-TLS-01": (evidence) =>
    evidence.certificateValid === false || evidence.hostnameMatches === false,
  "DS-TLS-02": (evidence) =>
    evidence.tls10Accepted === true || evidence.tls11Accepted === true,
  "DS-HTTP-01": (evidence) =>
    Number(evidence.statusCode) >= 400 ||
    evidence.redirectedToHttps === false ||
    evidence.finalScheme === "http",
  "DS-HDR-01": (evidence) =>
    ["hsts", "nosniff", "frameProtection", "referrerPolicy", "csp"].some(
      (key) => evidence[key] === false,
    ),
  "DS-PRIV-01": (evidence) => Number(evidence.thirdPartyAttempts) > 0,
  "DS-PRIV-02": (evidence) =>
    Number(evidence.insecureCookieCount) > 0 ||
    Number(evidence.thirdPartyCookieCount) > 0,
  "DS-PRIV-05": (evidence) =>
    Number(evidence.catalogMatchCount) > 0,
  "DS-PRIV-03": (evidence) =>
    Number(evidence.mixedContentCount) > 0 ||
    Number(evidence.insecureNavigationCount) > 0,
  "DS-QUAL-01": (evidence) =>
    Number(evidence.documentStatusCode) >= 400 ||
    Number(evidence.failedEssentialResourceCount) > 0,
};

const CONTROL_PASSES: Readonly<Record<string, EvidencePredicate>> = {
  "DS-DNS-01": (evidence) =>
    evidence.addressClass === "public" &&
    Number(evidence.aRecordCount) + Number(evidence.aaaaRecordCount) > 0,
  "DS-TLS-01": (evidence) =>
    evidence.certificateValid === true && evidence.hostnameMatches === true,
  "DS-TLS-02": (evidence) =>
    evidence.tls10Accepted === false &&
    evidence.tls11Accepted === false &&
    (evidence.tls12Accepted === true || evidence.tls13Accepted === true),
  "DS-HTTP-01": (evidence) =>
    Number(evidence.statusCode) >= 200 &&
    Number(evidence.statusCode) < 400 &&
    evidence.redirectedToHttps === true &&
    evidence.finalScheme === "https",
  "DS-HDR-01": (evidence) =>
    ["hsts", "nosniff", "frameProtection", "referrerPolicy", "csp"].every(
      (key) => evidence[key] === true,
    ),
  "DS-PRIV-01": (evidence) =>
    evidence.thirdPartyAttempts === 0 && evidence.blockedRequests === 0,
  "DS-PRIV-02": (evidence) =>
    evidence.inspected === true &&
    evidence.insecureCookieCount === 0 &&
    evidence.thirdPartyCookieCount === 0,
  "DS-PRIV-05": (evidence) =>
    evidence.inspected === true &&
    Number(evidence.catalogMatchCount) === 0,
  "DS-PRIV-03": (evidence) =>
    evidence.mixedContentCount === 0 && evidence.insecureNavigationCount === 0,
  "DS-QUAL-01": (evidence) =>
    Number(evidence.documentStatusCode) >= 200 &&
    Number(evidence.documentStatusCode) < 400 &&
    evidence.failedEssentialResourceCount === 0,
};

function sanitizeEvidence(
  contract: ControlContract,
  controlId: string,
  profileVersion: ProfileVersion,
  evidence: unknown,
): Record<string, SafeEvidenceValue> {
  if (!isPlainRecord(evidence)) throw new Error("scan_evidence_invalid");

  const sanitized: Record<string, SafeEvidenceValue> = {};
  for (const [key, value] of Object.entries(evidence)) {
    if (
      key === "finalScheme" &&
      controlId === "DS-HDR-01" &&
      profileVersion !== PROFILE_VERSION_V3 &&
      profileVersion !== PROFILE_VERSION_TRANSPORT_V1 &&
      profileVersion !== PROFILE_VERSION_DOMAIN_V1
    ) {
      continue;
    }
    const rule = contract.evidence[key];
    if (!rule) continue;
    if (rule === "boolean" && typeof value === "boolean") {
      sanitized[key] = value;
      continue;
    }
    if (rule === "count" && isSafeCount(value)) {
      sanitized[key] = value;
      continue;
    }
    if (rule === "http_status" && isHttpStatus(value)) {
      sanitized[key] = value;
      continue;
    }
    if (
      Array.isArray(rule) &&
      typeof value === "string" &&
      rule.includes(value)
    ) {
      sanitized[key] = value;
      continue;
    }
    throw new Error("scan_evidence_invalid");
  }
  return sanitized;
}

function pathsFor(
  methods: readonly string[],
): Readonly<Record<string, readonly string[]>> {
  return Object.fromEntries(PAGE_PATHS.map((path) => [path, methods]));
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function isSafeCount(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isSafeInteger(value) &&
    value >= 0 &&
    value <= MAX_EVIDENCE_COUNT
  );
}

function isValidDate(value: unknown): value is string | Date {
  if (!(typeof value === "string" || value instanceof Date)) return false;
  return Number.isFinite(new Date(value).getTime());
}

function isHttpStatus(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isInteger(value) &&
    value >= 100 &&
    value <= 599
  );
}
