import { normalizeHostname } from "./scan-policy.js";
import { TLS_PROBE_ERROR_CODES } from "./public-evidence.js";

const PROFILE_VERSION_V1 = "controls-v1";
const PROFILE_VERSION_V2 = "controls-v2";
const PROFILE_VERSION_V3 = "controls-v3";
const PROFILE_VERSION_TRANSPORT_V1 = "transport-v1";
const PROFILE_VERSION_DOMAIN_V1 = "domain-v1";
const PROFILE_VERSION_DOMAIN_V2 = "domain-v2";
const PROFILE_VERSION_DOMAIN_V3 = "domain-v3";
const PROFILE_VERSION_DOMAIN_V4 = "domain-v4";
const PROFILE_VERSION_DOMAIN_V5 = "domain-v5";
type ProfileVersion =
  | typeof PROFILE_VERSION_V1
  | typeof PROFILE_VERSION_V2
  | typeof PROFILE_VERSION_V3
  | typeof PROFILE_VERSION_TRANSPORT_V1
  | typeof PROFILE_VERSION_DOMAIN_V1
  | typeof PROFILE_VERSION_DOMAIN_V2
  | typeof PROFILE_VERSION_DOMAIN_V3
  | typeof PROFILE_VERSION_DOMAIN_V4
  | typeof PROFILE_VERSION_DOMAIN_V5;
