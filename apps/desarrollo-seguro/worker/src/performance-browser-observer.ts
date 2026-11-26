import { chromium, type Browser, type BrowserContext, type CDPSession, type Page, type Route } from "playwright";
import { isThirdPartyPrivacyHost, normalizeHostname, PRIVACY_BROWSER_BUDGET, scoreScanPerformance } from "@desarrolloseguro/core";
import { PrivacyBrowserRequestGate } from "./privacy-browser-request-gate.js";
import { authorizePrivacyTarget } from "./privacy-egress-policy.js";

const PERFORMANCE_OBSERVATION_BUDGET = {
  requests: 1_000,
  receivedBytes: 64 * 1024 * 1024,
  durationMs: 120_000,
  contexts: 2,
  settleMs: 2_500,
  mobile: {
    viewport: { width: 375, height: 812 },
    cpuThrottleRate: 4,
    latencyMs: 150,
    downloadThroughput: Math.floor(1_600_000 / 8),
    uploadThroughput: Math.floor(750_000 / 8),
  },
  desktop: { viewport: { width: 1_365, height: 768 } },
} as const;

export type PerformanceProfile = "mobile" | "desktop";
export type PerformanceProfileEvidence = {
  profile: PerformanceProfile;
  status: "complete" | "unknown";
  fcpMs: number | null;
  lcpMs: number | null;
  cls: number | null;
  tbtMs: number | null;
  ttfbMs: number | null;
  transferBytes: number | null;
  score: number | null;
};

export type PerformanceBrowserEvidence = {
  profiles: readonly [PerformanceProfileEvidence, PerformanceProfileEvidence];
};

export type PerformanceBrowserObserverOptions = {
  targetUrl: string;
  hostname: string;
  proxyUrl: string;
  signal?: AbortSignal;
  launchBrowser?: typeof chromium.launch;
  now?: () => number;
};

type CollectedMetrics = {
  fcpMs: number | null;
  lcpMs: number | null;
  cls: number | null;
  tbtMs: number | null;
  ttfbMs: number | null;
  transferBytes: number | null;
};

/** Collects bounded, numeric-only performance evidence in two fresh Chromium contexts. */
export async function observePagePerformance(
  options: PerformanceBrowserObserverOptions,
): Promise<PerformanceBrowserEvidence> {
  const hostname = normalizeHostname(options.hostname);
  let target;
  try {
    target = authorizePrivacyTarget(options.targetUrl);
  } catch {
    throw new Error("performance_browser_target_invalid");
  }
  if (target.url.protocol !== "https:" || target.hostname !== hostname) {
    throw new Error("performance_browser_target_invalid");
  }
  if (typeof options.proxyUrl !== "string" || !options.proxyUrl.startsWith("http://")) {
    throw new Error("performance_browser_proxy_invalid");
  }

  const gate = new PrivacyBrowserRequestGate({
    requestedHostname: hostname,
    isThirdPartyHost: isThirdPartyPrivacyHost,
    maxRequests: PERFORMANCE_OBSERVATION_BUDGET.requests,
  });
  const now = options.now ?? Date.now;
  const startedAt = now();
  const launch = options.launchBrowser ?? chromium.launch.bind(chromium);
  const timeoutSignal = AbortSignal.timeout(PERFORMANCE_OBSERVATION_BUDGET.durationMs);
  const signal = options.signal ? AbortSignal.any([options.signal, timeoutSignal]) : timeoutSignal;
  let browser: Browser | undefined;
  let totalTransferBytes = 0;

  try {
    browser = await launch({
      headless: true,
      proxy: { server: options.proxyUrl, bypass: "<-loopback>" },
      args: ["--disable-background-networking", "--disable-component-update", "--disable-sync", "--no-first-run", "--disable-dev-shm-usage"],
    });

    const mobile = await collectProfile(browser, "mobile", options.targetUrl, gate, signal, () => remainingBudget(now, startedAt), (bytes) => {
      totalTransferBytes += bytes;
      return totalTransferBytes <= PERFORMANCE_OBSERVATION_BUDGET.receivedBytes;
    });
    const desktop = await collectProfile(browser, "desktop", options.targetUrl, gate, signal, () => remainingBudget(now, startedAt), (bytes) => {
      totalTransferBytes += bytes;
      return totalTransferBytes <= PERFORMANCE_OBSERVATION_BUDGET.receivedBytes;
    });
    return { profiles: [mobile, desktop] };
  } finally {
    await browser?.close().catch(() => undefined);
  }
}

