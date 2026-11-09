import { Controller, Get, Header, Param, UseGuards } from "@nestjs/common";
import {
  PublicScanService,
  type PublicDomainStatus,
  type PublicReport,
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

  @Get("reports/:reportId")
  @Header("Cache-Control", CACHE_CONTROL_NO_STORE)
  getReport(@Param("reportId") reportId: string): Promise<PublicReport> {
    return this.scans.getReport(reportId);
  }
}
