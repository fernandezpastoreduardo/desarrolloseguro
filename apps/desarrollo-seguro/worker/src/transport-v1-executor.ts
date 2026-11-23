import { randomUUID } from "node:crypto";
import {
  assessPublicPolicyTransparency,
  evaluateVerdict,
  sanitizeScanObservations,
} from "@desarrolloseguro/core";
import type { ClaimedScanJob, ScanCheck, ScanRunInput } from "@desarrolloseguro/persistence";
import { createTransportV1EgressBroker } from "./transport-v1-egress-broker.js";
import { safeTransportErrorCode, type PinnedTransportErrorCode } from "./pinned-transport-error.js";

const TRANSPORT_PROFILE_VERSION = "transport-v1";
const DOMAIN_PROFILE_VERSION = "domain-v1";
const DOMAIN_PROFILE_VERSION_V2 = "domain-v2";
const DOMAIN_PROFILE_VERSION_V3 = "domain-v3";
const FIXTURE_SCANNER_VERSION = "transport-v1-fixture-adapter-1";
const DOMAIN_FIXTURE_SCANNER_VERSION = "domain-v1-fixture-adapter-1";
const DOMAIN_V2_FIXTURE_SCANNER_VERSION = "domain-v2-fixture-adapter-1";
const DOMAIN_V3_FIXTURE_SCANNER_VERSION = "domain-v3-fixture-adapter-1";
const NETWORK_SCANNER_VERSION = "transport-v1-network-adapter-1";
const DOMAIN_SCANNER_VERSION = "domain-v1-network-adapter-1";
const DOMAIN_V2_SCANNER_VERSION = "domain-v2-network-adapter-1";
const DOMAIN_V3_SCANNER_VERSION = "domain-v3-network-adapter-1";
const DOMAIN_V3_PUBLIC_POLICY_SCANNER_VERSION = "domain-v3-network-adapter-2";
const MAX_CONCURRENT_NETWORK_PROBES = 2;
const CHECKS = [
  { controlId: "DS-DNS-01", method: "DNS", severity: "high" },
  { controlId: "DS-TLS-01", method: "TLS", severity: "high" },
  { controlId: "DS-HTTP-01", method: "HEAD", severity: "medium" },
  { controlId: "DS-HTTP-01", method: "GET", severity: "medium" },
  { controlId: "DS-HDR-01", method: "GET", severity: "medium" },
] as const;

export type TransportV1Evidence = Record<string, boolean | number | string>;

export type TransportV1ProbeResult = {
  evidence: TransportV1Evidence;
  requestsCount: number;
  bytesCount: number;
  errorCode?: PinnedTransportErrorCode;
};

export type NetworkProbeOperation = "dns" | "tls" | "http-head" | "http-get" | "headers";
export type NetworkProbeFailureCode = PinnedTransportErrorCode | "probe_unavailable" | "empty_evidence";
export type NetworkProbeFailure = { operation: NetworkProbeOperation; code: NetworkProbeFailureCode };

export const NETWORK_PROBE_OPERATIONS: readonly NetworkProbeOperation[] = ["dns", "tls", "http-head", "http-get", "headers"];
export const NETWORK_PROBE_FAILURE_CODES: readonly NetworkProbeFailureCode[] = [
  "dns_resolution_failed", "connection_failed", "broker_failed", "request_aborted",
  "request_timeout", "response_size_limit_exceeded", "https_request_failed", "http_request_failed",
  "invalid_http_response", "redirect_limit_exceeded", "redirect_origin_not_allowlisted",
  "redirect_path_not_allowlisted", "tls_certificate_invalid", "tls_handshake_failed",
  "transport_failed", "probe_unavailable", "empty_evidence",
];

