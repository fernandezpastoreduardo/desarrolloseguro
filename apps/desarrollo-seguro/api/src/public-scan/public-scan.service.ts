import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from "@nestjs/common";
import {
  assessDomainEthics,
  assessDomainEthicsV5,
  assessDomainEthicsV6,
  assessDomainEthicsV4,
  assessGlobalScore,
  assessBetaCertification,
  toInternalAuditPublicSummary,
  type InternalAuditPublicSummary,
  normalizeHostname,
  projectPublicEvidence,
  type BetaControlId,
  type BetaControlObservation,
  type ScanFailureCode,
  type DomainEthicsAssessment,
  type GlobalScoreAssessment,
  type PrivacyAssessment,
  type ProcessorTransparencyAssessment,
  type PublicPolicyTransparencyAssessment,
  type PublicServiceComparison,
  type FirstEntryPolicyAccess,
  type LegalCookieFinding,
  type ScanFailureDiagnostic,
} from "@desarrolloseguro/core";
import {
  type EnsureScanResult,
  type PostgresScanStore,
  type PublicDomainSnapshot,
  type PublicScanReport,
  type PublicBetaCertification,
  type PublicScanSeverity,
  type PublicScanStatus,
} from "@desarrolloseguro/persistence";
import { REPORT_ID_PATTERN } from "./public-scan.constants.js";

const PUBLIC_STORAGE_ERROR = "development_security_unavailable";
const PUBLIC_SCAN_READ_FAILED = "PUBLIC_SCAN_READ_FAILED";
const PUBLIC_SCAN_ADMISSION_FAILED = "PUBLIC_SCAN_ADMISSION_FAILED";
const ANALYSIS_AUTHORIZATION_REQUIRED = "analysis_authorization_required";
const PUBLIC_HISTORY_LIMIT = 12;

export type PublicDomainState =
  "fresh" | "updating" | "stale" | "failed" | "not_scanned" | "unavailable";

export type PublicReport = {
  id: string;
  hostname: string;
  profileVersion: string;
  scannerVersion: string;
  vantage: "same_vps";
  trigger: "scheduled" | "requested";
  startedAt: string;
  completedAt: string;
  expiresAt: string;
  verdict: "pass" | "fail" | "inconclusive";
  globalAssessment: GlobalScoreAssessment;
  ethicsAssessment: DomainEthicsAssessment;
  privacyAssessment: PrivacyAssessment | null;
  processorTransparencyAssessment: ProcessorTransparencyAssessment | null;
  publicPolicyTransparencyAssessment: PublicPolicyTransparencyAssessment | null;
  publicServiceComparison: PublicServiceComparison | null;
  firstEntryPolicyAccess: FirstEntryPolicyAccess | null;
  providerCatalogVersion: string | null;
  legalCookieFindings?: LegalCookieFinding[];
  betaCertification: ReturnType<typeof assessBetaCertification>;
  certification: PublicBetaCertificationResponse | null;
  internalAuditSummary: InternalAuditPublicSummary | null;
  internalAuditState?: "running" | "review" | "complete" | null;
  scope: string[];
  checks: Array<{
    controlId: string;
    status: PublicScanStatus;
    required: boolean;
    severity: PublicScanSeverity;
    observedAt: string;
    targetPath: string;
    method: string;
    summary: string;
    limitation: string;
    evidence: Record<string, string | number | boolean>;
  }>;
};

export type PublicReportHistoryEntry = {
  id: string;
  hostname: string;
  profileVersion: string;
  completedAt: string;
  expiresAt: string;
  verdict: PublicReport["verdict"];
  globalAssessment: GlobalScoreAssessment;
  score: number | null;
  assessedCriteria: number;
  totalCriteria: number;
  certificationState: PublicBetaCertificationResponse["state"] | null;
};

export type PublicBetaCertificationResponse = {
  policyVersion: "beta-0.1";
  state: "pending" | "active" | "suspended";
  latestAssessmentStatus: "eligible" | "pending" | "blocked";
  score: number | null;
  lastCheckedAt: string;
  certifiedReportId: string | null;
};

