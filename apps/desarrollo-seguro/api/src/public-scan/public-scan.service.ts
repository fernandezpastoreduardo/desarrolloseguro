import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from "@nestjs/common";
import { normalizeHostname } from "@desarrolloseguro/core";
import {
  type PostgresScanStore,
  type PublicDomainSnapshot,
  type PublicScanReport,
  type PublicScanSeverity,
  type PublicScanStatus,
} from "@desarrolloseguro/persistence";
import { REPORT_ID_PATTERN } from "./public-scan.constants.js";

const PUBLIC_STORAGE_ERROR = "development_security_unavailable";
const PUBLIC_SCAN_READ_FAILED = "PUBLIC_SCAN_READ_FAILED";

export type PublicDomainState =
  "fresh" | "updating" | "stale" | "not_scanned" | "unavailable";

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
  lastReport: PublicReport | null;
  checkedAt: string;
};

type PublicReadStore = Pick<
  PostgresScanStore,
  "readPublicDomainSnapshot" | "readPublicReport"
>;

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
        lastReport: null,
        checkedAt: checkedAt.toISOString(),
      };
    }

    const isOptedOut = snapshot.optedOut;
    const report = isOptedOut ? null : snapshot.lastReport;
    const isUpdating = !isOptedOut && snapshot.activeJobId !== null;
    const state = getPublicState(isOptedOut, isUpdating, report, checkedAt);

    return {
      hostname,
      enrollment: isOptedOut ? "on_demand" : snapshot.enrollment,
      state,
      activeJobId: isOptedOut ? null : snapshot.activeJobId,
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
  now: Date,
): PublicDomainState {
  if (optedOut) return "unavailable";
  if (isUpdating) return "updating";
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