async function collectProfile(
  browser: Browser,
  profile: PerformanceProfile,
  targetUrl: string,
  gate: PrivacyBrowserRequestGate,
  signal: AbortSignal,
  remainingMs: () => number,
  accountTransferBytes: (bytes: number) => boolean,
): Promise<PerformanceProfileEvidence> {
  let context: BrowserContext | undefined;
  let cdp: CDPSession | undefined;
  try {
    const mobile = profile === "mobile";
    context = await browser.newContext({
      viewport: mobile ? PERFORMANCE_OBSERVATION_BUDGET.mobile.viewport : PERFORMANCE_OBSERVATION_BUDGET.desktop.viewport,
      isMobile: mobile,
      hasTouch: mobile,
      serviceWorkers: "block",
      acceptDownloads: false,
    });
    await context.route("**/*", (route) => handleRequestRoute(route, gate));
    await context.routeWebSocket("**/*", (route) => route.close({ code: 1000, reason: "blocked" }));

    const page = await context.newPage();
    await page.addInitScript(installPerformanceObservers);
    cdp = await context.newCDPSession(page);
    let transferBytes = 0;
    let transferEvents = 0;
    let transferBudgetExceeded = false;
    cdp.on("Network.loadingFinished", (event: { encodedDataLength?: number }) => {
      if (typeof event.encodedDataLength === "number" && Number.isFinite(event.encodedDataLength) && event.encodedDataLength >= 0) {
        transferBytes += event.encodedDataLength;
        transferEvents += 1;
        if (!accountTransferBytes(event.encodedDataLength)) {
          transferBudgetExceeded = true;
          void context?.close().catch(() => undefined);
        }
      }
    });
    await cdp.send("Network.enable");
    if (mobile) {
      await cdp.send("Emulation.setCPUThrottlingRate", { rate: PERFORMANCE_OBSERVATION_BUDGET.mobile.cpuThrottleRate });
      await cdp.send("Network.emulateNetworkConditions", {
        offline: false,
        latency: PERFORMANCE_OBSERVATION_BUDGET.mobile.latencyMs,
        downloadThroughput: PERFORMANCE_OBSERVATION_BUDGET.mobile.downloadThroughput,
        uploadThroughput: PERFORMANCE_OBSERVATION_BUDGET.mobile.uploadThroughput,
        connectionType: "cellular3g",
      });
    }

    const navigationTimeout = boundedTimeout(remainingMs());
    if (signal.aborted || navigationTimeout === null) return unknownEvidence(profile);
    await page.goto(targetUrl, { waitUntil: "domcontentloaded", timeout: navigationTimeout });
    const idleTimeout = boundedTimeout(Math.min(15_000, remainingMs()));
    if (signal.aborted || idleTimeout === null) return unknownEvidence(profile);
    await page.waitForLoadState("networkidle", { timeout: idleTimeout });
    const settleTimeout = boundedTimeout(Math.min(PERFORMANCE_OBSERVATION_BUDGET.settleMs, remainingMs()));
    if (signal.aborted || settleTimeout === null || transferBudgetExceeded) return unknownEvidence(profile);
    await page.waitForTimeout(settleTimeout);
    if (signal.aborted || gate.hasExceededBudget() || transferBudgetExceeded) return unknownEvidence(profile);

    const metrics = await readCollectedMetrics(page);
    metrics.transferBytes = transferEvents > 0 ? transferBytes : null;
    const completed = transferEvents > 0 && hasAllMetrics(metrics);
    const score = completed ? scoreScanPerformance(metrics)?.score ?? null : null;
    return {
      profile,
      status: completed && score !== null ? "complete" : "unknown",
      ...metrics,
      transferBytes: transferEvents > 0 ? transferBytes : null,
      score: completed ? score : null,
    };
  } catch {
    return unknownEvidence(profile);
  } finally {
    await cdp?.detach().catch(() => undefined);
    await context?.close().catch(() => undefined);
  }
}

