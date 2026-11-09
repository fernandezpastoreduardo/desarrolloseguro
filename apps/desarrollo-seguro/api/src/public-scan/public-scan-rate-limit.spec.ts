import { HttpException } from "@nestjs/common";
import { describe, expect, it, vi } from "vitest";
import type { ExecutionContext } from "@nestjs/common";
import { PublicScanRateLimitGuard } from "./public-scan-rate-limit.js";
import { PublicScanRateLimiter } from "./public-scan-rate-limiter.js";

const WINDOW_MS = 60_000;
const ORIGIN_LIMIT = 60;
const DOMAIN_LIMIT = 120;
const GLOBAL_LIMIT = 300;
const REPORT_LIMIT = 120;
const VALID_REPORT_ID = "123e4567-e89b-42d3-a456-426614174000";

describe("PublicScanRateLimiter", () => {
  it("limits requests by client IP and allows requests again after one minute", () => {
    vi.useFakeTimers();
    const limiter = new PublicScanRateLimiter();

    try {
      for (let request = 0; request < ORIGIN_LIMIT; request += 1) {
        expect(
          limiter.consume({ clientIp: "203.0.113.10", hostname: null }),
        ).toMatchObject({ allowed: true });
      }

      expect(
        limiter.consume({ clientIp: "203.0.113.10", hostname: null }),
      ).toMatchObject({ allowed: false, retryAfterSeconds: 60 });

      vi.advanceTimersByTime(WINDOW_MS - 499);

      expect(
        limiter.consume({ clientIp: "203.0.113.10", hostname: null }),
      ).toMatchObject({ allowed: false, retryAfterSeconds: 1 });

      vi.advanceTimersByTime(499);

      expect(
        limiter.consume({ clientIp: "203.0.113.10", hostname: null }),
      ).toMatchObject({ allowed: true });
    } finally {
      vi.useRealTimers();
    }
  });

  it("limits a hot domain across different clients", () => {
    const limiter = new PublicScanRateLimiter();

    for (let request = 0; request < DOMAIN_LIMIT; request += 1) {
      expect(
        limiter.consume({
          clientIp: `203.0.113.${request}`,
          hostname: "example.com",
        }),
      ).toMatchObject({ allowed: true });
    }

    expect(
      limiter.consume({ clientIp: "198.51.100.1", hostname: "example.com" }),
    ).toMatchObject({ allowed: false, retryAfterSeconds: 60 });
  });

  it("limits each valid report UUID independently", () => {
    const limiter = new PublicScanRateLimiter();

    for (let request = 0; request < REPORT_LIMIT; request += 1) {
      expect(
        limiter.consume({
          clientIp: `report-source-${request}`,
          hostname: null,
          reportId: VALID_REPORT_ID,
        }),
      ).toMatchObject({ allowed: true });
    }

    expect(
      limiter.consume({
        clientIp: "report-source-over-limit",
        hostname: null,
        reportId: VALID_REPORT_ID,
      }),
    ).toMatchObject({ allowed: false, retryAfterSeconds: 60 });

    expect(
      limiter.consume({
        clientIp: "different-report-source",
        hostname: null,
        reportId: "123e4567-e89b-42d3-a456-426614174001",
      }),
    ).toMatchObject({ allowed: true });
  });

  it("does not apply report buckets to malformed report IDs", () => {
    const limiter = new PublicScanRateLimiter();

    for (let request = 0; request <= REPORT_LIMIT; request += 1) {
      expect(
        limiter.consume({
          clientIp: `invalid-report-source-${request}`,
          hostname: null,
          reportId: "not-a-uuid",
        }),
      ).toMatchObject({ allowed: true });
    }
  });

  it("does not consume tracking capacity or the global budget for rejected requests", () => {
    const limiter = new PublicScanRateLimiter();

    for (let request = 0; request < DOMAIN_LIMIT; request += 1) {
      expect(
        limiter.consume({
          clientIp: `hot-domain-source-${request}`,
          hostname: "hot.example.net",
        }),
      ).toMatchObject({ allowed: true });
    }

    expect(
      limiter.consume({
        clientIp: "rejected-domain-source",
        hostname: "hot.example.net",
      }),
    ).toMatchObject({ allowed: false });
    expect(limiter.trackedKeyCount).toBe(DOMAIN_LIMIT + 1);

    for (let request = 0; request < REPORT_LIMIT; request += 1) {
      expect(
        limiter.consume({
          clientIp: `hot-report-source-${request}`,
          hostname: null,
          reportId: VALID_REPORT_ID,
        }),
      ).toMatchObject({ allowed: true });
    }

    const trackingCountBeforeRejectedReport = limiter.trackedKeyCount;
    expect(
      limiter.consume({
        clientIp: "rejected-report-source",
        hostname: null,
        reportId: VALID_REPORT_ID,
      }),
    ).toMatchObject({ allowed: false });
    expect(limiter.trackedKeyCount).toBe(trackingCountBeforeRejectedReport);

    for (
      let request = 0;
      request < GLOBAL_LIMIT - DOMAIN_LIMIT - REPORT_LIMIT;
      request += 1
    ) {
      expect(
        limiter.consume({
          clientIp: `global-budget-source-${request}`,
          hostname: null,
        }),
      ).toMatchObject({ allowed: true });
    }
    expect(
      limiter.consume({ clientIp: "global-budget-overflow", hostname: null }),
    ).toMatchObject({ allowed: false });
  });

  it("does not allocate origin keys or consume global budget for a capped report", () => {
    const limiter = new PublicScanRateLimiter();

    for (let request = 0; request < REPORT_LIMIT; request += 1) {
      expect(
        limiter.consume({
          clientIp: `report-source-${request}`,
          hostname: null,
          reportId: VALID_REPORT_ID,
        }),
      ).toMatchObject({ allowed: true });
    }
    const trackedKeysAfterAllowedReads = limiter.trackedKeyCount;

    for (let request = 0; request < 1_000; request += 1) {
      expect(
        limiter.consume({
          clientIp: `blocked-source-${request}`,
          hostname: null,
          reportId: VALID_REPORT_ID,
        }),
      ).toMatchObject({ allowed: false });
    }

    expect(limiter.trackedKeyCount).toBe(trackedKeysAfterAllowedReads);
    expect(
      limiter.consume({
        clientIp: "another-source",
        hostname: null,
        reportId: "123e4567-e89b-42d3-a456-426614174001",
      }),
    ).toMatchObject({ allowed: true });
  });

  it("resets a domain quota at the exact window boundary", () => {
    vi.useFakeTimers();
    const limiter = new PublicScanRateLimiter();

    try {
      for (let request = 0; request < DOMAIN_LIMIT; request += 1) {
        expect(
          limiter.consume({
            clientIp: `198.51.100.${request}`,
            hostname: "example.com",
          }),
        ).toMatchObject({ allowed: true });
      }

      expect(
        limiter.consume({ clientIp: "203.0.113.1", hostname: "example.com" }),
      ).toMatchObject({ allowed: false });
      vi.advanceTimersByTime(WINDOW_MS);
      expect(
        limiter.consume({ clientIp: "203.0.113.1", hostname: "example.com" }),
      ).toMatchObject({ allowed: true });
    } finally {
      vi.useRealTimers();
    }
  });

  it("applies a global per-process limit across clients and domains", () => {
    const limiter = new PublicScanRateLimiter();

    for (let request = 0; request < GLOBAL_LIMIT; request += 1) {
      expect(
        limiter.consume({
          clientIp: `203.0.${Math.floor(request / 250)}.${request % 250}`,
          hostname: `site-${request}.example.net`,
        }),
      ).toMatchObject({ allowed: true });
    }

    expect(
      limiter.consume({
        clientIp: "198.51.100.2",
        hostname: "other.example.net",
      }),
    ).toMatchObject({ allowed: false, retryAfterSeconds: 60 });
  });

  it("keeps tracked keys bounded by pruning expired windows", () => {
    vi.useFakeTimers();
    const limiter = new PublicScanRateLimiter();
    try {
      let result = limiter.consume({
        clientIp: "source-0",
        hostname: "site-0.example.net",
      });

      for (let request = 1; request <= 20_000; request += 1) {
        vi.advanceTimersByTime(WINDOW_MS);
        result = limiter.consume({
          clientIp: `source-${request}`,
          hostname: `site-${request}.example.net`,
        });
      }

      expect(result).toMatchObject({ allowed: true });
      expect(limiter.trackedKeyCount).toBeLessThanOrEqual(20_000);
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not allocate keys for requests rejected by a capped domain", () => {
    const limiter = new PublicScanRateLimiter();

    for (let request = 0; request < DOMAIN_LIMIT; request += 1) {
      expect(
        limiter.consume({
          clientIp: `initial-${request}`,
          hostname: "hot.example.net",
        }),
      ).toMatchObject({ allowed: true });
    }

    const trackedKeysAfterAllowedReads = limiter.trackedKeyCount;

    for (
      let request = DOMAIN_LIMIT;
      request < DOMAIN_LIMIT + 1_000;
      request += 1
    ) {
      expect(
        limiter.consume({
          clientIp: `overflow-${request}`,
          hostname: "hot.example.net",
        }),
      ).toMatchObject({
        allowed: false,
        retryAfterSeconds: expect.any(Number),
      });
    }

    expect(limiter.trackedKeyCount).toBe(trackedKeysAfterAllowedReads);
    expect(
      limiter.consume({
        clientIp: "unblocked-origin",
        hostname: "cool.example.net",
      }),
    ).toMatchObject({ allowed: true });
  });
});

describe("PublicScanRateLimitGuard", () => {
  it("forwards only normalized valid report UUIDs to the report bucket", () => {
    const limiter = new PublicScanRateLimiter();
    const consume = vi.spyOn(limiter, "consume");
    const guard = new PublicScanRateLimitGuard(limiter);

    expect(
      guard.canActivate(
        createContext({
          ip: "203.0.113.40",
          params: { reportId: VALID_REPORT_ID.toUpperCase() },
        }),
      ),
    ).toBe(true);
    expect(consume).toHaveBeenLastCalledWith(
      expect.objectContaining({ reportId: VALID_REPORT_ID }),
    );

    expect(
      guard.canActivate(
        createContext({
          ip: "203.0.113.41",
          params: { reportId: "not-a-uuid" },
        }),
      ),
    ).toBe(true);
    expect(consume).toHaveBeenLastCalledWith(
      expect.objectContaining({ reportId: null }),
    );
  });

  it("uses Express's resolved client IP and applies the normalized domain quota", () => {
    const limiter = new PublicScanRateLimiter();
    const guard = new PublicScanRateLimitGuard(limiter);
    const context = createContext({
      ip: "203.0.113.20",
      socket: { remoteAddress: "172.20.0.4" },
      params: { hostname: "EXAMPLE.TEST" },
    });

    expect(guard.canActivate(context)).toBe(true);
    expect(guard.canActivate(context)).toBe(true);
  });

  it("sets Retry-After and rejects once the client budget is exhausted", () => {
    const limiter = new PublicScanRateLimiter();
    const guard = new PublicScanRateLimitGuard(limiter);
    const response = { setHeader: vi.fn() };
    const context = createContext(
      {
        ip: "203.0.113.21",
        socket: { remoteAddress: "203.0.113.21" },
        params: {},
      },
      response,
    );

    for (let request = 0; request < ORIGIN_LIMIT; request += 1) {
      expect(guard.canActivate(context)).toBe(true);
    }

    try {
      guard.canActivate(context);
      throw new Error("expected_rate_limit_rejection");
    } catch (error) {
      expect(error).toBeInstanceOf(HttpException);
      expect((error as HttpException).getStatus()).toBe(429);
    }
    expect(response.setHeader).toHaveBeenCalledWith("Retry-After", "60");
  });
});

function createContext(
  request: Record<string, unknown>,
  response: { setHeader: ReturnType<typeof vi.fn> } = {
    setHeader: vi.fn(),
  },
): ExecutionContext {
  return {
    switchToHttp: () => ({
      getRequest: () => request,
      getResponse: () => response,
    }),
  } as unknown as ExecutionContext;
}