export function isNetworkProbeFailureList(value: unknown): value is NetworkProbeFailure[] {
  if (!Array.isArray(value) || value.length === 0 || value.length > NETWORK_PROBE_OPERATIONS.length) {
    return false;
  }
  const seenOperations = new Set<string>();
  return value.every((item) => {
    if (
      item === null || typeof item !== "object" || Array.isArray(item) ||
      !isNetworkProbeOperation(item.operation) ||
      !isNetworkProbeFailureCode(item.code) ||
      seenOperations.has(item.operation)
    ) {
      return false;
    }
    seenOperations.add(item.operation);
    return true;
  });
}

function isNetworkProbeOperation(value: unknown): value is NetworkProbeOperation {
  return typeof value === "string" && NETWORK_PROBE_OPERATIONS.includes(value as NetworkProbeOperation);
}

function isNetworkProbeFailureCode(value: unknown): value is NetworkProbeFailureCode {
  return typeof value === "string" && NETWORK_PROBE_FAILURE_CODES.includes(value as NetworkProbeFailureCode);
}

export class NetworkObservationUnavailableError extends Error {
  constructor(readonly probeFailures: NetworkProbeFailure[]) {
    super("network_observation_unavailable");
    this.name = "NetworkObservationUnavailableError";
  }
}

export type TransportV1ScanJob = Pick<
  ClaimedScanJob,
  "hostname" | "profileVersion"
>;

export type ScanProfileVersion = typeof TRANSPORT_PROFILE_VERSION | typeof DOMAIN_PROFILE_VERSION | typeof DOMAIN_PROFILE_VERSION_V2 | typeof DOMAIN_PROFILE_VERSION_V3;

/**
 * Observation boundary for the reduced profile. Implementations must return
 * only derived evidence, never response bodies, raw headers, or IPs.
 */
export interface TransportV1ObservationSource {
  readonly sourceKind: "network";
  observeDns(hostname: string, signal: AbortSignal): Promise<TransportV1ProbeResult>;
  observeTls(hostname: string, signal: AbortSignal): Promise<TransportV1ProbeResult>;
  observeHttp(
    hostname: string,
    method: "HEAD" | "GET",
    signal: AbortSignal,
  ): Promise<TransportV1ProbeResult>;
  observeHeaders(hostname: string, signal: AbortSignal): Promise<TransportV1ProbeResult>;
}

export interface TransportV1FixtureObservationSource {
  readonly sourceKind: "fixture";
  observeDns(hostname: string, signal: AbortSignal): Promise<TransportV1Evidence>;
  observeTls(hostname: string, signal: AbortSignal): Promise<TransportV1Evidence>;
  observeHttp(
    hostname: string,
    method: "HEAD" | "GET",
    signal: AbortSignal,
  ): Promise<TransportV1Evidence>;
  observeHeaders(hostname: string, signal: AbortSignal): Promise<TransportV1Evidence>;
}

