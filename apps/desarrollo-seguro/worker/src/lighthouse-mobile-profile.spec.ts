import { describe, expect, it, vi } from "vitest";
import { chromium as playwrightChromium } from "playwright";
import { PrivacyBrowserRequestGate } from "./privacy-browser-request-gate.js";
import { observeLighthouseMobileProfile, resolveLighthouseHeadlessShellPath } from "./lighthouse-mobile-profile.js";

describe("observeLighthouseMobileProfile", () => {
  it("runs Lighthouse simulate through the safe proxy and retains only numeric evidence", async () => {
    let requestHandler: ((request: never) => void) | undefined;
    const abort = vi.fn(async () => undefined);
    const proceed = vi.fn(async () => undefined);
    const cdp = { send: vi.fn(async () => undefined), detach: vi.fn(async () => undefined) };
    const page = {
      setBypassServiceWorker: vi.fn(async () => undefined),
      setRequestInterception: vi.fn(async () => undefined),
      on: vi.fn((event: string, handler: (request: never) => void) => {
        if (event === "request") requestHandler = handler;
      }),
      target: () => ({ createCDPSession: async () => cdp }),
    };
    const browser = { newPage: vi.fn(async () => page), close: vi.fn(async () => undefined) };
    const launchBrowser = vi.fn(async () => browser);
    const runLighthouse = vi.fn(async () => ({
      lhr: {
        categories: { performance: { score: 0.97 } },
        audits: {
          "first-contentful-paint": { numericValue: 1_372.2 },
          "speed-index": { numericValue: 1_372.2 },
          "largest-contentful-paint": { numericValue: 2_422.3 },
          "cumulative-layout-shift": { numericValue: 0.001448 },
          "total-blocking-time": { numericValue: 0 },
          "total-byte-weight": { numericValue: 349_416 },
          metrics: { details: { items: [{ timeToFirstByte: 622 }] } },
        },
      },
    }));
    const requestGate = new PrivacyBrowserRequestGate({
      requestedHostname: "example.com",
      isThirdPartyHost: (requested, observed) => requested !== observed,
      maxRequests: 1_000,
    });
    const options = {
      targetUrl: "https://example.com/careers?source=lab",
      proxyUrl: "http://privacy-egress:3128",
      requestGate,
      signal: new AbortController().signal,
      launchBrowser: launchBrowser as never,
      runLighthouse: runLighthouse as never,
    };

    const result = await observeLighthouseMobileProfile(options);
    expect(result).toMatchObject({
      profile: "mobile",
      status: "complete",
      fcpMs: 1_372,
      speedIndexMs: 1_372,
      lcpMs: 2_422,
      cls: 0.001448,
      tbtMs: 0,
      ttfbMs: 622,
      transferBytes: 349_416,
      score: 97,
    });
    expect(JSON.stringify(result)).not.toContain("example.com");
    expect(launchBrowser).toHaveBeenCalledWith(expect.objectContaining({
      executablePath: resolveLighthouseHeadlessShellPath(playwrightChromium.executablePath()),
      args: expect.arrayContaining([
        "--no-sandbox",
        "--disable-breakpad",
        "--proxy-server=http://privacy-egress:3128",
        "--proxy-bypass-list=<-loopback>",
      ]),
    }));
    expect(runLighthouse).toHaveBeenCalledWith(options.targetUrl, expect.objectContaining({
      formFactor: "mobile",
      throttlingMethod: "simulate",
      onlyCategories: ["performance"],
      logLevel: "silent",
    }), undefined, page);

    const continueRequest = { url: () => "https://example.com/app.js", method: () => "GET", resourceType: () => "script", abort, continue: proceed };
    const postRequest = { url: () => "https://example.com/submit", method: () => "POST", resourceType: () => "fetch", abort, continue: proceed };
    requestHandler?.(continueRequest as never);
    requestHandler?.(postRequest as never);
    await Promise.resolve();
    expect(proceed).toHaveBeenCalledOnce();
    expect(abort).toHaveBeenCalledOnce();
    expect(cdp.send).toHaveBeenCalledWith("Network.setBlockedURLs", { urls: ["ws://*", "wss://*"] });
    expect(cdp.detach).toHaveBeenCalledOnce();
    expect(browser.close).toHaveBeenCalledOnce();
  });

  it("resolves the headless-shell executable that matches Playwright's Chromium revision and architecture", () => {
    expect(resolveLighthouseHeadlessShellPath("/ms-playwright/chromium-1254/chrome-linux64/chrome", "x64", "linux"))
      .toBe("/ms-playwright/chromium_headless_shell-1254/chrome-headless-shell-linux64/chrome-headless-shell");
    expect(resolveLighthouseHeadlessShellPath("/ms-playwright/chromium-1254/chrome-linux-arm64/chrome", "arm64", "linux"))
      .toBe("/ms-playwright/chromium_headless_shell-1254/chrome-headless-shell-linux-arm64/chrome-headless-shell");
    expect(resolveLighthouseHeadlessShellPath("/ms-playwright/chromium-1254/chrome-mac/Chromium.app/Contents/MacOS/Chromium", "arm64", "darwin"))
      .toBe("/ms-playwright/chromium_headless_shell-1254/chrome-headless-shell-mac-arm64/chrome-headless-shell");
    expect(resolveLighthouseHeadlessShellPath("C:\\ms-playwright\\chromium-1254\\chrome-win64\\chrome.exe", "x64", "win32"))
      .toBe("C:\\ms-playwright\\chromium_headless_shell-1254\\chrome-headless-shell-win64\\chrome-headless-shell.exe");
    expect(() => resolveLighthouseHeadlessShellPath("/invalid/chrome"))
      .toThrow("lighthouse_chromium_installation_invalid");
  });

  it("keeps the profile unknown when a required Lighthouse metric is absent", async () => {
    const browser = { newPage: vi.fn(async () => fakePage()), close: vi.fn(async () => undefined) };
    const runLighthouse = vi.fn(async () => ({
      lhr: { categories: { performance: { score: 0.9 } }, audits: { "first-contentful-paint": { numericValue: 900 } } },
    }));
    const result = await observeLighthouseMobileProfile({
      targetUrl: "https://example.com/",
      proxyUrl: "http://privacy-egress:3128",
      requestGate: new PrivacyBrowserRequestGate({
        requestedHostname: "example.com", isThirdPartyHost: () => false, maxRequests: 1_000,
      }),
      signal: new AbortController().signal,
      launchBrowser: vi.fn(async () => browser as never) as never,
      runLighthouse: runLighthouse as never,
    });
    expect(result).toMatchObject({ profile: "mobile", status: "unknown", score: null });
    expect(result.diagnostic?.missingMetrics).toContain("tbtMs");
  });

  it("logs only a normalized phase and error class when Lighthouse throws", async () => {
    const browser = { newPage: vi.fn(async () => fakePage()), close: vi.fn(async () => undefined) };
    const lighthouseError = Object.assign(new Error("Target closed at https://example.com/?token=private"), {
      name: "TargetCloseError",
    });
    const stderrWrite = vi.spyOn(process.stderr, "write").mockReturnValue(true);
    try {
      const result = await observeLighthouseMobileProfile({
        targetUrl: "https://example.com/",
        proxyUrl: "http://privacy-egress:3128",
        requestGate: new PrivacyBrowserRequestGate({
          requestedHostname: "example.com", isThirdPartyHost: () => false, maxRequests: 1_000,
        }),
        signal: new AbortController().signal,
        launchBrowser: vi.fn(async () => browser as never) as never,
        runLighthouse: vi.fn(async () => { throw lighthouseError; }) as never,
      });

      expect(result).toMatchObject({ status: "unknown", diagnostic: {
        code: "browser_observation_error",
        runtimeFailure: { stage: "run_lighthouse", errorClass: "target_closed" },
      } });
      expect(stderrWrite).toHaveBeenCalledWith(`${JSON.stringify({
        type: "lighthouse_mobile_runtime_error",
        stage: "run_lighthouse",
        errorClass: "target_closed",
      })}\n`);
      expect(stderrWrite.mock.calls.flat().join(" ")).not.toContain("example.com");
      expect(stderrWrite.mock.calls.flat().join(" ")).not.toContain("private");
    } finally {
      stderrWrite.mockRestore();
    }
  });
});

function fakePage() {
  return {
    setBypassServiceWorker: vi.fn(async () => undefined),
    setRequestInterception: vi.fn(async () => undefined),
    on: vi.fn(),
    target: () => ({ createCDPSession: async () => ({ send: vi.fn(async () => undefined), detach: vi.fn(async () => undefined) }) }),
  };
}