export type PublicDomainStatus = {
  hostname: string;
  enrollment: "monitored" | "on_demand";
  state: PublicDomainState;
  activeJobId: string | null;
  failureCode: ScanFailureCode | null;
  failureDiagnostic: ScanFailureDiagnostic | null;
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

export type PublicAnalysisRequestState = EnsureScanResult["kind"];

export type PublicAnalysisRequest = {
  hostname: string;
  state: PublicAnalysisRequestState;
};

type PublicReadStore = Pick<
  PostgresScanStore,
  "readPublicDomainSnapshot" | "readPublicReport"
> & {
  readPublicReportHistory?: (
    hostname: string,
    limit: number,
  ) => Promise<PublicScanReport[]>;
  resolveCanonicalHostname?: (hostname: string) => Promise<string | null>;
  requestOnDemandScan?: (hostname: string) => Promise<EnsureScanResult>;
};

@Injectable()
export class PublicScanService {
  private readonly logger = new Logger(PublicScanService.name);

  constructor(private readonly store: { scanStore: PublicReadStore }) {}

  async getDomainStatus(input: unknown): Promise<PublicDomainStatus> {
    const hostname = normalizeRequestHostname(input);
    const checkedAt = new Date();
    let snapshot: PublicDomainSnapshot | null;
    try {
      snapshot = await this.store.scanStore.readPublicDomainSnapshot(hostname);
    } catch {
      this.logger.error(PUBLIC_SCAN_READ_FAILED);
      throw new ServiceUnavailableException(PUBLIC_STORAGE_ERROR);
    }

    if (!snapshot) {
      return {
        hostname,
        enrollment: "on_demand",
        state: "not_scanned",
        activeJobId: null,
        failureCode: null,
        failureDiagnostic: null,
        lastReport: null,
        checkedAt: checkedAt.toISOString(),
      };
    }

    const isOptedOut = snapshot.optedOut;
    const report = isOptedOut ? null : snapshot.lastReport;
    const isUpdating = !isOptedOut && snapshot.activeJobId !== null;
    const state = getPublicState(
      isOptedOut,
      isUpdating,
      report,
      snapshot.lastFailure,
      checkedAt,
    );

    return {
      hostname,
      enrollment: isOptedOut ? "on_demand" : snapshot.enrollment,
      state,
      activeJobId: isOptedOut ? null : snapshot.activeJobId,
      failureCode: state === "failed" ? snapshot.lastFailure?.code ?? null : null,
      failureDiagnostic: state === "failed" ? snapshot.lastFailure?.diagnostic ?? null : null,
      lastReport: report ? toPublicReport(report, report.hostname === "grumphya.com"
        ? state === "updating" ? "running" : state === "fresh" ? undefined : "review"
        : null) : null,
      ...(snapshot.hostnameResolution ? { hostnameResolution: snapshot.hostnameResolution } : {}),
      checkedAt: checkedAt.toISOString(),
    };
  }

  async getReport(reportId: unknown): Promise<PublicReport> {
    if (typeof reportId !== "string" || !REPORT_ID_PATTERN.test(reportId)) {
      throw new NotFoundException("development_security_report_not_found");
    }

    try {
      const report = await this.store.scanStore.readPublicReport(reportId);
      if (!report) {
        throw new NotFoundException("development_security_report_not_found");
      }
      let internalAuditState: "running" | "review" | "complete" | null = null;
      if (report.hostname === "grumphya.com") {
        const snapshot = await this.store.scanStore.readPublicDomainSnapshot("grumphya.com");
        const isLatest = snapshot?.lastReport?.id === report.id;
        const hasNewerFailure = Boolean(snapshot?.lastFailure && snapshot.lastReport &&
          snapshot.lastFailure.failedAt > snapshot.lastReport.completedAt);
        internalAuditState = isLatest && snapshot?.activeJobId !== null
          ? "running"
          : isLatest && snapshot && (snapshot.lastReport!.expiresAt.getTime() <= Date.now() || hasNewerFailure)
            ? "review"
            : report.internalAuditSummary?.status === "complete" ? "complete" : "review";
      }
      return toPublicReport(report, internalAuditState);
    } catch (error) {
      if (error instanceof NotFoundException) throw error;
      this.logger.error(PUBLIC_SCAN_READ_FAILED);
      throw new ServiceUnavailableException(PUBLIC_STORAGE_ERROR);
    }
  }

  async getReportHistory(input: unknown): Promise<PublicReportHistoryEntry[]> {
    const hostname = normalizeRequestHostname(input);
    const readHistory = this.store.scanStore.readPublicReportHistory;
    if (!readHistory) {
      this.logger.error(PUBLIC_SCAN_READ_FAILED);
      throw new ServiceUnavailableException(PUBLIC_STORAGE_ERROR);
    }
    try {
      const canonicalHostname = await this.store.scanStore.resolveCanonicalHostname?.(hostname);
      const reports = await readHistory.call(
        this.store.scanStore,
        canonicalHostname ?? hostname,
        PUBLIC_HISTORY_LIMIT,
      );
      return reports.map(toPublicHistoryEntry);
    } catch {
      this.logger.error(PUBLIC_SCAN_READ_FAILED);
      throw new ServiceUnavailableException(PUBLIC_STORAGE_ERROR);
    }
  }

  async requestAnalysis(
    input: unknown,
    body: unknown,
  ): Promise<PublicAnalysisRequest> {
    const hostname = normalizeRequestHostname(input);
    if (!isAuthorizedAnalysisRequest(body)) {
      throw new BadRequestException(ANALYSIS_AUTHORIZATION_REQUIRED);
    }
    const scanStore = this.store.scanStore;
    if (!scanStore.requestOnDemandScan) {
      this.logger.error(PUBLIC_SCAN_ADMISSION_FAILED);
      throw new ServiceUnavailableException(PUBLIC_STORAGE_ERROR);
    }

    try {
      const canonicalHostname = await scanStore.resolveCanonicalHostname?.(hostname);
      const result = await scanStore.requestOnDemandScan(canonicalHostname ?? hostname);
      return { hostname, state: result.kind };
    } catch {
      this.logger.error(PUBLIC_SCAN_ADMISSION_FAILED);
      throw new ServiceUnavailableException(PUBLIC_STORAGE_ERROR);
    }
  }
}

function isAuthorizedAnalysisRequest(value: unknown): boolean {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    Object.keys(value).length === 1 &&
    "authorized" in value &&
    value.authorized === true
  );
}

