import "reflect-metadata";
import { RequestMethod } from "@nestjs/common";
import {
  HEADERS_METADATA,
  GUARDS_METADATA,
  METHOD_METADATA,
  PATH_METADATA,
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
  ])("serves $route as a non-cacheable GET route", ({ handler, route }) => {
    expect(Reflect.getMetadata(PATH_METADATA, handler)).toBe(route);
    expect(Reflect.getMetadata(METHOD_METADATA, handler)).toBe(
      RequestMethod.GET,
    );
    expect(Reflect.getMetadata(HEADERS_METADATA, handler)).toEqual([
      { name: CACHE_CONTROL_HEADER, value: NO_STORE_VALUE },
    ]);
  });
});
