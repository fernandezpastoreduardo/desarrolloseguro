import { Injectable } from "@nestjs/common";
import { REPORT_ID_PATTERN } from "./public-scan.constants.js";

const WINDOW_MS = 60_000;
const ORIGIN_LIMIT = 60;
const DOMAIN_LIMIT = 120;
const REPORT_LIMIT = 120;
const GLOBAL_LIMIT = 300;
const MAX_TRACKED_KEYS_PER_BUCKET = 10_000;
const RATE_LIMIT_WINDOW_EXCEEDED = "rate_limit_window_exceeded";
const RATE_LIMIT_CAPACITY_REACHED = "rate_limit_capacity_reached";

type RateWindow = {
  startedAt: number;
  count: number;
};

type WindowDecision = {
  allowed: boolean;
  window: RateWindow;
  retryAfterSeconds?: number;
};

type RateLimitDecision =
  | { allowed: true }
  | {
      allowed: false;
      kind: typeof RATE_LIMIT_WINDOW_EXCEEDED;
      retryAfterSeconds: number;
    }
  | { allowed: false; kind: typeof RATE_LIMIT_CAPACITY_REACHED };

type PublicScanRateLimitInput = {
  clientIp: string;
  hostname: string | null;
  reportId?: string | null;
};

@Injectable()
export class PublicScanRateLimiter {
  private readonly originWindows = new Map<string, RateWindow>();
  private readonly domainWindows = new Map<string, RateWindow>();
  private readonly reportWindows = new Map<string, RateWindow>();
  private globalWindow: RateWindow = { startedAt: Date.now(), count: 0 };

  get trackedKeyCount(): number {
    return (
      this.originWindows.size +
      this.domainWindows.size +
      this.reportWindows.size
    );
  }

  consume(input: PublicScanRateLimitInput): RateLimitDecision {
    const now = Date.now();
    const globalDecision = consumeWindow(this.globalWindow, now, GLOBAL_LIMIT);
    if (!globalDecision.allowed) {
      return toWindowLimitDecision(globalDecision);
    }

    const originDecision = consumeWindow(
      this.originWindows.get(input.clientIp),
      now,
      ORIGIN_LIMIT,
    );
    if (!originDecision.allowed) return toWindowLimitDecision(originDecision);

    let domainKey: string | null = null;
    let domainDecision: WindowDecision | null = null;
    if (input.hostname !== null) {
      domainKey = input.hostname;
      domainDecision = consumeWindow(
        this.domainWindows.get(domainKey),
        now,
        DOMAIN_LIMIT,
      );
      if (!domainDecision.allowed) return toWindowLimitDecision(domainDecision);
    }

    const reportId = normalizeReportId(input.reportId);
    let reportDecision: WindowDecision | null = null;
    if (reportId !== null) {
      reportDecision = consumeWindow(
        this.reportWindows.get(reportId),
        now,
        REPORT_LIMIT,
      );
      if (!reportDecision.allowed) return toWindowLimitDecision(reportDecision);
    }

    if (!hasTrackingCapacity(this.originWindows, input.clientIp, now)) {
      return { allowed: false, kind: RATE_LIMIT_CAPACITY_REACHED };
    }
    if (
      domainKey !== null &&
      !hasTrackingCapacity(this.domainWindows, domainKey, now)
    ) {
      return { allowed: false, kind: RATE_LIMIT_CAPACITY_REACHED };
    }
    if (
      reportId !== null &&
      !hasTrackingCapacity(this.reportWindows, reportId, now)
    ) {
      return { allowed: false, kind: RATE_LIMIT_CAPACITY_REACHED };
    }

    commitMapWindow(
      this.originWindows,
      input.clientIp,
      originDecision.window,
      now,
    );
    if (domainKey !== null && domainDecision !== null) {
      commitMapWindow(
        this.domainWindows,
        domainKey,
        domainDecision.window,
        now,
      );
    }
    if (reportId !== null && reportDecision !== null) {
      commitMapWindow(this.reportWindows, reportId, reportDecision.window, now);
    }
    this.globalWindow = globalDecision.window;
    return { allowed: true };
  }
}

function normalizeReportId(value: string | null | undefined): string | null {
  return typeof value === "string" && REPORT_ID_PATTERN.test(value)
    ? value.toLowerCase()
    : null;
}

function toWindowLimitDecision(decision: WindowDecision): RateLimitDecision {
  return {
    allowed: false,
    kind: RATE_LIMIT_WINDOW_EXCEEDED,
    retryAfterSeconds: decision.retryAfterSeconds ?? 1,
  };
}

function hasTrackingCapacity(
  windows: Map<string, RateWindow>,
  key: string,
  now: number,
): boolean {
  if (windows.has(key) || windows.size < MAX_TRACKED_KEYS_PER_BUCKET) {
    return true;
  }
  let liveKeyCount = 0;
  for (const window of windows.values()) {
    if (now - window.startedAt < WINDOW_MS) liveKeyCount += 1;
  }
  return liveKeyCount < MAX_TRACKED_KEYS_PER_BUCKET;
}

function commitMapWindow(
  windows: Map<string, RateWindow>,
  key: string,
  window: RateWindow,
  now: number,
): void {
  if (!windows.has(key) && windows.size >= MAX_TRACKED_KEYS_PER_BUCKET) {
    pruneExpiredWindows(windows, now);
  }
  windows.set(key, window);
}

function consumeWindow(
  current: RateWindow | undefined,
  now: number,
  limit: number,
): WindowDecision {
  const window =
    current === undefined || now - current.startedAt >= WINDOW_MS
      ? { startedAt: now, count: 0 }
      : current;

  if (window.count >= limit) {
    return {
      allowed: false,
      retryAfterSeconds: Math.max(
        1,
        Math.ceil((window.startedAt + WINDOW_MS - now) / 1000),
      ),
      window,
    };
  }

  return { allowed: true, window: { ...window, count: window.count + 1 } };
}

function pruneExpiredWindows(
  windows: Map<string, RateWindow>,
  now: number,
): void {
  for (const [key, window] of windows) {
    if (now - window.startedAt >= WINDOW_MS) windows.delete(key);
  }
}

export const publicScanRateLimitErrors = {
  capacityReached: RATE_LIMIT_CAPACITY_REACHED,
  windowExceeded: RATE_LIMIT_WINDOW_EXCEEDED,
} as const;