function normalizeRequestHostname(input: unknown): string {
  try {
    return normalizeHostname(input);
  } catch {
    throw new BadRequestException("invalid_hostname");
  }
}

function getPublicState(
  optedOut: boolean,
  isUpdating: boolean,
  report: PublicScanReport | null,
  lastFailure: PublicDomainSnapshot["lastFailure"],
  now: Date,
): PublicDomainState {
  if (optedOut) return "unavailable";
  if (isUpdating) return "updating";
  if (lastFailure && (!report || lastFailure.failedAt > report.completedAt)) {
    return "failed";
  }
  if (!report) return "not_scanned";
  return report.expiresAt.getTime() > now.getTime() ? "fresh" : "stale";
}

function toPublicReport(
  report: PublicScanReport,
  internalAuditState: "running" | "review" | "complete" | null | undefined = undefined,
): PublicReport {
  const processorTransparencyAssessment = report.processorTransparencyAssessment ?? null;
  const publicPolicyTransparencyAssessment = report.publicPolicyTransparencyAssessment ?? null;
  const publicServiceComparison = report.publicServiceComparison ?? null;
  const ethicsAssessment = report.profileVersion === "domain-v4" &&
    ["domain-v4-network-adapter-5", "domain-v4-network-adapter-6", "domain-v4-network-adapter-7"].includes(report.scannerVersion)
    ? assessDomainEthicsV6(report.checks, publicServiceComparison)
    : report.profileVersion === "domain-v4" &&
    report.scannerVersion === "domain-v4-network-adapter-2" && publicPolicyTransparencyAssessment
    ? assessDomainEthicsV5(report.checks, processorTransparencyAssessment, publicPolicyTransparencyAssessment)
    : report.profileVersion === "domain-v4"
    ? assessDomainEthicsV5(report.checks, processorTransparencyAssessment)
    : processorTransparencyAssessment
      ? assessDomainEthicsV4(report.checks, processorTransparencyAssessment)
      : assessDomainEthics(report.checks);
  const privacyAssessment = report.privacyAssessment ?? null;
  const legalCookieFindings = report.legalCookieFindings;
  const legalViolationAccredited = Boolean(legalCookieFindings?.length) || Boolean(
    publicServiceComparison?.providerDocumentation?.some(({ comparisons }) =>
      comparisons.some(({ legalFinding }) => legalFinding?.status === "infraccion_legal_acreditada"),
    ),
  );
  const resolvedInternalAuditState = report.hostname !== "grumphya.com"
    ? null
    : internalAuditState ?? (report.internalAuditSummary?.status === "complete" ? "complete" : "review");
  return {
    id: report.id,
    hostname: report.hostname,
    profileVersion: report.profileVersion,
    scannerVersion: report.scannerVersion,
    vantage: report.vantage,
    trigger: report.trigger,
    startedAt: report.startedAt.toISOString(),
    completedAt: report.completedAt.toISOString(),
    expiresAt: report.expiresAt.toISOString(),
    verdict: report.verdict,
    globalAssessment: assessGlobalScore(ethicsAssessment, privacyAssessment, legalViolationAccredited),
    ethicsAssessment,
    privacyAssessment,
    processorTransparencyAssessment,
    publicPolicyTransparencyAssessment,
    publicServiceComparison,
    firstEntryPolicyAccess: report.firstEntryPolicyAccess ?? null,
    providerCatalogVersion: report.providerCatalogVersion ?? null,
    ...(legalCookieFindings?.length ? { legalCookieFindings } : {}),
    betaCertification: assessBetaCertification(toBetaObservations(report.checks)),
    certification: toPublicCertification(report.certification),
    internalAuditState: resolvedInternalAuditState,
    internalAuditSummary: report.hostname === "grumphya.com"
      ? resolvedInternalAuditState !== "complete" || !report.internalAuditSummary
        ? toInternalAuditPublicSummary(null)
        : report.internalAuditSummary
      : null,
    scope: report.scope,
    checks: report.checks.map((check) => ({
      controlId: check.controlId,
      status: check.status,
      required: check.required,
      severity: check.severity,
      observedAt: check.observedAt.toISOString(),
      targetPath: check.targetPath,
      method: check.method,
      summary: check.summary,
      limitation: check.limitation,
      evidence: projectPublicEvidence(check.controlId, check.evidence),
    })),
  };
}