async function handleRequestRoute(route: Route, gate: PrivacyBrowserRequestGate): Promise<void> {
  const request = route.request();
  const decision = gate.inspect(request.url(), request.method());
  if (!decision.allowed) {
    await route.abort("blockedbyclient").catch(() => undefined);
    return;
  }
  await route.continue().catch(() => undefined);
}

async function readCollectedMetrics(page: Page): Promise<CollectedMetrics> {
  return page.evaluate(() => {
    const captured = (window as Window & { __dsPerformanceMetrics?: {
      fcpMs: number | null;
      lcpMs: number | null;
      cls: number;
      tbtMs: number;
    } }).__dsPerformanceMetrics;
    const navigation = performance.getEntriesByType("navigation")[0] as PerformanceNavigationTiming | undefined;
    return {
      fcpMs: captured?.fcpMs ?? null,
      lcpMs: captured?.lcpMs ?? null,
      cls: captured?.cls ?? null,
      tbtMs: captured?.tbtMs ?? null,
      ttfbMs: navigation && navigation.responseStart > 0 ? Math.round(navigation.responseStart) : null,
      transferBytes: null,
    };
  });
}

function installPerformanceObservers(): void {
  const metrics = { fcpMs: null as number | null, lcpMs: null as number | null, cls: 0, tbtMs: 0 };
  (window as Window & { __dsPerformanceMetrics?: typeof metrics }).__dsPerformanceMetrics = metrics;
  try {
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        if (entry.name === "first-contentful-paint") metrics.fcpMs = Math.round(entry.startTime);
      }
    }).observe({ type: "paint", buffered: true });
    new PerformanceObserver((list) => {
      const entries = list.getEntries();
      const latest = entries.at(-1);
      if (latest) metrics.lcpMs = Math.round(latest.startTime);
    }).observe({ type: "largest-contentful-paint", buffered: true });
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries() as PerformanceEntry[] & Array<{ value?: number; hadRecentInput?: boolean }>) {
        if (!entry.hadRecentInput && typeof entry.value === "number") metrics.cls = Math.round((metrics.cls + entry.value) * 10_000) / 10_000;
      }
    }).observe({ type: "layout-shift", buffered: true } as PerformanceObserverInit);
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) metrics.tbtMs += Math.max(0, Math.round(entry.duration - 50));
    }).observe({ type: "longtask", buffered: true });
  } catch {
    metrics.fcpMs = null;
    metrics.lcpMs = null;
    metrics.cls = Number.NaN;
    metrics.tbtMs = Number.NaN;
  }
}

function remainingBudget(now: () => number, startedAt: number): number {
  const limit = Math.min(PERFORMANCE_OBSERVATION_BUDGET.durationMs, PRIVACY_BROWSER_BUDGET.durationMs);
  return Math.max(0, limit - (now() - startedAt));
}

function boundedTimeout(value: number): number | null {
  return Number.isFinite(value) && value > 0 ? Math.max(1, Math.floor(value)) : null;
}

function hasAllMetrics(metrics: CollectedMetrics): boolean {
  return [metrics.fcpMs, metrics.lcpMs, metrics.cls, metrics.tbtMs, metrics.ttfbMs].every(
    (value) => typeof value === "number" && Number.isFinite(value) && value >= 0,
  );
}

function unknownEvidence(profile: PerformanceProfile): PerformanceProfileEvidence {
  return {
    profile,
    status: "unknown",
    fcpMs: null,
    lcpMs: null,
    cls: null,
    tbtMs: null,
    ttfbMs: null,
    transferBytes: null,
    score: null,
  };
}
