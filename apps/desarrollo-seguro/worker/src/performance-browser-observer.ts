import { chromium, type Browser, type BrowserContext, type CDPSession, type Page, type Route } from "playwright";
import { isThirdPartyPrivacyHost, normalizeHostname, PRIVACY_BROWSER_BUDGET, scoreScanPerformance } from "@desarrolloseguro/core";
import { PrivacyBrowserRequestGate } from "./privacy-browser-request-gate.js";
import { authorizePrivacyTarget } from "./privacy-egress-policy.js";
import { type LongTaskTiming, type ResourceTiming } from "./performance-timing.js";
import { observeLighthouseMobileProfile } from "./lighthouse-mobile-profile.js";

export const PERFORMANCE_OBSERVATION_DURATION_MS = 120_000;

const PERFORMANCE_OBSERVATION_BUDGET = {
  requests: 1_000,
  receivedBytes: 64 * 1024 * 1024,
  durationMs: PERFORMANCE_OBSERVATION_DURATION_MS,
  contexts: 2,
  desktop: { viewport: { width: 1_365, height: 768 }, settleMs: 2_500 },
} as const;

export type PerformanceProfile = "mobile" | "desktop";
export type PerformanceDiagnosticCode = "observation_budget_exhausted" | "observation_stopped_early" |
  "request_budget_exceeded" | "required_measurement_missing" | "browser_timeout" | "browser_observation_error";
export type PerformanceDiagnosticField = "fcpMs" | "speedIndexMs" | "lcpMs" | "cls" | "tbtMs" |
  "ttfbMs" | "transferBytes" | "score";
export type LighthouseRuntimeFailure = {
  stage: "launch_browser" | "configure_page" | "run_lighthouse" | "read_result";
  errorClass: "timeout" | "target_closed" | "protocol" | "type" | "other";
};
export type PerformanceProfileEvidence = {
  profile: PerformanceProfile;
  status: "complete" | "unknown";
  fcpMs: number | null;
  speedIndexMs: number | null;
  lcpMs: number | null;
  cls: number | null;
  tbtMs: number | null;
  ttfbMs: number | null;
  transferBytes: number | null;
  score: number | null;
  diagnostic?: {
    code: PerformanceDiagnosticCode;
    missingMetrics?: readonly PerformanceDiagnosticField[];
    runtimeFailure?: LighthouseRuntimeFailure;
  };
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
  observeMobileProfile?: typeof observeLighthouseMobileProfile;
  now?: () => number;
};

type CollectedMetrics = {
  fcpMs: number | null;
  speedIndexMs: number | null;
  lcpMs: number | null;
  cls: number | null;
  tbtMs: number | null;
  ttfbMs: number | null;
  transferBytes: number | null;
  tasks: LongTaskTiming[];
  resources: ResourceTiming[];
  observedUntilMs: number;
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
  const observeMobileProfile = options.observeMobileProfile ?? observeLighthouseMobileProfile;
  const timeoutSignal = AbortSignal.timeout(PERFORMANCE_OBSERVATION_BUDGET.durationMs);
  const signal = options.signal ? AbortSignal.any([options.signal, timeoutSignal]) : timeoutSignal;
  let browser: Browser | undefined;
  let totalTransferBytes = 0;

  try {
    const mobile = await observeMobileProfile({
      targetUrl: options.targetUrl,
      proxyUrl: options.proxyUrl,
      requestGate: gate,
      signal,
    });
    totalTransferBytes += mobile.transferBytes ?? 0;

    browser = await launch({
      headless: true,
      proxy: { server: options.proxyUrl, bypass: "<-loopback>" },
      args: ["--disable-background-networking", "--disable-component-update", "--disable-sync", "--no-first-run", "--disable-dev-shm-usage"],
    });

    const desktop = await collectDesktopProfile(browser, options.targetUrl, gate, signal, () => remainingBudget(now, startedAt), (bytes) => {
      totalTransferBytes += bytes;
      return totalTransferBytes <= PERFORMANCE_OBSERVATION_BUDGET.receivedBytes;
    });
    return { profiles: [mobile, desktop] };
  } finally {
    await browser?.close().catch(() => undefined);
  }
}

