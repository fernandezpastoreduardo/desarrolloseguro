import {
  Body,
  Controller,
  Get,
  Header,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  UseGuards,
} from "@nestjs/common";
import {
  PublicScanService,
  type PublicAnalysisRequest,
  type PublicDomainStatus,
  type PublicReport,
  type PublicReportHistoryEntry,
} from "./public-scan.service.js";
import { PublicScanRateLimitGuard } from "./public-scan-rate-limit.js";

const CACHE_CONTROL_NO_STORE = "no-store";

@Controller()
@UseGuards(PublicScanRateLimitGuard)
export class PublicScanController {
  constructor(private readonly scans: PublicScanService) {}

  @Get("domains/:hostname/status")
  @Header("Cache-Control", CACHE_CONTROL_NO_STORE)
  getDomainStatus(
    @Param("hostname") hostname: string,
  ): Promise<PublicDomainStatus> {
    return this.scans.getDomainStatus(hostname);
  }

  @Post("domains/:hostname/analysis-requests")
  @HttpCode(HttpStatus.ACCEPTED)
  @Header("Cache-Control", CACHE_CONTROL_NO_STORE)
  requestAnalysis(
    @Param("hostname") hostname: string,
    @Body() body: unknown,
  ): Promise<PublicAnalysisRequest> {
    return this.scans.requestAnalysis(hostname, body);
  }

  @Get("reports/:reportId")
  @Header("Cache-Control", CACHE_CONTROL_NO_STORE)
  getReport(@Param("reportId") reportId: string): Promise<PublicReport> {
    return this.scans.getReport(reportId);
  }

  @Get("domains/:hostname/history")
  @Header("Cache-Control", CACHE_CONTROL_NO_STORE)
  getReportHistory(
    @Param("hostname") hostname: string,
  ): Promise<PublicReportHistoryEntry[]> {
    return this.scans.getReportHistory(hostname);
  }
}