function toPublicHistoryEntry(report: PublicScanReport): PublicReportHistoryEntry {
  const publicReport = toPublicReport(report);
  return {
    id: publicReport.id,
    hostname: publicReport.hostname,
    profileVersion: publicReport.profileVersion,
    completedAt: publicReport.completedAt,
    expiresAt: publicReport.expiresAt,
    verdict: publicReport.verdict,
    globalAssessment: publicReport.globalAssessment,
    score: publicReport.ethicsAssessment.score,
    assessedCriteria: publicReport.ethicsAssessment.assessedCriteria,
    totalCriteria: publicReport.ethicsAssessment.totalCriteria,
    certificationState: publicReport.certification?.state ?? null,
  };
}

function toPublicCertification(
  certification: PublicBetaCertification | null,
): PublicBetaCertificationResponse | null {
  if (!certification) return null;
  return {
    policyVersion: certification.policyVersion,
    state: certification.state,
    latestAssessmentStatus: certification.latestAssessmentStatus,
    score: certification.score,
    lastCheckedAt: certification.lastCheckedAt.toISOString(),
    certifiedReportId: certification.certifiedReportId,
  };
}

function toBetaObservations(
  checks: PublicScanReport["checks"],
): BetaControlObservation[] {
  return checks.flatMap((check) => {
    if (!isBetaControlId(check.controlId)) return [];
    return [{
      controlId: check.controlId,
      status: check.status === "pass" || check.status === "fail" ? check.status : "unknown",
      summary: check.summary,
    }];
  });
}

function isBetaControlId(value: string): value is BetaControlId {
  return ["DS-TLS-01", "DS-TLS-02", "DS-HDR-01", "DS-PRIV-05"].includes(value as BetaControlId);
}
