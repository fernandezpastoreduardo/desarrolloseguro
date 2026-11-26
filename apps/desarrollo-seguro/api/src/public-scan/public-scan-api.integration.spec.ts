import "reflect-metadata";
import { Controller, Module, type INestApplication } from "@nestjs/common";
import { GUARDS_METADATA } from "@nestjs/common/constants";
import { NestFactory } from "@nestjs/core";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PublicScanController } from "./public-scan.controller.js";
import { PublicScanRateLimitGuard } from "./public-scan-rate-limit.js";
import { PublicScanRateLimiter } from "./public-scan-rate-limiter.js";
import { PublicScanService } from "./public-scan.service.js";
import { parseTrustedProxyCidrs } from "../trusted-proxy-cidrs.js";

const API_PREFIX = "api/desarrollo-seguro/v1";
const STATUS_PATH = "domains/example.com/status";
const ANALYSIS_REQUEST_PATH = "domains/example.com/analysis-requests";
const TARGET_URL = "https://example.com/legal/privacy?lang=es";
const REPORT_ID = "123e4567-e89b-42d3-a456-426614174000";
const CLIENT_IP_HEADER = "X-Forwarded-For";
const RATE_LIMIT = 60;
const DOMAIN_LIMIT = 120;
const RATE_LIMIT_STATUS = 429;
const STATUS_BODY = {
  hostname: "example.com",
  enrollment: "monitored",
  state: "not_scanned",
  activeJobId: null,
  failureCode: null,
  lastReport: null,
  checkedAt: "2026-11-03T00:00:00.000Z",
};
const REPORT_BODY = { id: REPORT_ID, hostname: "example.com" };
const ANALYSIS_REQUEST_BODY = { hostname: "example.com", state: "queued", targetUrl: TARGET_URL };
const service = {
  getDomainStatus: vi.fn().mockResolvedValue(STATUS_BODY),
  getReport: vi.fn().mockResolvedValue(REPORT_BODY),
  requestAnalysis: vi.fn().mockResolvedValue(ANALYSIS_REQUEST_BODY),
};

@Controller()
class PublicScanHttpTestController extends PublicScanController {
  constructor() {
    super(service as unknown as PublicScanService);
  }
}

Reflect.defineMetadata(GUARDS_METADATA, [], PublicScanHttpTestController);

@Module({
  controllers: [PublicScanHttpTestController],
})
class PublicScanTestModule {}

describe("public scan API over HTTP", () => {
  let app: INestApplication;

  afterEach(async () => {
    if (app) await app.close();
    vi.clearAllMocks();
  });

  it("serves status and report as non-cacheable GET responses", async () => {
    app = await createTestApplication(undefined);
    const baseUrl = await app.getUrl();

    const statusResponse = await fetch(
      `${baseUrl}/${API_PREFIX}/${STATUS_PATH}`,
    );
    const reportResponse = await fetch(
      `${baseUrl}/${API_PREFIX}/reports/${REPORT_ID}`,
    );

    expect(statusResponse.status, await statusResponse.clone().text()).toBe(
      200,
    );
    expect(statusResponse.headers.get("cache-control")).toBe("no-store");
    await expect(statusResponse.json()).resolves.toEqual(STATUS_BODY);
    const targetStatusResponse = await fetch(
      `${baseUrl}/${API_PREFIX}/${STATUS_PATH}?targetUrl=${encodeURIComponent(`${TARGET_URL}#fragment`)}`,
    );
    expect(targetStatusResponse.status).toBe(200);
    expect(service.getDomainStatus).toHaveBeenCalledWith("example.com", `${TARGET_URL}#fragment`);
    expect(reportResponse.status).toBe(200);
    expect(reportResponse.headers.get("cache-control")).toBe("no-store");
    await expect(reportResponse.json()).resolves.toEqual(REPORT_BODY);
  });

  it("accepts an explicit analysis request without cacheable responses", async () => {
    app = await createTestApplication(undefined);
    const baseUrl = await app.getUrl();

    const response = await fetch(
      `${baseUrl}/${API_PREFIX}/${ANALYSIS_REQUEST_PATH}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ authorized: true, targetUrl: TARGET_URL }),
      },
    );

    expect(response.status).toBe(202);
    expect(response.headers.get("cache-control")).toBe("no-store");
    await expect(response.json()).resolves.toEqual(ANALYSIS_REQUEST_BODY);
    expect(service.requestAnalysis).toHaveBeenCalledWith(
      "example.com",
      { authorized: true, targetUrl: TARGET_URL },
    );
  });

  it("does not trust forwarded IPs unless the proxy address is configured", async () => {
    app = await createTestApplication(undefined);
    const baseUrl = await app.getUrl();

    for (let request = 0; request < RATE_LIMIT; request += 1) {
      const response = await fetch(`${baseUrl}/${API_PREFIX}/${STATUS_PATH}`, {
        headers: { [CLIENT_IP_HEADER]: `198.51.100.${request + 1}` },
      });
      expect(response.status).toBe(200);
    }

    const limitedResponse = await fetch(
      `${baseUrl}/${API_PREFIX}/${STATUS_PATH}`,
      { headers: { [CLIENT_IP_HEADER]: "203.0.113.90" } },
    );

    expect(limitedResponse.status).toBe(RATE_LIMIT_STATUS);
    expect(limitedResponse.headers.get("retry-after")).toBe("60");
    expect(limitedResponse.headers.get("cache-control")).toBe("no-store");
    await expect(limitedResponse.json()).resolves.toMatchObject({
      message: "rate_limited",
    });
  });

  it("uses forwarded client IPs only when loopback is configured as a trusted proxy", async () => {
    app = await createTestApplication("127.0.0.1");
    const baseUrl = await app.getUrl();

    for (let request = 0; request < DOMAIN_LIMIT; request += 1) {
      const response = await fetch(`${baseUrl}/${API_PREFIX}/${STATUS_PATH}`, {
        headers: { [CLIENT_IP_HEADER]: `198.51.100.${request + 1}` },
      });
      expect(response.status).toBe(200);
    }

    const limitedResponse = await fetch(
      `${baseUrl}/${API_PREFIX}/${STATUS_PATH}`,
      { headers: { [CLIENT_IP_HEADER]: "203.0.113.90" } },
    );

    expect(limitedResponse.status).toBe(RATE_LIMIT_STATUS);
    expect(limitedResponse.headers.get("retry-after")).toBe("60");
    expect(limitedResponse.headers.get("cache-control")).toBe("no-store");
  });
});

async function createTestApplication(
  trustedProxyCidrs: string | undefined,
): Promise<INestApplication> {
  const limiter = new PublicScanRateLimiter();
  const testApp = await NestFactory.create(PublicScanTestModule, {
    logger: ["error"],
  });
  testApp.useGlobalGuards(new PublicScanRateLimitGuard(limiter));
  testApp
    .getHttpAdapter()
    .getInstance()
    .set("trust proxy", parseTrustedProxyCidrs(trustedProxyCidrs));
  testApp.setGlobalPrefix(API_PREFIX);
  await testApp.listen(0, "127.0.0.1");
  return testApp;
}
