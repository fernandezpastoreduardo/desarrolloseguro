import { describe, expect, it, vi } from "vitest";
import { observePagePerformance } from "./performance-browser-observer.js";
import { PrivacyBrowserRequestGate } from "./privacy-browser-request-gate.js";

const TARGET_URL = "https://example.com/careers?source=lab";

describe("observePagePerformance", () => {
  it("measures mobile then desktop through the proxy and returns only metrics and scores", async () => {
    const fixture = makeBrowserFixture();
    const observeMobileProfile = vi.fn(async () => completeMobileProfile());
    const result = await observePagePerformance({
      targetUrl: TARGET_URL,
      hostname: "example.com",
      proxyUrl: "http://privacy-egress:3128",
      launchBrowser: vi.fn(async () => fixture.browser as never) as never,
      observeMobileProfile,
    });

    expect(result.profiles).toHaveLength(2);
    expect(result.profiles.map(({ profile, status }) => [profile, status])).toEqual([
      ["mobile", "complete"],
      ["desktop", "complete"],
    ]);
    expect(result.profiles[0]).toMatchObject({
      fcpMs: 1_000,
      speedIndexMs: 2_200,
      lcpMs: 1_700,
      cls: 0.04,
      tbtMs: 50,
      ttfbMs: 320,
      transferBytes: 12_345,
      score: expect.any(Number),
    });
    expect(JSON.stringify(result)).not.toContain(TARGET_URL);
    expect(JSON.stringify(result)).not.toContain("example.com");
    expect(JSON.stringify(result)).not.toContain("script.js");

    expect(fixture.contexts).toHaveLength(1);
    expect(fixture.contexts[0].options.viewport).toEqual({ width: 1_365, height: 768 });
    expect(fixture.contexts[0].options).toMatchObject({ isMobile: false, serviceWorkers: "block", acceptDownloads: false });
    expect(fixture.cdpCommands).not.toContainEqual(["Emulation.setCPUThrottlingRate", expect.anything()]);
    expect(fixture.cdpCommands).not.toContainEqual(["Network.emulateNetworkConditions", expect.anything()]);
    expect(observeMobileProfile).toHaveBeenCalledOnce();
    expect(fixture.browser.close).toHaveBeenCalledOnce();
  });

  it("marks the profile unknown when a required metric is missing", async () => {
    const fixture = makeBrowserFixture({ desktopMetrics: { lcpMs: null } });
    const result = await observePagePerformance({
      targetUrl: TARGET_URL,
      hostname: "example.com",
      proxyUrl: "http://privacy-egress:3128",
      launchBrowser: vi.fn(async () => fixture.browser as never) as never,
      observeMobileProfile: vi.fn(async () => completeMobileProfile()),
    });

    expect(result.profiles[0].status).toBe("complete");
    expect(result.profiles[1]).toMatchObject({ profile: "desktop", status: "unknown", lcpMs: null, score: null });
  });

  it("blocks writes through the request gate and marks the profile unknown on budget exhaustion", async () => {
    const fixture = makeBrowserFixture();
    const observeMobileProfile = vi.fn(async ({ requestGate }: { requestGate: PrivacyBrowserRequestGate }) => {
      requestGate.inspect("https://example.com/asset", "POST");
      for (let index = 0; index < 1_000; index += 1) requestGate.inspect("https://example.com/asset", "GET");
      return incompleteMobileProfile();
    });
    const result = await observePagePerformance({
      targetUrl: TARGET_URL,
      hostname: "example.com",
      proxyUrl: "http://privacy-egress:3128",
      launchBrowser: vi.fn(async () => fixture.browser as never) as never,
      observeMobileProfile,
    });

    expect(result.profiles[0].status).toBe("unknown");
    expect(observeMobileProfile).toHaveBeenCalledOnce();
  });

  it("rejects non-HTTPS targets and host mismatches before launching Chromium", async () => {
    const launchBrowser = vi.fn();
    await expect(observePagePerformance({
      targetUrl: "https://other.example/careers",
      hostname: "example.com",
      proxyUrl: "http://privacy-egress:3128",
      launchBrowser: launchBrowser as never,
      observeMobileProfile: vi.fn(),
    })).rejects.toThrow("performance_browser_target_invalid");
    expect(launchBrowser).not.toHaveBeenCalled();
  });
});