const MAX_SCOPE_PATHS = 3;
const MAX_DOMAIN_V5_TARGET_PATH_LENGTH = 2_048;
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
    Record<string, "boolean" | "count" | "http_status" | "hostname" | "performance_ms" | "performance_bytes" | "performance_cls_milli" | "performance_score" | readonly string[]>
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
const DOMAIN_V2_CONTROLS = [...DOMAIN_V1_CONTROLS, "DS-PRIV-06", "DS-QUAL-02"] as const;
const DOMAIN_V3_CONTROLS = [...DOMAIN_V2_CONTROLS, "DS-TLS-02"] as const;
const DOMAIN_V4_CONTROLS = [...DOMAIN_V3_CONTROLS, "DS-PRIV-04"] as const;
const DOMAIN_V5_CONTROLS = DOMAIN_V4_CONTROLS;
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
      tls10ProbeError: TLS_PROBE_ERROR_CODES,
      tls11ProbeError: TLS_PROBE_ERROR_CODES,
      tls12ProbeError: TLS_PROBE_ERROR_CODES,
      tls13ProbeError: TLS_PROBE_ERROR_CODES,
    },
  },
  "DS-HTTP-01": {
    methodsByPath: pathsFor(HTTP_METHODS),
    evidence: {
      statusCode: "http_status",
      redirectedToHttps: "boolean",
      finalScheme: ["http", "https"],
      requestedHostname: "hostname",
      finalHostname: "hostname",
      canonicalHostname: "hostname",
      redirectStatusCode: "http_status",
      redirectFromHostname: "hostname",
      redirectToHostname: "hostname",
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
      probeErrorCode: TLS_PROBE_ERROR_CODES,
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
  "DS-PRIV-04": {
    methodsByPath: pathsFor(READ_METHODS),
    evidence: {
      inspected: "boolean",
      privacyPolicyLinksFound: "count",
      policyLinksFound: "count",
      sitePrivacyPolicyFetched: "boolean",
      policyPagesFetched: "count",
      policyPagesMissing: "count",
      policyPagesDenied: "count",
      policyRecipientsMentioned: "boolean",
      policyPurposesMentioned: "boolean",
      policyTextBlocked: "boolean",
      policyProbeFailed: "boolean",
      policyLanguageCatalogVersion: ["public-policy-language-eea-v1"],
      probeErrorCode: TLS_PROBE_ERROR_CODES,
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
      browserObservationComplete: "boolean",
      browserCookieCount: "count",
      browserInsecureCookieCount: "count",
      browserCatalogMatchCount: "count",
      probeErrorCode: TLS_PROBE_ERROR_CODES,
    },
  },
  "DS-PRIV-06": {
    methodsByPath: pathsFor(READ_METHODS),
    evidence: {
      inspected: "boolean",
      thirdPartyResourceReferences: "count",
      knownTrackingResourceReferences: "count",
      browserObservationComplete: "boolean",
      browserThirdPartyRequestCount: "count",
      browserKnownTrackingRequestCount: "count",
      browserBlockedTrackingRequestCount: "count",
      browserTrackingResponseCount: "count",
      probeErrorCode: TLS_PROBE_ERROR_CODES,
    },
  },
  "DS-QUAL-02": {
    methodsByPath: pathsFor(READ_METHODS),
    evidence: {
      inspected: "boolean",
      responseTimeMs: "count",
      responseBytes: "count",
      probeErrorCode: TLS_PROBE_ERROR_CODES,
      mobileFcpMs: "performance_ms",
      mobileSpeedIndexMs: "performance_ms",
      mobileScoreModelVersion: ["lighthouse-13.6.0"],
      mobileLcpMs: "performance_ms",
      mobileClsMilli: "performance_cls_milli",
      mobileTbtMs: "performance_ms",
      mobileTtfbMs: "performance_ms",
      mobileTransferBytes: "performance_bytes",
      mobileScore: "performance_score",
      desktopFcpMs: "performance_ms",
      desktopLcpMs: "performance_ms",
      desktopClsMilli: "performance_cls_milli",
      desktopTbtMs: "performance_ms",
      desktopTtfbMs: "performance_ms",
      desktopTransferBytes: "performance_bytes",
      desktopScore: "performance_score",
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
  (controlId) => !["DS-PRIV-04", "DS-PRIV-05", "DS-PRIV-06", "DS-QUAL-02"].includes(controlId),
);
const PROFILE_CONTROLS: Readonly<Record<ProfileVersion, readonly string[]>> = {
  [PROFILE_VERSION_V1]: ALL_CONTROL_IDS,
  [PROFILE_VERSION_V2]: ALL_CONTROL_IDS,
  [PROFILE_VERSION_V3]: ALL_CONTROL_IDS,
  [PROFILE_VERSION_TRANSPORT_V1]: TRANSPORT_V1_CONTROLS,
  [PROFILE_VERSION_DOMAIN_V1]: DOMAIN_V1_CONTROLS,
  [PROFILE_VERSION_DOMAIN_V2]: DOMAIN_V2_CONTROLS,
  [PROFILE_VERSION_DOMAIN_V3]: DOMAIN_V3_CONTROLS,
  [PROFILE_VERSION_DOMAIN_V4]: DOMAIN_V4_CONTROLS,
  [PROFILE_VERSION_DOMAIN_V5]: DOMAIN_V5_CONTROLS,
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
    profileVersion === PROFILE_VERSION_DOMAIN_V1 ||
    profileVersion === PROFILE_VERSION_DOMAIN_V2 ||
    profileVersion === PROFILE_VERSION_DOMAIN_V3 ||
    profileVersion === PROFILE_VERSION_DOMAIN_V4 ||
    profileVersion === PROFILE_VERSION_DOMAIN_V5
      ? ["/"]
      : allowedPaths;
  const safeScope = profileVersion === PROFILE_VERSION_DOMAIN_V5
    ? sanitizeDomainV5Scope(scope)
    : sanitizeScope(scope, profilePaths);
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
    profileVersion === PROFILE_VERSION_DOMAIN_V1 ||
    profileVersion === PROFILE_VERSION_DOMAIN_V2 ||
    profileVersion === PROFILE_VERSION_DOMAIN_V3 ||
    profileVersion === PROFILE_VERSION_DOMAIN_V4 ||
    profileVersion === PROFILE_VERSION_DOMAIN_V5
  ) {
    assertCompleteCoverage(safeScope, safeChecks, allowedControlIds, profileVersion);
  }

  return { scope: safeScope, checks: safeChecks };
}

function isProfileVersion(value: unknown): value is ProfileVersion {
  return (
    value === PROFILE_VERSION_V1 ||
    value === PROFILE_VERSION_V2 ||
    value === PROFILE_VERSION_V3 ||
    value === PROFILE_VERSION_TRANSPORT_V1 ||
    value === PROFILE_VERSION_DOMAIN_V1 ||
    value === PROFILE_VERSION_DOMAIN_V2 ||
      value === PROFILE_VERSION_DOMAIN_V3 ||
      value === PROFILE_VERSION_DOMAIN_V4 ||
      value === PROFILE_VERSION_DOMAIN_V5
  );
}

function assertCompleteCoverage(
  scope: readonly string[],
  checks: readonly SanitizedScanCheck[],
  allowedControlIds: readonly string[],
  profileVersion: ProfileVersion,
): void {
  const expectedCoverage = new Set<string>();
  for (const controlId of allowedControlIds) {
    const contract = CONTROLS[controlId];
    if (!contract) throw new Error("scan_profile_not_allowlisted");
    for (const targetPath of scope) {
      const methods = contract.methodsByPath[
        profileVersion === PROFILE_VERSION_DOMAIN_V5 ? "/" : targetPath
      ] ?? [];
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

function sanitizeDomainV5Scope(scope: unknown): readonly string[] {
  if (
    !Array.isArray(scope) ||
    scope.length !== 1 ||
    typeof scope[0] !== "string" ||
    !isSafeDomainV5TargetPath(scope[0])
  ) {
    throw new Error("scan_scope_not_allowlisted");
  }
  return [scope[0]];
}

function isSafeDomainV5TargetPath(value: string): boolean {
  return value.length <= MAX_DOMAIN_V5_TARGET_PATH_LENGTH &&
    value.startsWith("/") &&
    !value.startsWith("//") &&
    !value.includes("#") &&
    !value.includes("\\") &&
    !hasAsciiControlCharacter(value);
}

function hasAsciiControlCharacter(value: string): boolean {
  return Array.from(value).some((character) => {
    const codePoint = character.codePointAt(0) ?? 0;
    return codePoint <= 0x1f || codePoint === 0x7f;
  });
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
  if (typeof targetPath !== "string" || typeof method !== "string") {
    throw new Error("scan_check_scope_not_allowlisted");
  }
  const contractPath = profileVersion === PROFILE_VERSION_DOMAIN_V5 ? "/" : targetPath;
  if (
    !contract.methodsByPath[contractPath]?.includes(method) ||
    (profileVersion === PROFILE_VERSION_DOMAIN_V5
      ? !scope.includes(targetPath)
      : method !== "DNS" && method !== "TLS" && !scope.includes(targetPath))
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
    limitation: getSafeCheckLimitation(controlId, profileVersion, evidence),
    evidence,
  };
}

function getSafeCheckSummary(
  controlId: string,
  status: string,
  evidence: Record<string, SafeEvidenceValue>,
): string {
  if (status === "unknown" && typeof evidence.probeErrorCode === "string") {
    return `El lector no pudo completar esta comprobación: ${getTlsProbeErrorLabel(evidence.probeErrorCode)}.`;
  }
  if (controlId === "DS-TLS-02") {
    const tlsVersions = [
      "tls10Accepted",
      "tls11Accepted",
      "tls12Accepted",
      "tls13Accepted",
    ] as const;
    const diagnostics = [
      ["TLS 1.0", evidence.tls10ProbeError],
      ["TLS 1.1", evidence.tls11ProbeError],
      ["TLS 1.2", evidence.tls12ProbeError],
      ["TLS 1.3", evidence.tls13ProbeError],
    ].filter((entry): entry is [string, string] => typeof entry[1] === "string");
    if (diagnostics.length > 0) {
      return `No se pudieron completar todas las pruebas de TLS. ${diagnostics.map(([version, code]) => `${version}: ${getTlsProbeErrorLabel(code)}.`).join(" ")}`;
    }
    if (tlsVersions.every((key) => typeof evidence[key] === "boolean")) {
      return `Comprobación ${controlId}: ${status}.`;
    }
    return "No se pudieron determinar todas las versiones de TLS; faltan resultados de una o más pruebas.";
  }
  if (controlId !== "DS-PRIV-05") {
    if (controlId === "DS-PRIV-06" && evidence.browserObservationComplete === true) {
      const thirdPartyRequests = Number(evidence.browserThirdPartyRequestCount);
      const knownRequests = Number(evidence.browserKnownTrackingRequestCount);
      const blockedRequests = Number(evidence.browserBlockedTrackingRequestCount);
      const responses = Number(evidence.browserTrackingResponseCount);
      return `Antes de elegir, Chromium inició ${thirdPartyRequests} solicitud${thirdPartyRequests === 1 ? "" : "es"} a terceros, incluidas ${knownRequests} a rastreadores conocidos; se bloquearon ${blockedRequests} intento${blockedRequests === 1 ? "" : "s"} y ${responses} solicitud${responses === 1 ? "" : "es"} recibieron respuesta.`;
    }
    return `Comprobación ${controlId}: ${status}.`;
  }
  if (evidence.browserObservationComplete === true) {
    const cookies = Number(evidence.browserCookieCount);
    const matches = Number(evidence.browserCatalogMatchCount);
    const insecure = Number(evidence.browserInsecureCookieCount);
    return `Antes de elegir, Chromium observó ${cookies} cookie${cookies === 1 ? "" : "s"}; ${matches} coincidía${matches === 1 ? "" : "n"} con cookies conocidas del catálogo y ${insecure} carecían del atributo Secure.`;
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

function getSafeCheckLimitation(
  controlId: string,
  profileVersion: ProfileVersion,
  evidence: Record<string, SafeEvidenceValue>,
): string {
  const profileLimit = `Resultado limitado a las rutas públicas declaradas del perfil ${profileVersion}.`;
  if (profileVersion !== PROFILE_VERSION_DOMAIN_V4 || evidence.browserObservationComplete !== true) return profileLimit;
  if (controlId === "DS-PRIV-06") {
    return "Una solicitud iniciada demuestra un intento; las bloqueadas por el auditor no demuestran transmisión de datos. El conteo de respuestas indica solicitudes que sí recibieron respuesta.";
  }
  if (controlId === "DS-PRIV-05") {
    return "Cookies observadas por Chromium antes de elegir. La atribución a un servicio requiere coincidencia con el catálogo local y una solicitud del mismo flujo.";
  }
  return profileLimit;
}

function getTlsProbeErrorLabel(code: string): string {
  const labels: Readonly<Record<string, string>> = {
    dns_resolution_failed: "no se pudo resolver el dominio",
    connection_failed: "no se pudo completar la conexión",
    broker_failed: "el servicio de medición no respondió",
    request_aborted: "la prueba se interrumpió",
    request_timeout: "se agotó el tiempo de espera",
    response_size_limit_exceeded: "la respuesta superó el límite permitido",
    https_request_failed: "falló la solicitud HTTPS",
    http_request_failed: "falló la solicitud de prueba",
    invalid_http_response: "se recibió una respuesta no válida",
    redirect_limit_exceeded: "se superó el límite de redirecciones",
    redirect_origin_not_allowlisted: "la redirección salió del dominio permitido",
    redirect_path_not_allowlisted: "la redirección salió de la ruta permitida",
    tls_certificate_invalid: "el certificado no pasó la comprobación",
    tls_handshake_failed: "el servidor rechazó la negociación de cifrado",
    transport_failed: "se produjo un error de transporte",
  };
  return labels[code] ?? "la prueba no pudo completarse";
}

function deriveSafeStatus(
  profileVersion: ProfileVersion,
  controlId: string,
  method: string,
  submittedStatus: string,
  evidence: Record<string, SafeEvidenceValue>,
): SanitizedScanCheck["status"] {
  if (
    profileVersion === PROFILE_VERSION_DOMAIN_V5 &&
    controlId === "DS-QUAL-02" &&
    !getRequiredEvidence(profileVersion, controlId)?.every((key) => key in evidence)
  ) {
    return "unknown";
  }
  if (
    (profileVersion === PROFILE_VERSION_V2 ||
      profileVersion === PROFILE_VERSION_V3 ||
      profileVersion === PROFILE_VERSION_TRANSPORT_V1 ||
      profileVersion === PROFILE_VERSION_DOMAIN_V1 ||
      profileVersion === PROFILE_VERSION_DOMAIN_V2 ||
      profileVersion === PROFILE_VERSION_DOMAIN_V3 ||
      profileVersion === PROFILE_VERSION_DOMAIN_V4 ||
      profileVersion === PROFILE_VERSION_DOMAIN_V5) &&
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
      profileVersion === PROFILE_VERSION_DOMAIN_V1 ||
      profileVersion === PROFILE_VERSION_DOMAIN_V2 ||
      profileVersion === PROFILE_VERSION_DOMAIN_V3 ||
      profileVersion === PROFILE_VERSION_DOMAIN_V4 ||
      profileVersion === PROFILE_VERSION_DOMAIN_V5) &&
    controlId === "DS-HDR-01" &&
    evidence.finalScheme !== "https"
  ) {
    return "unknown";
  }
  if (submittedStatus === "not_applicable") return "unknown";
  if (submittedStatus !== "pass") {
    return submittedStatus as SanitizedScanCheck["status"];
  }

  if (profileVersion === PROFILE_VERSION_DOMAIN_V5 && controlId === "DS-QUAL-02") {
    return "pass";
  }

  if (
    profileVersion === PROFILE_VERSION_DOMAIN_V4 &&
    controlId === "DS-PRIV-05" &&
    (Number(evidence.catalogMatchCount) > 0 || Number(evidence.browserCatalogMatchCount) > 0)
  ) return "fail";
  if (
    profileVersion === PROFILE_VERSION_DOMAIN_V4 &&
    controlId === "DS-PRIV-06" &&
    (Number(evidence.knownTrackingResourceReferences) > 0 || Number(evidence.browserKnownTrackingRequestCount) > 0)
  ) return "fail";

  const requiredEvidence = getRequiredEvidence(profileVersion, controlId);
  if (!requiredEvidence || !requiredEvidence.every((key) => key in evidence)) {
    return "unknown";
  }

  const failed = CONTROL_FAILURES[controlId]?.(evidence) ?? false;
  if (failed) return "fail";

  if (profileVersion === PROFILE_VERSION_DOMAIN_V4 && controlId === "DS-PRIV-05") {
    return evidence.inspected === true && evidence.browserObservationComplete === true &&
      Number(evidence.catalogMatchCount) === 0 && Number(evidence.browserCatalogMatchCount) === 0
      ? "pass"
      : "unknown";
  }
  if (profileVersion === PROFILE_VERSION_DOMAIN_V4 && controlId === "DS-PRIV-06") {
    return evidence.inspected === true && evidence.browserObservationComplete === true &&
      Number(evidence.knownTrackingResourceReferences) === 0 && Number(evidence.browserKnownTrackingRequestCount) === 0
      ? "pass"
      : "unknown";
  }

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
  "DS-PRIV-06": ["inspected", "thirdPartyResourceReferences", "knownTrackingResourceReferences"],
  "DS-QUAL-02": ["inspected", "responseTimeMs", "responseBytes"],
  "DS-PRIV-03": ["mixedContentCount", "insecureNavigationCount"],
  "DS-PRIV-04": [
    "inspected", "privacyPolicyLinksFound", "policyLinksFound", "sitePrivacyPolicyFetched",
    "policyPagesFetched", "policyPagesMissing", "policyPagesDenied",
    "policyRecipientsMentioned", "policyPurposesMentioned", "policyTextBlocked", "policyProbeFailed",
    "policyLanguageCatalogVersion",
  ],
  "DS-QUAL-01": ["documentStatusCode", "failedEssentialResourceCount"],
};

function getRequiredEvidence(
  profileVersion: ProfileVersion,
  controlId: string,
): readonly string[] | undefined {
  if (profileVersion === PROFILE_VERSION_DOMAIN_V5 && controlId === "DS-QUAL-02") {
    return DOMAIN_V5_PERFORMANCE_EVIDENCE;
  }
  const controlEvidence = REQUIRED_EVIDENCE[controlId];
  if (
    (profileVersion === PROFILE_VERSION_V3 ||
      profileVersion === PROFILE_VERSION_TRANSPORT_V1 ||
      profileVersion === PROFILE_VERSION_DOMAIN_V1 ||
      profileVersion === PROFILE_VERSION_DOMAIN_V2 ||
      profileVersion === PROFILE_VERSION_DOMAIN_V4 ||
      profileVersion === PROFILE_VERSION_DOMAIN_V5) &&
    controlId === "DS-HDR-01"
  ) {
    return [...(controlEvidence ?? []), "finalScheme"];
  }
  if (profileVersion === PROFILE_VERSION_DOMAIN_V4 && controlId === "DS-PRIV-05") {
    return [...(controlEvidence ?? []), "browserObservationComplete", "browserCookieCount",
      "browserInsecureCookieCount", "browserCatalogMatchCount"];
  }
  if (profileVersion === PROFILE_VERSION_DOMAIN_V4 && controlId === "DS-PRIV-06") {
    return [...(controlEvidence ?? []), "browserObservationComplete", "browserThirdPartyRequestCount",
      "browserKnownTrackingRequestCount", "browserBlockedTrackingRequestCount", "browserTrackingResponseCount"];
  }
  return controlEvidence;
}

const DOMAIN_V5_PERFORMANCE_EVIDENCE = [
  "mobileFcpMs", "mobileSpeedIndexMs", "mobileScoreModelVersion", "mobileLcpMs", "mobileClsMilli", "mobileTbtMs", "mobileTtfbMs",
  "mobileTransferBytes", "mobileScore", "desktopFcpMs", "desktopLcpMs", "desktopClsMilli",
  "desktopTbtMs", "desktopTtfbMs", "desktopTransferBytes", "desktopScore",
] as const;

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
  "DS-PRIV-04": (evidence) => evidence.inspected === true && (
    Number(evidence.privacyPolicyLinksFound) === 0 ||
    Number(evidence.policyPagesDenied) > 0 ||
    Number(evidence.policyPagesMissing) > 0 ||
    evidence.policyTextBlocked === true ||
    (evidence.sitePrivacyPolicyFetched === true && (
      evidence.policyRecipientsMentioned !== true || evidence.policyPurposesMentioned !== true
    )) ||
    (evidence.sitePrivacyPolicyFetched === false && evidence.policyProbeFailed !== true && Number(evidence.privacyPolicyLinksFound) > 0)
  ),
  "DS-PRIV-05": (evidence) =>
    Number(evidence.catalogMatchCount) > 0 || Number(evidence.browserCatalogMatchCount) > 0,
  "DS-PRIV-06": (evidence) =>
    Number(evidence.knownTrackingResourceReferences) > 0 || Number(evidence.browserKnownTrackingRequestCount) > 0,
  "DS-QUAL-02": (evidence) => Number(evidence.responseTimeMs) > 2_500,
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
  "DS-PRIV-04": (evidence) =>
    evidence.inspected === true &&
    Number(evidence.privacyPolicyLinksFound) > 0 &&
    evidence.sitePrivacyPolicyFetched === true &&
    Number(evidence.policyPagesDenied) === 0 &&
    Number(evidence.policyPagesMissing) === 0 &&
    evidence.policyRecipientsMentioned === true &&
    evidence.policyPurposesMentioned === true &&
    evidence.policyTextBlocked === false &&
    evidence.policyProbeFailed === false,
  "DS-PRIV-05": (evidence) =>
    evidence.inspected === true &&
    Number(evidence.catalogMatchCount) === 0,
  "DS-PRIV-06": (evidence) =>
    evidence.inspected === true &&
    Number(evidence.knownTrackingResourceReferences) === 0,
  "DS-QUAL-02": (evidence) =>
    evidence.inspected === true && Number(evidence.responseTimeMs) <= 2_500,
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
      profileVersion !== PROFILE_VERSION_DOMAIN_V1 &&
      profileVersion !== PROFILE_VERSION_DOMAIN_V2 &&
      profileVersion !== PROFILE_VERSION_DOMAIN_V3 &&
      profileVersion !== PROFILE_VERSION_DOMAIN_V4 &&
      profileVersion !== PROFILE_VERSION_DOMAIN_V5
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
    if (rule === "performance_ms" && isSafeIntegerAtLeastZero(value)) {
      sanitized[key] = value;
      continue;
    }
    if (rule === "performance_bytes" && isSafeIntegerAtLeastZero(value) && value <= 64 * 1024 * 1024) {
      sanitized[key] = value;
      continue;
    }
    if (rule === "performance_cls_milli" && isSafeIntegerAtLeastZero(value) && value <= 100_000) {
      sanitized[key] = value;
      continue;
    }
    if (rule === "performance_score" && isSafeIntegerAtLeastZero(value) && value <= 100) {
      sanitized[key] = value;
      continue;
    }
    if (rule === "http_status" && isHttpStatus(value)) {
      sanitized[key] = value;
      continue;
    }
    if (rule === "hostname" && isAuthorizedGrumphyaHostname(value)) {
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
  if (controlId === "DS-HTTP-01") validateGrumphyaRedirectEvidence(sanitized);
  return sanitized;
}

function isSafeIntegerAtLeastZero(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function isAuthorizedGrumphyaHostname(value: unknown): value is string {
  return value === "grumphya.com" || value === "www.grumphya.com";
}

function validateGrumphyaRedirectEvidence(evidence: Record<string, SafeEvidenceValue>): void {
  const hasRedirectIdentity = [
    "requestedHostname", "finalHostname", "redirectStatusCode",
    "redirectFromHostname", "redirectToHostname", "canonicalHostname",
  ].some((key) => Object.hasOwn(evidence, key));
  if (!hasRedirectIdentity) return;
  if (
    !isAuthorizedGrumphyaHostname(evidence.requestedHostname) ||
    !isAuthorizedGrumphyaHostname(evidence.finalHostname) ||
    !isAuthorizedGrumphyaHostname(evidence.redirectFromHostname) ||
    !isAuthorizedGrumphyaHostname(evidence.redirectToHostname) ||
    evidence.redirectFromHostname !== evidence.requestedHostname ||
    evidence.redirectToHostname !== evidence.finalHostname ||
    evidence.redirectFromHostname === evidence.redirectToHostname ||
    typeof evidence.redirectStatusCode !== "number" ||
    ![301, 302, 303, 307, 308].includes(evidence.redirectStatusCode)
  ) throw new Error("scan_evidence_invalid");
  const isPermanent = evidence.redirectStatusCode === 301 || evidence.redirectStatusCode === 308;
  if (
    (isPermanent && evidence.canonicalHostname !== evidence.finalHostname) ||
    (!isPermanent && evidence.canonicalHostname !== undefined)
  ) throw new Error("scan_evidence_invalid");
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
