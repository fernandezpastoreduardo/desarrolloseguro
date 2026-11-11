import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from "@nestjs/common";
import {
  assessDomainEthics,
  normalizeHostname,
  type DomainEthicsAssessment,
} from "@desarrolloseguro/core";
import {
  type EnsureScanResult,
  type PostgresScanStore,
  type PublicDomainSnapshot,
  type PublicScanReport,
  type PublicScanSeverity,
  type PublicScanStatus,
  type ScanFailureCode,
} from "@desarrolloseguro/persistence";
import { REPORT_ID_PATTERN } from "./public-scan.constants.js";

const PUBLIC_STORAGE_ERROR = "development_security_unavailable";
const PUBLIC_SCAN_READ_FAILED = "PUBLIC_SCAN_READ_FAILED";
const PUBLIC_SCAN_ADMISSION_FAILED = "PUBLIC_SCAN_ADMISSION_FAILED";
const ANALYSIS_AUTHORIZATION_REQUIRED = "analysis_authorization_required";

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
  ethicsAssessment: DomainEthicsAssessment;
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
  }>;
};

export type PublicDomainStatus = {
  hostname: string;
  enrollment: "monitored" | "on_demand";
  state: PublicDomainState;
  activeJobId: string | null;
  failureCode: ScanFailureCode | null;
  lastReport: PublicReport | null;
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
      lastReport: report ? toPublicReport(report) : null,
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
      return toPublicReport(report);
    } catch (error) {
      if (error instanceof NotFoundException) throw error;
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
      const result = await scanStore.requestOnDemandScan(hostname);
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

function toPublicReport(report: PublicScanReport): PublicReport {
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
    ethicsAssessment: assessDomainEthics(report.checks),
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
    })),
  };
}