export class TransportV1FixtureExecutor {
  constructor(
    private readonly source: TransportV1FixtureObservationSource,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async execute(
    job: TransportV1ScanJob,
    signal: AbortSignal,
  ): Promise<
    Omit<ScanRunInput, "jobId" | "leaseToken" | "hostname" | "profileVersion">
  > {
    if (!isSupportedProfile(job.profileVersion)) {
      throw new Error("unsupported_scan_profile");
    }

    const startedAt = this.now();
    const observations = await Promise.all([
      safelyObserve(() => this.source.observeDns(job.hostname, signal), signal),
      safelyObserve(() => this.source.observeTls(job.hostname, signal), signal),
      safelyObserve(
        () => this.source.observeHttp(job.hostname, "HEAD", signal),
        signal,
      ),
      safelyObserve(
        () => this.source.observeHttp(job.hostname, "GET", signal),
        signal,
      ),
      safelyObserve(
        () => this.source.observeHeaders(job.hostname, signal),
        signal,
      ),
    ]);
    const completedAt = this.now();
    const observedAt = completedAt;
    const candidateChecks: ScanCheck[] = CHECKS.map((definition, index) => ({
      ...definition,
      status: "pass",
      required: true,
      observedAt,
      targetPath: "/",
      summary: "",
      limitation: "",
      evidence: observations[index] ?? {},
    }));
    appendTlsVersionCheck(candidateChecks, job.profileVersion, observations[1] ?? {}, observedAt);
    appendInitialCookieCheck(candidateChecks, job.profileVersion, observations[4] ?? {}, observedAt);
    appendPassivePageSignalChecks(candidateChecks, job.profileVersion, observations[4] ?? {}, observedAt);

    const sanitized = sanitizeScanObservations(
      job.hostname,
      job.profileVersion,
      ["/"],
      candidateChecks,
    );

    return {
      scannerVersion: getFixtureScannerVersion(job.profileVersion),
      startedAt,
      completedAt,
      verdict: evaluateVerdict(sanitized.checks),
      scope: sanitized.scope,
      checks: sanitized.checks,
      metrics: {
        requestsCount: 0,
        bytesCount: 0,
        durationMs: Math.max(0, completedAt.getTime() - startedAt.getTime()),
        pagesCount: 0,
      },
    };
  }
}

export class TransportV1NetworkExecutor {
  constructor(
    private readonly source: TransportV1ObservationSource,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async execute(
    job: TransportV1ScanJob,
    signal: AbortSignal,
  ): Promise<
    Omit<ScanRunInput, "jobId" | "leaseToken" | "hostname" | "profileVersion">
  > {
    if (!isSupportedProfile(job.profileVersion)) {
      throw new Error("unsupported_scan_profile");
    }

    const startedAt = this.now();
    const broker = createTransportV1EgressBroker(job.hostname, this.source);
    const operations = NETWORK_PROBE_OPERATIONS;
    const observations = operations.map((operation) => async () => {
      const requestId = randomUUID();
      const response = await broker(
        {
          protocolVersion: 1,
          requestId,
          hostname: job.hostname,
          operation,
        },
        signal,
      );
      if (
        response.protocolVersion !== 1 ||
        response.requestId !== requestId
      ) {
        throw new Error("egress_broker_response_invalid");
      }
      return response.result;
    });
    const probes = await observeNetworkProbes(
      observations,
      signal,
      MAX_CONCURRENT_NETWORK_PROBES,
    );
    if (probes.every((probe) => !probe || Object.keys(probe.evidence).length === 0)) {
      const probeFailures = operations.flatMap((operation, index) => {
        const probe = probes[index];
        if (probe && Object.keys(probe.evidence).length > 0) return [];
        const code: NetworkProbeFailureCode = probe?.errorCode ?? (probe ? "empty_evidence" : "probe_unavailable");
        return [{ operation, code }];
      });
      throw new NetworkObservationUnavailableError(probeFailures);
    }
    const completedAt = this.now();
    const candidateChecks: ScanCheck[] = CHECKS.map((definition, index) => ({
      ...definition,
      status: "pass",
      required: true,
      observedAt: completedAt,
      targetPath: "/",
      summary: "",
      limitation: "",
      evidence: probes[index]?.evidence ?? {},
    }));
    appendTlsVersionCheck(candidateChecks, job.profileVersion, probes[1]?.evidence ?? {}, completedAt);
    appendInitialCookieCheck(
      candidateChecks,
      job.profileVersion,
      probes[4]?.evidence ?? {},
      completedAt,
    );
    appendPassivePageSignalChecks(candidateChecks, job.profileVersion, probes[4]?.evidence ?? {}, completedAt);
    const sanitized = sanitizeScanObservations(
      job.hostname,
      job.profileVersion,
      ["/"],
      candidateChecks,
    );
    const publicPolicyTransparencyAssessment = buildPublicPolicyAssessment(
      job.profileVersion,
      probes[4],
    );

    return {
      scannerVersion: publicPolicyTransparencyAssessment
        ? DOMAIN_V3_PUBLIC_POLICY_SCANNER_VERSION
        : getScannerVersion(job.profileVersion),
      startedAt,
      completedAt,
      verdict: evaluateVerdict(sanitized.checks),
      scope: sanitized.scope,
      checks: sanitized.checks,
      ...(publicPolicyTransparencyAssessment
        ? { publicPolicyTransparencyAssessment }
        : {}),
      metrics: {
        requestsCount: probes.reduce((sum, probe) => sum + (probe?.requestsCount ?? 0), 0),
        bytesCount: probes.reduce((sum, probe) => sum + (probe?.bytesCount ?? 0), 0),
        durationMs: Math.max(0, completedAt.getTime() - startedAt.getTime()),
        pagesCount: 0,
      },
    };
  }
}

function buildPublicPolicyAssessment(
  profileVersion: ScanProfileVersion,
  headersProbe: TransportV1ProbeResult | undefined,
): ReturnType<typeof assessPublicPolicyTransparency> | undefined {
  if (profileVersion !== DOMAIN_PROFILE_VERSION_V3) return undefined;
  const evidence = headersProbe?.evidence ?? {};
  const numericKeys = [
    "publicPolicyLinksFound",
    "publicPolicyPagesInspected",
    "publicPolicyUnavailablePages",
    "publicPolicyAccessDeniedPages",
    "publicPolicyProviderMentions",
    "publicPolicyProvidersMissingPurpose",
  ] as const;
  if (numericKeys.some((key) => typeof evidence[key] !== "number")) {
    return assessPublicPolicyTransparency({
      linksFound: 0,
      pagesInspected: 0,
      unavailablePages: 0,
      accessDeniedPages: 0,
      providerMentions: 0,
      providersMissingPurpose: 0,
      categories: [],
      auditorError: true,
    });
  }
  const rawCategories = evidence.publicPolicyCategories;
  const categories = typeof rawCategories === "string" && rawCategories.length > 0
    ? rawCategories.split(",")
    : [];
  return assessPublicPolicyTransparency({
    linksFound: evidence.publicPolicyLinksFound as number,
    pagesInspected: evidence.publicPolicyPagesInspected as number,
    unavailablePages: evidence.publicPolicyUnavailablePages as number,
    accessDeniedPages: evidence.publicPolicyAccessDeniedPages as number,
    providerMentions: evidence.publicPolicyProviderMentions as number,
    providersMissingPurpose: evidence.publicPolicyProvidersMissingPurpose as number,
    categories,
    auditorError: evidence.publicPolicyAuditorError === true || Boolean(headersProbe?.errorCode),
    budgetExhausted: evidence.publicPolicyBudgetExhausted === true,
  });
}

function appendInitialCookieCheck(
  checks: ScanCheck[],
  profileVersion: ScanProfileVersion,
  headersEvidence: TransportV1Evidence,
  observedAt: Date,
): void {
  if (profileVersion === TRANSPORT_PROFILE_VERSION) return;
  const inspected = headersEvidence.inspected === true;
  const cookieCount = headersEvidence.cookieCount;
  const insecureCookieCount = headersEvidence.insecureCookieCount;
  const catalogMatchCount = headersEvidence.catalogMatchCount;
  const consentPromptDetected = headersEvidence.consentPromptDetected;
  const probeErrorCode = headersEvidence.probeErrorCode;
  const evidence: TransportV1Evidence = {};
  if (typeof headersEvidence.inspected === "boolean") evidence.inspected = inspected;
  if (typeof cookieCount === "number") evidence.cookieCount = cookieCount;
  if (typeof insecureCookieCount === "number") evidence.insecureCookieCount = insecureCookieCount;
  if (typeof catalogMatchCount === "number") {
    evidence.catalogMatchCount = catalogMatchCount;
  }
  if (typeof consentPromptDetected === "boolean") {
    evidence.consentPromptDetected = consentPromptDetected;
  }
  if (typeof probeErrorCode === "string") {
    evidence.probeErrorCode = probeErrorCode;
  }
  const complete = inspected &&
    typeof cookieCount === "number" &&
    typeof insecureCookieCount === "number" &&
    typeof catalogMatchCount === "number" &&
    typeof consentPromptDetected === "boolean";
  checks.push({
    controlId: "DS-PRIV-05",
    method: "GET",
    severity: "medium",
    status: !complete
      ? "unknown"
      : catalogMatchCount > 0
        ? "fail"
        : "pass",
    required: true,
    observedAt,
    targetPath: "/",
    summary: "",
    limitation: "",
    evidence,
  });
}

function getScannerVersion(profileVersion: ScanProfileVersion): string {
  if (profileVersion === DOMAIN_PROFILE_VERSION_V3) return DOMAIN_V3_SCANNER_VERSION;
  if (profileVersion === DOMAIN_PROFILE_VERSION_V2) return DOMAIN_V2_SCANNER_VERSION;
  return profileVersion === DOMAIN_PROFILE_VERSION
    ? DOMAIN_SCANNER_VERSION
    : NETWORK_SCANNER_VERSION;
}

function isSupportedProfile(value: string): value is ScanProfileVersion {
  return value === TRANSPORT_PROFILE_VERSION || value === DOMAIN_PROFILE_VERSION || value === DOMAIN_PROFILE_VERSION_V2 || value === DOMAIN_PROFILE_VERSION_V3;
}

function getFixtureScannerVersion(profileVersion: ScanProfileVersion): string {
  if (profileVersion === DOMAIN_PROFILE_VERSION_V3) return DOMAIN_V3_FIXTURE_SCANNER_VERSION;
  if (profileVersion === DOMAIN_PROFILE_VERSION_V2) return DOMAIN_V2_FIXTURE_SCANNER_VERSION;
  return profileVersion === DOMAIN_PROFILE_VERSION ? DOMAIN_FIXTURE_SCANNER_VERSION : FIXTURE_SCANNER_VERSION;
}

function appendTlsVersionCheck(
  checks: ScanCheck[],
  profileVersion: ScanProfileVersion,
  evidence: TransportV1Evidence,
  observedAt: Date,
): void {
  if (profileVersion !== DOMAIN_PROFILE_VERSION_V3) return;
  const versionKeys = ["tls10Accepted", "tls11Accepted", "tls12Accepted", "tls13Accepted"] as const;
  const complete = versionKeys.every((key) => typeof evidence[key] === "boolean");
  let status: ScanCheck["status"] = "unknown";
  if (evidence.tls10Accepted === true || evidence.tls11Accepted === true) {
    status = "fail";
  } else if (
    complete && evidence.tls10Accepted === false && evidence.tls11Accepted === false &&
    (evidence.tls12Accepted === true || evidence.tls13Accepted === true)
  ) {
    status = "pass";
  }
  const tlsEvidence: TransportV1Evidence = {};
  for (const key of versionKeys) {
    const value = evidence[key];
    if (typeof value === "boolean") tlsEvidence[key] = value;
  }
  for (const key of ["tls10ProbeError", "tls11ProbeError", "tls12ProbeError", "tls13ProbeError"]) {
    const value = evidence[key];
    if (typeof value === "string") tlsEvidence[key] = value;
  }
  checks.push({
    controlId: "DS-TLS-02",
    method: "TLS",
    severity: "high",
    status,
    required: true,
    observedAt,
    targetPath: "/",
    summary: complete
      ? "Se probaron por separado las cuatro versiones de TLS incluidas en este control."
      : "No se pudieron comprobar todas las versiones de TLS; el criterio queda sin conclusión.",
    limitation: "Se intenta una negociación HTTPS HEAD por versión; no evalúa todos los cifrados ni la configuración TLS completa.",
    evidence: tlsEvidence,
  });
}

function appendPassivePageSignalChecks(
  checks: ScanCheck[],
  profileVersion: ScanProfileVersion,
  headersEvidence: TransportV1Evidence,
  observedAt: Date,
): void {
  if (profileVersion !== DOMAIN_PROFILE_VERSION_V2 && profileVersion !== DOMAIN_PROFILE_VERSION_V3) return;

  const inspected = headersEvidence.inspected === true;
  const trackingEvidence = pickNumericEvidence(headersEvidence, [
    "thirdPartyResourceReferences",
    "knownTrackingResourceReferences",
  ]);
  const performanceEvidence = pickNumericEvidence(headersEvidence, [
    "responseTimeMs",
    "responseBytes",
  ]);
  trackingEvidence.inspected = inspected;
  performanceEvidence.inspected = inspected;

  const trackerCount = trackingEvidence.knownTrackingResourceReferences;
  const elapsedMs = performanceEvidence.responseTimeMs;
  checks.push(
    {
      controlId: "DS-PRIV-06",
      method: "GET",
      severity: "medium",
      status: !inspected || typeof trackerCount !== "number"
        ? "unknown"
        : trackerCount > 0 ? "fail" : "pass",
      required: true,
      observedAt,
      targetPath: "/",
      summary: "",
      limitation: "Solo se contaron referencias visibles en el HTML inicial; no se ejecutó JavaScript ni se confirmó ninguna conexión.",
      evidence: trackingEvidence,
    },
    {
      controlId: "DS-QUAL-02",
      method: "GET",
      severity: "medium",
      status: !inspected || typeof elapsedMs !== "number"
        ? "unknown"
        : elapsedMs > 2_500 ? "fail" : "pass",
      required: true,
      observedAt,
      targetPath: "/",
      summary: "Medición provisional del tiempo de respuesta y tamaño recibido de la portada; no equivale a métricas de experiencia real.",
      limitation: "Una única respuesta GET desde el VPS; no mide Core Web Vitals, carga de recursos ni experiencia del visitante.",
      evidence: performanceEvidence,
    },
  );
}

function pickNumericEvidence(
  evidence: TransportV1Evidence,
  keys: readonly string[],
): TransportV1Evidence {
  const selected: TransportV1Evidence = {};
  for (const key of keys) {
    if (typeof evidence[key] === "number") selected[key] = evidence[key] as number;
  }
  return selected;
}

async function safelyObserve(
  observe: () => Promise<TransportV1Evidence>,
  signal: AbortSignal,
): Promise<TransportV1Evidence | undefined> {
  if (signal.aborted) return undefined;
  try {
    const evidence = await observe();
    return signal.aborted ? undefined : evidence;
  } catch {
    return undefined;
  }
}

async function safelyObserveNetwork(
  observe: () => Promise<TransportV1ProbeResult>,
  signal: AbortSignal,
): Promise<TransportV1ProbeResult | undefined> {
  if (signal.aborted) return undefined;
  try {
    const result = await observe();
    return signal.aborted ? { ...result, evidence: {} } : result;
  } catch (error) {
    return {
      evidence: {},
      requestsCount: 0,
      bytesCount: 0,
      errorCode: safeTransportErrorCode(error, "broker_failed"),
    };
  }
}

async function observeNetworkProbes(
  observations: readonly (() => Promise<TransportV1ProbeResult>)[],
  signal: AbortSignal,
  maxConcurrency: number,
): Promise<(TransportV1ProbeResult | undefined)[]> {
  const results: (TransportV1ProbeResult | undefined)[] = Array.from(
    { length: observations.length },
    () => undefined,
  );
  let nextIndex = 0;
  const workers = Array.from(
    { length: Math.min(maxConcurrency, observations.length) },
    async () => {
      while (nextIndex < observations.length) {
        const currentIndex = nextIndex;
        nextIndex += 1;
        const observe = observations[currentIndex];
        if (observe) {
          results[currentIndex] = await safelyObserveNetwork(observe, signal);
        }
      }
    },
  );
  await Promise.all(workers);
  return results;
}
