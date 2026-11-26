import { describe, expect, it, vi } from "vitest";
import { observePagePerformance } from "./performance-browser-observer.js";

const TARGET_URL = "https://example.com/careers?source=lab";

describe("observePagePerformance", () => {
  it("measures mobile then desktop through the proxy and returns only metrics and scores", async () => {
    const fixture = makeBrowserFixture();
    const result = await observePagePerformance({
      targetUrl: TARGET_URL,
      hostname: "example.com",
      proxyUrl: "http://privacy-egress:3128",
      launchBrowser: vi.fn(async () => fixture.browser as never) as never,
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

    expect(fixture.contexts).toHaveLength(2);
    expect(fixture.contexts.map(({ options }) => options.viewport)).toEqual([
      { width: 375, height: 812 },
      { width: 1_365, height: 768 },
    ]);
    expect(fixture.contexts[0].options).toMatchObject({ isMobile: true, hasTouch: true, serviceWorkers: "block", acceptDownloads: false });
    expect(fixture.contexts[1].options).toMatchObject({ isMobile: false, serviceWorkers: "block", acceptDownloads: false });
    expect(fixture.cdpCommands).toContainEqual(["Emulation.setCPUThrottlingRate", { rate: 4 }]);
    expect(fixture.cdpCommands).toContainEqual(["Page.startScreencast", expect.any(Object)]);
    expect(fixture.cdpCommands).toContainEqual(["Page.stopScreencast", undefined]);
    expect(fixture.cdpCommands).toContainEqual(["Network.emulateNetworkConditions", {
      offline: false,
      latency: 150,
      downloadThroughput: 200_000,
      uploadThroughput: 93_750,
      connectionType: "cellular3g",
    }]);
    expect(fixture.cdpCommands.filter(([command]) => command === "Emulation.setCPUThrottlingRate")).toHaveLength(1);
    expect(fixture.browser.close).toHaveBeenCalledOnce();
  });

  it("marks the profile unknown when a required metric is missing", async () => {
    const fixture = makeBrowserFixture({ desktopMetrics: { lcpMs: null } });
    const result = await observePagePerformance({
      targetUrl: TARGET_URL,
      hostname: "example.com",
      proxyUrl: "http://privacy-egress:3128",
      launchBrowser: vi.fn(async () => fixture.browser as never) as never,
    });

    expect(result.profiles[0].status).toBe("complete");
    expect(result.profiles[1]).toMatchObject({ profile: "desktop", status: "unknown", lcpMs: null, score: null });
  });

  it("blocks writes through the request gate and marks the profile unknown on budget exhaustion", async () => {
    const fixture = makeBrowserFixture({ exceedRequestBudget: true });
    const result = await observePagePerformance({
      targetUrl: TARGET_URL,
      hostname: "example.com",
      proxyUrl: "http://privacy-egress:3128",
      launchBrowser: vi.fn(async () => fixture.browser as never) as never,
    });

    expect(result.profiles[0].status).toBe("unknown");
    expect(fixture.abortedRequests).toBe(2);
    expect(fixture.continuedRequests).toBe(999);
  });

  it("rejects non-HTTPS targets and host mismatches before launching Chromium", async () => {
    const launchBrowser = vi.fn();
    await expect(observePagePerformance({
      targetUrl: "https://other.example/careers",
      hostname: "example.com",
      proxyUrl: "http://privacy-egress:3128",
      launchBrowser: launchBrowser as never,
    })).rejects.toThrow("performance_browser_target_invalid");
    expect(launchBrowser).not.toHaveBeenCalled();
  });
});

function makeBrowserFixture(options: {
  desktopMetrics?: Record<string, number | null>;
  exceedRequestBudget?: boolean;
} = {}) {
  const contexts: Array<{ options: Record<string, unknown> }> = [];
  const cdpCommands: Array<[string, Record<string, unknown>?]> = [];
  let abortedRequests = 0;
  let continuedRequests = 0;
  let profileCount = 0;

  const browser = {
    close: vi.fn(async () => undefined),
    newContext: vi.fn(async (contextOptions: Record<string, unknown>) => {
      profileCount += 1;
      contexts.push({ options: contextOptions });
      let routeHandler: ((route: never) => Promise<void>) | undefined;
      let finishedHandler: ((event: { encodedDataLength: number }) => void) | undefined;
      let screencastHandler: ((event: { data: string; metadata: { timestamp?: number }; sessionId: number }) => void) | undefined;
      const session = {
        on: vi.fn((event: string, handler: (event: { encodedDataLength: number } & { data?: string; metadata?: { timestamp?: number }; sessionId?: number }) => void) => {
          if (event === "Network.loadingFinished") finishedHandler = handler;
          if (event === "Page.screencastFrame") screencastHandler = handler as never;
        }),
        send: vi.fn(async (command: string, params?: Record<string, unknown>) => {
          cdpCommands.push([command, params]);
          if (command === "Page.startScreencast") {
            screencastHandler?.({ data: "frame-a", metadata: { timestamp: 1 }, sessionId: 1 });
            screencastHandler?.({ data: "frame-b", metadata: { timestamp: 1.1 }, sessionId: 2 });
          }
        }),
        detach: vi.fn(async () => undefined),
      };
      const page = {
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
            ...((profileCount === 2 ? options.desktopMetrics : undefined) ?? {}),
          }),
      };
      return {
        route: vi.fn(async (_pattern: string, handler: (route: never) => Promise<void>) => {
          routeHandler = handler;
          if (options.exceedRequestBudget && profileCount === 1) {
            const invoke = async (url: string, method: string) => routeHandler!({
              request: () => ({ url: () => url, method: () => method }),
              abort: async () => { abortedRequests += 1; },
              continue: async () => { continuedRequests += 1; },
            } as never);
            await invoke("https://example.com/asset", "POST");
            for (let index = 0; index < 1_000; index += 1) await invoke("https://example.com/asset", "GET");
          }
        }),
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
    get abortedRequests() { return abortedRequests; },
    get continuedRequests() { return continuedRequests; },
  };
}
