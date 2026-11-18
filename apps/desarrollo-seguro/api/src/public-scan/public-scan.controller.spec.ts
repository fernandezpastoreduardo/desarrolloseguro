import "reflect-metadata";
import { HttpStatus, RequestMethod } from "@nestjs/common";
import {
  HEADERS_METADATA,
  GUARDS_METADATA,
  METHOD_METADATA,
  PATH_METADATA,
  HTTP_CODE_METADATA,
} from "@nestjs/common/constants";
import { describe, expect, it } from "vitest";
import { PublicScanController } from "./public-scan.controller.js";
import { PublicScanRateLimitGuard } from "./public-scan-rate-limit.js";

const CACHE_CONTROL_HEADER = "Cache-Control";
const NO_STORE_VALUE = "no-store";

describe("PublicScanController routes", () => {
  it("applies the rate-limit guard to public scan reads", () => {
    expect(
      Reflect.getMetadata(GUARDS_METADATA, PublicScanController),
    ).toContain(PublicScanRateLimitGuard);
  });

  it.each([
    {
      handler: PublicScanController.prototype.getDomainStatus,
      route: "domains/:hostname/status",
    },
    {
      handler: PublicScanController.prototype.getReport,
      route: "reports/:reportId",
    },
    {
      handler: PublicScanController.prototype.getReportHistory,
      route: "domains/:hostname/history",
    },
  ])("serves $route as a non-cacheable GET route", ({ handler, route }) => {
    expect(Reflect.getMetadata(PATH_METADATA, handler)).toBe(route);
    expect(Reflect.getMetadata(METHOD_METADATA, handler)).toBe(
      RequestMethod.GET,
    );
    expect(Reflect.getMetadata(HEADERS_METADATA, handler)).toEqual([
      { name: CACHE_CONTROL_HEADER, value: NO_STORE_VALUE },
    ]);
  });

  it("exposes an explicit, non-cacheable POST route for analysis requests", () => {
    const handler = PublicScanController.prototype.requestAnalysis;
    expect(Reflect.getMetadata(PATH_METADATA, handler)).toBe(
      "domains/:hostname/analysis-requests",
    );
    expect(Reflect.getMetadata(METHOD_METADATA, handler)).toBe(
      RequestMethod.POST,
    );
    expect(Reflect.getMetadata(HTTP_CODE_METADATA, handler)).toBe(
      HttpStatus.ACCEPTED,
    );
    expect(Reflect.getMetadata(HEADERS_METADATA, handler)).toEqual([
      { name: CACHE_CONTROL_HEADER, value: NO_STORE_VALUE },
    ]);
  });
});