async function collectDesktopProfile(
  browser: Browser,
  targetUrl: string,
  gate: PrivacyBrowserRequestGate,
  signal: AbortSignal,
  remainingMs: () => number,
  accountTransferBytes: (bytes: number) => boolean,
): Promise<PerformanceProfileEvidence> {
  let context: BrowserContext | undefined;
  let cdp: CDPSession | undefined;
  try {
    context = await browser.newContext({
      viewport: PERFORMANCE_OBSERVATION_BUDGET.desktop.viewport,
      isMobile: false,
      hasTouch: false,
      serviceWorkers: "block",
      acceptDownloads: false,
    });
    await context.route("**/*", (route) => handleRequestRoute(route, gate));
    await context.routeWebSocket("**/*", (route) => route.close({ code: 1000, reason: "blocked" }));

    const page = await context.newPage();
    await page.addInitScript(installPerformanceObservers, { captureResources: false });
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
    const navigationTimeout = boundedTimeout(remainingMs());
    if (signal.aborted || navigationTimeout === null) {
      return unknownEvidence("desktop", { code: "observation_budget_exhausted" });
    }
    await page.goto(targetUrl, { waitUntil: "domcontentloaded", timeout: navigationTimeout });
    const idleTimeout = boundedTimeout(Math.min(15_000, remainingMs()));
    if (signal.aborted || idleTimeout === null) {
      return unknownEvidence("desktop", { code: "observation_budget_exhausted" });
    }
    try {
      await page.waitForLoadState("networkidle", { timeout: idleTimeout });
    } catch (error) {
      if (!(error instanceof Error && error.name === "TimeoutError")) throw error;
      if (signal.aborted) {
        return unknownEvidence("desktop", { code: "observation_budget_exhausted" });
      }
    }
    const settleMs = PERFORMANCE_OBSERVATION_BUDGET.desktop.settleMs;
    const settleTimeout = boundedTimeout(Math.min(settleMs, remainingMs()));
    if (signal.aborted || settleTimeout === null || transferBudgetExceeded) {
      return unknownEvidence("desktop", {
        code: signal.aborted ? "observation_budget_exhausted" : "observation_stopped_early",
      });
    }
    await page.waitForTimeout(settleTimeout);
    if (signal.aborted || gate.hasExceededBudget() || transferBudgetExceeded) {
      return unknownEvidence("desktop", {
        code: signal.aborted ? "observation_budget_exhausted" : "request_budget_exceeded",
      });
    }
    const metrics = await readCollectedMetrics(page);
    metrics.tbtMs = sumBlockingTime(metrics.tasks);
    metrics.transferBytes = transferEvents > 0 ? transferBytes : null;
    const completed = transferEvents > 0 && hasAllMetrics(metrics);
    const score = completed ? scoreScanPerformance(metrics)?.score ?? null : null;
    if (!completed || score === null) {
      const requiredMetrics: Array<keyof Pick<CollectedMetrics,
        "fcpMs" | "lcpMs" | "cls" | "tbtMs" | "ttfbMs">> = [
          "fcpMs", "lcpMs", "cls", "tbtMs", "ttfbMs",
        ];
      const missingMetrics: PerformanceDiagnosticField[] = requiredMetrics.filter((key) => {
        const value = metrics[key];
        return typeof value !== "number" || !Number.isFinite(value) || value < 0;
      });
      if (transferEvents === 0) missingMetrics.push("transferBytes");
      if (score === null) missingMetrics.push("score");
      const incompleteDiagnostic = { code: "required_measurement_missing" as const, missingMetrics };
      return unknownEvidence("desktop", incompleteDiagnostic, metrics);
    }
    const profileMetrics: Omit<CollectedMetrics, "tasks" | "resources" | "observedUntilMs"> = {
      fcpMs: metrics.fcpMs,
      speedIndexMs: metrics.speedIndexMs,
      lcpMs: metrics.lcpMs,
      cls: metrics.cls,
      tbtMs: metrics.tbtMs,
      ttfbMs: metrics.ttfbMs,
      transferBytes: metrics.transferBytes,
    };
    return {
      profile: "desktop",
      status: completed && score !== null ? "complete" : "unknown",
      ...profileMetrics,
      transferBytes: transferEvents > 0 ? transferBytes : null,
      score: completed ? score : null,
    };
  } catch (error) {
    return unknownEvidence("desktop", {
      code: error instanceof Error && error.name === "TimeoutError" ? "browser_timeout" : "browser_observation_error",
    });
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
      tasks: LongTaskTiming[];
      resources: ResourceTiming[];
    } }).__dsPerformanceMetrics;
    const navigation = performance.getEntriesByType("navigation")[0] as PerformanceNavigationTiming | undefined;
    const resources = captured?.resources ?? [];
    if (navigation) resources.unshift({ startTime: navigation.startTime, responseEnd: navigation.responseEnd });
    return {
      fcpMs: captured?.fcpMs ?? null,
      lcpMs: captured?.lcpMs ?? null,
      cls: captured?.cls ?? null,
      tbtMs: null,
      speedIndexMs: null,
      tasks: captured?.tasks ?? [],
      resources,
      observedUntilMs: performance.now(),
      ttfbMs: navigation && navigation.responseStart > 0 ? Math.round(navigation.responseStart) : null,
      transferBytes: null,
    };
  });
}

