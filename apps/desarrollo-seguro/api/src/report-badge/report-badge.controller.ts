import { BadRequestException, Body, Controller, Header, Headers, HttpCode, HttpStatus, Inject, Param, Post } from "@nestjs/common";
import { ReportBadgeService } from "./report-badge.service.js";

@Controller("badges")
export class ReportBadgeController {
  constructor(@Inject(ReportBadgeService) private readonly badges: ReportBadgeService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @Header("Cache-Control", "no-store")
  issue(@Headers("authorization") authorization: string | undefined, @Body() body: unknown) {
    const input = readIssueBody(body);
    return this.badges.issue(readBearerToken(authorization), input.hostname, input.reportId);
  }

  @Post("verify")
  @HttpCode(HttpStatus.OK)
  @Header("Cache-Control", "no-store")
  verify(@Body() body: unknown, @Headers("origin") origin: string | undefined, @Headers("sec-fetch-site") fetchSite: string | undefined) {
    const input = readVerifyBody(body);
    return this.badges.verify(input.token, input.hostname, input.reportId, origin, fetchSite);
  }

  @Post(":token/revocation")
  @HttpCode(HttpStatus.OK)
  @Header("Cache-Control", "no-store")
  revoke(@Headers("authorization") authorization: string | undefined, @Param("token") token: string, @Body() body: unknown) {
    const input = readIssueBody(body);
    return this.badges.revoke(readBearerToken(authorization), token, input.hostname, input.reportId);
  }
}

function readIssueBody(value: unknown): { hostname: string; reportId: string } {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new BadRequestException("invalid_report_badge_request");
  const body = value as Record<string, unknown>;
  if (typeof body.hostname !== "string" || typeof body.reportId !== "string") throw new BadRequestException("invalid_report_badge_request");
  return { hostname: body.hostname, reportId: body.reportId };
}

function readVerifyBody(value: unknown): { token: string; hostname: string; reportId: string } {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new BadRequestException("invalid_report_badge_verification");
  const body = value as Record<string, unknown>;
  if (typeof body.token !== "string" || typeof body.hostname !== "string" || typeof body.reportId !== "string") {
    throw new BadRequestException("invalid_report_badge_verification");
  }
  return { token: body.token, hostname: body.hostname, reportId: body.reportId };
}

function readBearerToken(value: string | undefined): string | undefined {
  if (!value?.startsWith("Bearer ")) return undefined;
  return value.slice("Bearer ".length);
}