function completeMobileProfile() {
  return {
    profile: "mobile" as const,
    status: "complete" as const,
    fcpMs: 1_000,
    speedIndexMs: 2_200,
    lcpMs: 1_700,
    cls: 0.04,
    tbtMs: 50,
    ttfbMs: 320,
    transferBytes: 12_345,
    score: 95,
  };
}

function incompleteMobileProfile() {
  return {
    profile: "mobile" as const,
    status: "unknown" as const,
    fcpMs: null,
    speedIndexMs: null,
    lcpMs: null,
    cls: null,
    tbtMs: null,
    ttfbMs: null,
    transferBytes: null,
    score: null,
    diagnostic: { code: "request_budget_exceeded" as const },
  };
}

function makeBrowserFixture(options: { desktopMetrics?: Record<string, number | null> } = {}) {
  const contexts: Array<{ options: Record<string, unknown> }> = [];
  const cdpCommands: Array<[string, Record<string, unknown>?]> = [];
  let profileCount = 0;

  const browser = {
    close: vi.fn(async () => undefined),
    newContext: vi.fn(async (contextOptions: Record<string, unknown>) => {
      profileCount += 1;
      contexts.push({ options: contextOptions });
      let finishedHandler: ((event: { encodedDataLength: number }) => void) | undefined;
      const session = {
        on: vi.fn((event: string, handler: (event: { encodedDataLength: number } & { data?: string; metadata?: { timestamp?: number }; sessionId?: number }) => void) => {
          if (event === "Network.loadingFinished") finishedHandler = handler;
        }),
        send: vi.fn(async (command: string, params?: Record<string, unknown>) => {
          cdpCommands.push([command, params]);
        }),
        detach: vi.fn(async () => undefined),
      };
      const page = {
        context: vi.fn(() => ({
          newPage: vi.fn(async () => ({
            evaluate: vi.fn(async () => 2_200),
            close: vi.fn(async () => undefined),
          })),
        })),
        addInitScript: vi.fn(async () => undefined),
        goto: vi.fn(async () => {
          finishedHandler?.({ encodedDataLength: 12_345 });
        }),
        waitForLoadState: vi.fn(async () => undefined),
        waitForTimeout: vi.fn(async () => undefined),
        evaluate: vi.fn(async (_callback, args?: unknown) => Array.isArray(args)
          ? 2_200
          : {
            fcpMs: 1_000,
            lcpMs: 1_700,
            cls: 0.04,
            tasks: profileCount === 1
              ? [{ startTime: 100, duration: 600 }, { startTime: 2_000, duration: 100 }, { startTime: 8_200, duration: 200 }]
              : [{ startTime: 100, duration: 130 }],
            resources: profileCount === 1
              ? [{ startTime: 0, responseEnd: 3_000 }, { startTime: 1_500, responseEnd: 2_500 }]
              : [],
            observedUntilMs: 10_000,
            ttfbMs: 320,
            ...((profileCount === 1 ? options.desktopMetrics : undefined) ?? {}),
          }),
      };
      return {
        route: vi.fn(async () => undefined),
        routeWebSocket: vi.fn(async () => undefined),
        newPage: vi.fn(async () => page),
        newCDPSession: vi.fn(async () => session),
        close: vi.fn(async () => undefined),
      };
    }),
  };

  const originalNewContext = browser.newContext;
  browser.newContext = vi.fn(async (contextOptions: Record<string, unknown>) => {
    return originalNewContext(contextOptions);
  });
  return {
    browser,
    contexts,
    cdpCommands,
  };
}