function installPerformanceObservers(options: { captureResources: boolean }): void {
  const metrics = {
    fcpMs: null as number | null,
    lcpMs: null as number | null,
    cls: 0,
    tasks: [] as LongTaskTiming[],
    resources: [] as ResourceTiming[],
  };
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
      for (const entry of list.getEntries()) metrics.tasks.push({ startTime: entry.startTime, duration: entry.duration });
    }).observe({ type: "longtask", buffered: true });
    if (options.captureResources) {
      new PerformanceObserver((list) => {
        for (const entry of list.getEntries() as PerformanceResourceTiming[]) {
          metrics.resources.push({
            startTime: entry.startTime,
            responseEnd: entry.responseEnd > 0 ? entry.responseEnd : performance.now(),
          });
        }
      }).observe({ type: "resource", buffered: true });
    }
  } catch {
    metrics.fcpMs = null;
    metrics.lcpMs = null;
    metrics.cls = Number.NaN;
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

function sumBlockingTime(tasks: readonly LongTaskTiming[]): number {
  return tasks.reduce((total, task) => total + Math.max(0, Math.round(task.duration - 50)), 0);
}

const DEFAULT_BROWSER_OBSERVATION_DIAGNOSTIC: NonNullable<PerformanceProfileEvidence["diagnostic"]> = {
  code: "browser_observation_error",
};

function unknownEvidence(
  profile: PerformanceProfile,
  diagnostic: NonNullable<PerformanceProfileEvidence["diagnostic"]> = DEFAULT_BROWSER_OBSERVATION_DIAGNOSTIC,
  metrics?: Pick<CollectedMetrics, "fcpMs" | "speedIndexMs" | "lcpMs" | "cls" | "tbtMs" | "ttfbMs" | "transferBytes">,
): PerformanceProfileEvidence {
  return {
    profile,
    status: "unknown",
    fcpMs: metrics?.fcpMs ?? null,
    speedIndexMs: metrics?.speedIndexMs ?? null,
    lcpMs: metrics?.lcpMs ?? null,
    cls: metrics?.cls ?? null,
    tbtMs: metrics?.tbtMs ?? null,
    ttfbMs: metrics?.ttfbMs ?? null,
    transferBytes: metrics?.transferBytes ?? null,
    score: null,
    diagnostic,
  };
}
