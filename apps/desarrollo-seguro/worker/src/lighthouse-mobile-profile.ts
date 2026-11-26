import { chromium as playwrightChromium } from "playwright";
import puppeteer, { type Browser as PuppeteerBrowser, type Page as PuppeteerPage } from "puppeteer-core";
import lighthouse from "lighthouse";
import type { PrivacyBrowserRequestGate } from "./privacy-browser-request-gate.js";
import type { LighthouseRuntimeFailure, PerformanceDiagnosticField, PerformanceProfileEvidence } from "./performance-browser-observer.js";

const CHROME_FLAGS = [
  "--no-sandbox",
  "--disable-background-networking",
  "--disable-component-update",
  "--disable-sync",
  "--no-first-run",
  "--disable-dev-shm-usage",
];

export type LighthouseMobileProfileOptions = {
  targetUrl: string;
  proxyUrl: string;
  requestGate: PrivacyBrowserRequestGate;
  signal: AbortSignal;
  launchBrowser?: typeof puppeteer.launch;
  runLighthouse?: typeof lighthouse;
};

type LighthouseAuditResult = { numericValue?: number };
type LighthouseResultShape = {
  audits?: Record<string, LighthouseAuditResult & { details?: { items?: Array<Record<string, unknown>> } }>;
  categories?: { performance?: { score?: number | null } };
};

/** Runs the official Lighthouse mobile simulator while retaining the auditor's request gate and proxy. */
export async function observeLighthouseMobileProfile(
  options: LighthouseMobileProfileOptions,
): Promise<PerformanceProfileEvidence> {
  const launchBrowser = options.launchBrowser ?? puppeteer.launch.bind(puppeteer);
  const runLighthouse = options.runLighthouse ?? lighthouse;
  let browser: PuppeteerBrowser | undefined;
  let page: PuppeteerPage | undefined;
  let cdp: Awaited<ReturnType<ReturnType<PuppeteerPage["target"]>["createCDPSession"]>> | undefined;
  let timedOut = false;
  let stage: LighthouseRuntimeFailure["stage"] = "launch_browser";
  const closeBrowser = () => {
    timedOut = true;
    void browser?.close().catch(() => undefined);
  };

  try {
    if (options.signal.aborted) return incompleteProfile({ code: "observation_budget_exhausted" });
    browser = await launchBrowser({
      headless: true,
      executablePath: playwrightChromium.executablePath(),
      args: [
        ...CHROME_FLAGS,
        `--proxy-server=${options.proxyUrl}`,
        "--proxy-bypass-list=<-loopback>",
      ],
    });
    if (options.signal.aborted) return incompleteProfile({ code: "observation_budget_exhausted" });

    stage = "configure_page";
    page = await browser.newPage();
    await page.setBypassServiceWorker(true);
    await page.setRequestInterception(true);
    page.on("request", (request) => {
      const decision = options.requestGate.inspect(request.url(), request.method());
      if (request.resourceType() === "websocket" || !decision.allowed) {
        void request.abort("blockedbyclient").catch(() => undefined);
      } else {
        void request.continue().catch(() => undefined);
      }
    });
    cdp = await page.target().createCDPSession();
    await cdp.send("Network.enable");
    await cdp.send("Network.setBlockedURLs", { urls: ["ws://*", "wss://*"] });

    options.signal.addEventListener("abort", closeBrowser, { once: true });
    stage = "run_lighthouse";
    const result = await runLighthouse(options.targetUrl, {
      logLevel: "silent",
      output: "json",
      onlyCategories: ["performance"],
      formFactor: "mobile",
      throttlingMethod: "simulate",
      maxWaitForFcp: 30_000,
      maxWaitForLoad: 45_000,
      pauseAfterFcpMs: 1_000,
      pauseAfterLoadMs: 1_000,
      networkQuietThresholdMs: 1_000,
      cpuQuietThresholdMs: 1_000,
    }, undefined, page);
    if (options.signal.aborted || timedOut || options.requestGate.hasExceededBudget()) {
      return incompleteProfile({
        code: options.signal.aborted || timedOut ? "observation_budget_exhausted" : "request_budget_exceeded",
      });
    }
    if (!result?.lhr) return incompleteProfile({ code: "required_measurement_missing" });
    stage = "read_result";
    return extractMobileProfile(result.lhr as unknown as LighthouseResultShape);
  } catch (error) {
    const runtimeFailure = { stage, errorClass: classifyError(error) } satisfies LighthouseRuntimeFailure;
    process.stderr.write(`${JSON.stringify({
      type: "lighthouse_mobile_runtime_error",
      ...runtimeFailure,
    })}\n`);
    return incompleteProfile({
      code: options.signal.aborted || timedOut || error instanceof Error && error.name === "TimeoutError"
        ? "browser_timeout"
        : "browser_observation_error",
      runtimeFailure,
    });
  } finally {
    options.signal.removeEventListener("abort", closeBrowser);
    await cdp?.detach().catch(() => undefined);
    await browser?.close().catch(() => undefined);
  }
}

function classifyError(error: unknown): "timeout" | "target_closed" | "protocol" | "type" | "other" {
  if (!(error instanceof Error)) return "other";
  if (error.name === "TimeoutError") return "timeout";
  if (error.name === "TargetCloseError") return "target_closed";
  if (error.name === "ProtocolError") return "protocol";
  if (error instanceof TypeError) return "type";
  return "other";
}

function extractMobileProfile(result: LighthouseResultShape): PerformanceProfileEvidence {
  const audits = result.audits ?? {};
  const values = {
    fcpMs: numericValue(audits["first-contentful-paint"]),
    speedIndexMs: numericValue(audits["speed-index"]),
    lcpMs: numericValue(audits["largest-contentful-paint"]),
    cls: numericValue(audits["cumulative-layout-shift"], false),
    tbtMs: numericValue(audits["total-blocking-time"]),
    ttfbMs: metricNumber(audits.metrics, "timeToFirstByte"),
    transferBytes: numericValue(audits["total-byte-weight"]),
  };
  const score = result.categories?.performance?.score;
  const missingMetrics: PerformanceDiagnosticField[] = (Object.entries(values) as Array<[keyof typeof values, number | null]>)
    .filter(([, value]) => value === null)
    .map(([key]) => key);
  if (typeof score !== "number" || !Number.isFinite(score)) missingMetrics.push("score");
  if (missingMetrics.length > 0) {
    return {
      profile: "mobile",
      status: "unknown",
      ...values,
      score: null,
      diagnostic: { code: "required_measurement_missing", missingMetrics },
    };
  }
  return {
    profile: "mobile",
    status: "complete",
    ...values,
    score: Math.round(score! * 100),
  };
}

function numericValue(audit: LighthouseAuditResult | undefined, round = true): number | null {
  const value = audit?.numericValue;
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? (round ? Math.round(value) : value) : null;
}

function metricNumber(audit: LighthouseAuditResult & { details?: { items?: Array<Record<string, unknown>> } } | undefined, key: string): number | null {
  const value = audit?.details?.items?.[0]?.[key];
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? Math.round(value) : null;
}

function incompleteProfile(
  diagnostic: NonNullable<PerformanceProfileEvidence["diagnostic"]>,
): PerformanceProfileEvidence {
  return {
    profile: "mobile",
    status: "unknown",
    fcpMs: null,
    speedIndexMs: null,
    lcpMs: null,
    cls: null,
    tbtMs: null,
    ttfbMs: null,
    transferBytes: null,
    score: null,
    diagnostic,
  };
}
