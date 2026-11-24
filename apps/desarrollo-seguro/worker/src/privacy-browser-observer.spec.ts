import { afterEach, describe, expect, it, vi } from "vitest";
import { observePrivacyBehavior, resolvePrivacyObservationStatus } from "./privacy-browser-observer.js";
import { buildLegalCookieFindings } from "./privacy-legal-cookie-findings.js";
import { assessFirstEntryPolicyAccessObservation } from "./privacy-first-entry-policy-access.js";

const privacyLink = { hostname: "grumphya.com", path: "/privacidad", kind: "privacy" as const };

afterEach(() => vi.unstubAllGlobals());

describe("privacy browser observation status", () => {
  it("completes when each flow is evaluated or not applicable and capture is bounded", () => {
    expect(resolvePrivacyObservationStatus({
      flows: [{ status: "evaluated" }, { status: "not_applicable" }, { status: "not_applicable" }],
      requestCount: 12,
      budgetExceeded: false,
      overflow: false,
    })).toBe("complete");
  });

  it("marks partial evidence when a flow is unknown or a limit is reached", () => {
    const flows = [{ status: "evaluated" }, { status: "unknown" }, { status: "unknown" }] as const;
    expect(resolvePrivacyObservationStatus({ flows, requestCount: 4, budgetExceeded: false, overflow: false })).toBe("partial");
    expect(resolvePrivacyObservationStatus({
      flows: [{ status: "evaluated" }, { status: "not_applicable" }, { status: "not_applicable" }],
      requestCount: 8,
      budgetExceeded: true,
      overflow: false,
    })).toBe("partial");
    expect(resolvePrivacyObservationStatus({
      flows: [{ status: "evaluated" }, { status: "not_applicable" }, { status: "not_applicable" }],
      requestCount: 8,
      budgetExceeded: false,
      overflow: true,
    })).toBe("partial");
  });

  it("does not claim coverage when no request yielded usable observations", () => {
    expect(resolvePrivacyObservationStatus({
      flows: [{ status: "unknown" }, { status: "unknown" }, { status: "unknown" }],
      requestCount: 0,
      budgetExceeded: false,
      overflow: false,
    })).toBe("unknown");
  });

  it("rejects malformed request counts and incomplete flow sets", () => {
    expect(resolvePrivacyObservationStatus({ flows: [], requestCount: -1, budgetExceeded: false, overflow: false })).toBe("unknown");
    expect(resolvePrivacyObservationStatus({ flows: [], requestCount: 1, budgetExceeded: false, overflow: false })).toBe("partial");
  });
});

describe("observePrivacyBehavior", () => {
  it("captures a clean consent-free homepage without inventing a tracking signal", async () => {
    const browser = {
      newContext: vi.fn(async () => makeContext()),
      close: vi.fn(async () => undefined),
    };
    const result = await observePrivacyBehavior({
      protocolVersion: 1,
      requestId: "947dd0c9-564c-4a30-8ce3-efb4ecae9136",
      hostname: "GRUMPHYA.COM.",
    }, { proxyUrl: "http://privacy-egress:3128", launchBrowser: vi.fn(async () => browser as never) as never });

    expect(result.status).toBe("complete");
    expect(result.hostname).toBe("grumphya.com");
    expect(result.initial.consentPromptDetected).toBe(false);
    expect(result.initial.cookieReadComplete).toBe(true);
    expect(result.initial.storageReadComplete).toBe(true);
    expect(result.initial.signalHostsAfterChoice).toEqual(["grumphya.com"]);
    expect(result.accept.status).toBe("not_applicable");
    expect(result.reject.status).toBe("not_applicable");
    expect(result.policyLinkVisit.status).toBe("unknown");
    expect(browser.newContext).toHaveBeenCalledTimes(3);
    expect(browser.close).toHaveBeenCalledOnce();
  });

  it("captures grumphya_anon only after opening the policy link without treating it as rejection failure", async () => {
    const postLinkContext = makePolicyLinkVisitContext();
    const contexts = [makeContext(), postLinkContext, makeContext(), makeContext()];
    const browser = { newContext: vi.fn(async () => contexts.shift()!), close: vi.fn(async () => undefined) };
    const inspectPolicyLinks = vi.fn(async () => ({
      status: "evaluated" as const,
      consentComponentDetected: false,
      consentComponentLink: null,
      consentComponentDocumentAccess: "not_checked" as const,
      informationNoticeLink: privacyLink,
      informationNoticeDocumentAccess: "not_checked" as const,
      footerLink: null,
      footerLinkDocumentAccess: "not_checked" as const,
    }));

    const result = await observePrivacyBehavior({
      protocolVersion: 1,
      requestId: "947dd0c9-564c-4a30-8ce3-efb4ecae9136",
      hostname: "grumphya.com",
    }, {
      proxyUrl: "http://privacy-egress:3128",
      launchBrowser: vi.fn(async () => browser as never) as never,
      inspectPolicyLinks: inspectPolicyLinks as never,
    });

    expect(result.initial.phaseEvidence.beforeChoice?.cookies).toEqual([]);
    expect(result.initial.rejectVisibleAtFirstLayer).toBe(false);
    expect(result.policyLinkVisit).toMatchObject({
      status: "evaluated",
      link: privacyLink,
      documentAccess: "accessible",
      beforeNavigation: { cookies: [], cookieReadComplete: true },
      afterNavigation: {
        capturedAtMs: expect.any(Number),
        cookies: [{
          name: "grumphya_anon", domain: "grumphya.com", secure: true, httpOnly: true,
          sameSite: "Strict", expiresAtUnixSeconds: Date.parse("2027-12-29T00:00:00Z") / 1000,
        }],
        storageKeys: [],
      },
    });
    expect(postLinkContext.navigations).toEqual(["https://grumphya.com/privacidad"]);
    expect(postLinkContext.clicked).not.toHaveBeenCalled();
    expect(buildLegalCookieFindings(result)).toEqual([]);
    expect(assessFirstEntryPolicyAccessObservation(result)).toMatchObject({
      status: "pass",
      reasonCode: "information_notice_link_accessible_without_consent",
      policyLinkVisit: result.policyLinkVisit,
    });
    expect(JSON.stringify(result)).not.toContain("grumphya-cookie-value");
    expect(result.initial.firstEntryPolicyLinks.informationNoticeDocumentAccess).toBe("accessible");
  });

  it("returns bounded unknown evidence after an invalid request or browser startup failure", async () => {
    const launch = vi.fn(async () => { throw new Error("browser startup details"); });
    const startupFailure = await observePrivacyBehavior({
      protocolVersion: 1,
      requestId: "947dd0c9-564c-4a30-8ce3-efb4ecae9136",
      hostname: "grumphya.com",
    }, { proxyUrl: "http://privacy-egress:3128", launchBrowser: launch as never });
    expect(startupFailure.status).toBe("unknown");
    expect(startupFailure.initial.cookieReadComplete).toBe(false);
    expect(launch).toHaveBeenCalledOnce();

    await expect(observePrivacyBehavior({
      protocolVersion: 1,
      requestId: "bad",
      hostname: "grumphya.com",
    }, { proxyUrl: "http://privacy-egress:3128" })).rejects.toThrow("privacy_browser_request_invalid");
    await expect(observePrivacyBehavior({
      protocolVersion: 1,
      requestId: "947dd0c9-564c-4a30-8ce3-efb4ecae9136",
      hostname: "grumphya.com",
    }, { proxyUrl: "https://privacy-egress:3128" })).rejects.toThrow("privacy_browser_proxy_invalid");
  });

  it("records cookie and storage names without retaining values", async () => {
    const browser = { newContext: vi.fn(async () => makeContext(
      [{ name: "_ga", domain: ".grumphya.com", secure: true, httpOnly: false, value: "secret-cookie-value" }],
      { entries: [{ name: "consent-choice", kind: "local" }, { name: "cache-v1", kind: "cache" }], complete: true },
    )), close: vi.fn(async () => undefined) };
    const result = await observePrivacyBehavior({
      protocolVersion: 1, requestId: "947dd0c9-564c-4a30-8ce3-efb4ecae9136", hostname: "grumphya.com",
    }, { proxyUrl: "http://privacy-egress:3128", launchBrowser: vi.fn(async () => browser as never) as never });
    expect(result.initial.cookiesAfterChoice).toEqual([{ name: "_ga", domain: "grumphya.com", secure: true, httpOnly: false }]);
    expect(result.initial.storageKeysAfterChoice).toEqual([
      { name: "consent-choice", domain: "grumphya.com", kind: "local" },
      { name: "cache-v1", domain: "grumphya.com", kind: "cache" },
    ]);
    expect(JSON.stringify(result)).not.toContain("secret-cookie-value");
  });

  it("checks first-layer accept/reject visibility and reloads after rejecting", async () => {
    vi.stubGlobal("HTMLElement", MockElement);
    vi.stubGlobal("HTMLButtonElement", MockButton);
    vi.stubGlobal("HTMLInputElement", MockInput);
    vi.stubGlobal("getComputedStyle", () => ({ display: "block", visibility: "visible", opacity: "1" }));
    vi.stubGlobal("document", { getElementById: () => null });
    const contexts = Array.from({ length: 4 }, () => makeContext([], undefined, ["Aceptar todo", "Rechazar todo"]));
    const browser = { newContext: vi.fn(async () => contexts.shift()!), close: vi.fn(async () => undefined) };
    const result = await observePrivacyBehavior({
      protocolVersion: 1, requestId: "947dd0c9-564c-4a30-8ce3-efb4ecae9136", hostname: "grumphya.com",
    }, { proxyUrl: "http://privacy-egress:3128", launchBrowser: vi.fn(async () => browser as never) as never });

    expect(result.initial.acceptVisibleAtFirstLayer).toBe(true);
    expect(result.initial.rejectVisibleAtFirstLayer).toBe(true);
    expect(result.accept.actionsToAccept).toBe(1);
    expect(result.reject.actionsToReject).toBe(1);
    expect(result.reject.rejectionPersistedAfterReload).toBe(false);
  });

  it("checks a known provider toggle in an accepted session and confirms it stays disabled", async () => {
    vi.stubGlobal("HTMLElement", MockElement);
    vi.stubGlobal("HTMLButtonElement", MockButton);
    vi.stubGlobal("HTMLInputElement", MockInput);
    vi.stubGlobal("getComputedStyle", () => ({ display: "block", visibility: "visible", opacity: "1" }));
    vi.stubGlobal("document", { getElementById: () => null });
    const contexts = Array.from({ length: 5 }, () => makeVendorContext());
    const browser = { newContext: vi.fn(async () => contexts.shift()!), close: vi.fn(async () => undefined) };
    const result = await observePrivacyBehavior({
      protocolVersion: 1, requestId: "947dd0c9-564c-4a30-8ce3-efb4ecae9136", hostname: "grumphya.com",
    }, { proxyUrl: "http://privacy-egress:3128", launchBrowser: vi.fn(async () => browser as never) as never });

    expect(result.vendorControlCoverage).toBe("complete");
    expect(result.vendorControlCount).toBe(1);
    expect(result.vendorControls).toEqual([expect.objectContaining({
      provider: "Google Analytics",
      status: "evaluated",
      toggleCount: 1,
      actionsToDisable: 2,
      disabled: true,
      persistedDisabled: true,
    })]);
    expect(result.status).toBe("complete");
  });

  it("counts opening provider preferences as an additional choice action", async () => {
    vi.stubGlobal("HTMLElement", MockElement);
    vi.stubGlobal("HTMLButtonElement", MockButton);
    vi.stubGlobal("HTMLInputElement", MockInput);
    vi.stubGlobal("getComputedStyle", () => ({ display: "block", visibility: "visible", opacity: "1" }));
    const contexts = Array.from({ length: 4 }, () => makeContext([], undefined, ["Preferencias"]));
    const browser = { newContext: vi.fn(async () => contexts.shift()!), close: vi.fn(async () => undefined) };
    const result = await observePrivacyBehavior({
      protocolVersion: 1, requestId: "947dd0c9-564c-4a30-8ce3-efb4ecae9136", hostname: "grumphya.com",
    }, { proxyUrl: "http://privacy-egress:3128", launchBrowser: vi.fn(async () => browser as never) as never });

    expect(result.initial.acceptVisibleAtFirstLayer).toBe(false);
    expect(result.initial.rejectVisibleAtFirstLayer).toBe(false);
    expect(result.accept.actionsToAccept).toBe(2);
    expect(result.reject.actionsToReject).toBe(2);
  });

  it("marks cookie and storage reads incomplete when the browser denies inspection", async () => {
    const contexts = Array.from({ length: 4 }, () => makeContext([], { entries: [], complete: false }, [], true));
    const browser = { newContext: vi.fn(async () => contexts.shift()!), close: vi.fn(async () => undefined) };
    const result = await observePrivacyBehavior({
      protocolVersion: 1, requestId: "947dd0c9-564c-4a30-8ce3-efb4ecae9136", hostname: "grumphya.com",
    }, { proxyUrl: "http://privacy-egress:3128", launchBrowser: vi.fn(async () => browser as never) as never });
    expect(result.status).toBe("partial");
    expect(result.initial.status).toBe("unknown");
    expect(result.initial.cookieReadComplete).toBe(false);
    expect(result.initial.storageReadComplete).toBe(false);
  });

  it("records third-party attempts and blocks non-preference writes before a choice", async () => {
    const contexts = Array.from({ length: 4 }, () => makeContext([], undefined, [], false, {
      url: "https://analytics.google.com/g/collect", method: "POST",
    }, false, "wss://tracker.example.net/socket"));
    const browser = { newContext: vi.fn(async () => contexts.shift()!), close: vi.fn(async () => undefined) };
    const result = await observePrivacyBehavior({
      protocolVersion: 1, requestId: "947dd0c9-564c-4a30-8ce3-efb4ecae9136", hostname: "grumphya.com",
    }, { proxyUrl: "http://privacy-egress:3128", launchBrowser: vi.fn(async () => browser as never) as never });
    expect(result.initial.signalHostsAfterChoice).toContain("analytics.google.com");
    expect(result.initial.signalHostsAfterChoice).toContain("tracker.example.net");
    expect(result.thirdPartyRequestHosts).toContain("analytics.google.com");
    expect(result.thirdPartyRequestHosts).toContain("tracker.example.net");
    expect(result.blockedRequestCount).toBe(6);
  });

  it("returns unknown when initial navigation cannot load", async () => {
    const contexts = Array.from({ length: 4 }, () => makeContext([], undefined, [], false, undefined, true));
    const browser = { newContext: vi.fn(async () => contexts.shift()!), close: vi.fn(async () => undefined) };
    const result = await observePrivacyBehavior({
      protocolVersion: 1, requestId: "947dd0c9-564c-4a30-8ce3-efb4ecae9136", hostname: "grumphya.com",
    }, { proxyUrl: "http://privacy-egress:3128", launchBrowser: vi.fn(async () => browser as never) as never });
    expect(result.status).toBe("unknown");
    expect(result.initial.pageLoaded).toBe(false);
    expect(result.initial.cookieReadComplete).toBe(false);
  });
});

function makeContext(
  cookies: unknown[] = [],
  storage: { entries: Array<{ name: string; kind: "local" | "session" | "indexeddb" | "cache" | "window-name" }>; complete: boolean } = { entries: [], complete: true },
  controlLabels: string[] = [],
  cookieInspectionFails = false,
  requestOnNavigation: { url: string; method: string } = { url: "https://grumphya.com/", method: "GET" },
  navigationFails = false,
  websocketUrl: string | null = null,
) {
  const elements = controlLabels.map((label) => new MockButton(label));
  let requestRoute: ((route: unknown) => Promise<void>) | undefined;
  let websocketRoute: ((socket: unknown) => void) | undefined;
  const page = {
    setDefaultTimeout: vi.fn(),
    setDefaultNavigationTimeout: vi.fn(),
    on: vi.fn((event: string, listener: (request: { url: () => string }) => void) => {
      if (event === "requestfinished") listener({ url: () => "https://grumphya.com/" });
    }),
    goto: vi.fn(async () => {
      if (navigationFails) throw new Error("navigation failed");
      await requestRoute?.({
        request: () => ({ url: () => requestOnNavigation.url, method: () => requestOnNavigation.method }),
        continue: vi.fn(async () => undefined),
        fallback: vi.fn(async () => undefined),
        abort: vi.fn(async () => undefined),
      });
      if (websocketUrl) websocketRoute?.({ url: () => websocketUrl, close: vi.fn() });
    }),
    waitForTimeout: vi.fn(async () => undefined),
    locator: vi.fn((selector: string) => ({
      evaluateAll: vi.fn(async (callback: (items: unknown[]) => unknown) => callback(selector.includes("checkbox") || selector.includes("switch") ? [] : elements)),
      nth: vi.fn((index: number) => ({ click: vi.fn(async () => {
        elements[index]!.clicked = true;
        if (elements[index]!.innerText.toLowerCase().includes("preferencias")) {
          elements.splice(0, elements.length, new MockButton("Aceptar todo"), new MockButton("Rechazar todo"));
        }
      }) })),
    })),
    frames: vi.fn(() => [{ url: () => "https://grumphya.com/", evaluate: vi.fn(async () => storage) }]),
    reload: vi.fn(async () => undefined),
    close: vi.fn(async () => undefined),
  };
  return {
    route: vi.fn(async (_pattern: string, handler: (route: unknown) => Promise<void>) => { requestRoute = handler; }),
    routeWebSocket: vi.fn(async (_pattern: string, handler: (socket: unknown) => void) => { websocketRoute = handler; }),
    newPage: vi.fn(async () => page),
    on: vi.fn(),
    cookies: vi.fn(async () => {
      if (cookieInspectionFails) throw new Error("cookie inspection blocked");
      return cookies;
    }),
    close: vi.fn(async () => undefined),
  };
}

function makeVendorContext() {
  let controls: Array<MockElement> = [
    new MockButton("Aceptar todo"),
    new MockButton("Rechazar todo"),
    new MockButton("Preferencias"),
  ];
  let toggle: MockInput | null = null;
  let persistedToggleState = true;
  let requestRoute: ((route: unknown) => Promise<void>) | undefined;
  const openPreferences = () => {
    toggle = new MockInput("Google Analytics — Interés legítimo", persistedToggleState);
    controls = [toggle, new MockButton("Guardar preferencias")];
  };
  const page = {
    setDefaultTimeout: vi.fn(),
    setDefaultNavigationTimeout: vi.fn(),
    on: vi.fn((event: string, listener: (request: { url: () => string }) => void) => {
      if (event === "requestfinished") listener({ url: () => "https://grumphya.com/" });
    }),
    goto: vi.fn(async () => {
      await requestRoute?.({
        request: () => ({ url: () => "https://grumphya.com/", method: () => "GET" }),
        fallback: vi.fn(async () => undefined),
        abort: vi.fn(async () => undefined),
      });
      if (!controls.some((control) => control instanceof MockButton)) controls = [new MockButton("Preferencias")];
    }),
    waitForTimeout: vi.fn(async () => undefined),
    locator: vi.fn((selector: string) => {
      const items = selector.includes("checkbox") || selector.includes("switch") ? (toggle ? [toggle] : []) : controls;
      return {
        evaluateAll: vi.fn(async (callback: (elements: unknown[], providers?: string[]) => unknown, providers?: string[]) => callback(items, providers)),
        nth: vi.fn((index: number) => ({
          click: vi.fn(async () => {
            const element = items[index]!;
            if (element instanceof MockInput) element.checked = !element.checked;
            else if (element.innerText.toLowerCase().includes("guardar")) {
              if (toggle) persistedToggleState = toggle.checked;
              controls = [new MockButton("Preferencias")];
            } else if (element.innerText.toLowerCase().includes("preferencias")) openPreferences();
            else if (element.innerText.toLowerCase().includes("aceptar")) controls = [new MockButton("Preferencias")];
            else if (element.innerText.toLowerCase().includes("rechazar")) controls = [];
          }),
          evaluate: vi.fn(async (callback: (element: MockInput) => unknown) => callback(items[index] as MockInput)),
        })),
      };
    }),
    frames: vi.fn(() => [{ url: () => "https://grumphya.com/", evaluate: vi.fn(async () => ({ entries: [], complete: true })) }]),
    reload: vi.fn(async () => { controls = [new MockButton("Preferencias")]; }),
    close: vi.fn(async () => undefined),
  };
  return {
    route: vi.fn(async (_pattern: string, handler: (route: unknown) => Promise<void>) => { requestRoute = handler; }),
    routeWebSocket: vi.fn(async () => undefined),
    newPage: vi.fn(async () => page),
    on: vi.fn(),
    cookies: vi.fn(async () => []),
    close: vi.fn(async () => undefined),
  };
}

function makePolicyLinkVisitContext() {
  let policyLoaded = false;
  const clicked = vi.fn();
  const navigations: string[] = [];
  const page = {
    setDefaultTimeout: vi.fn(),
    setDefaultNavigationTimeout: vi.fn(),
    on: vi.fn(),
    goto: vi.fn(async (url: string) => {
      navigations.push(url);
      policyLoaded = true;
      return {
        status: () => 200,
        headers: () => ({ "content-type": "text/html; charset=utf-8" }),
        url: () => url,
      };
    }),
    waitForTimeout: vi.fn(async () => undefined),
    locator: vi.fn((selector: string) => selector === "body"
      ? { innerText: vi.fn(async () => "Política de privacidad y tratamiento de datos personales de Grumphya.") }
      : { evaluateAll: vi.fn(async () => []), nth: vi.fn(() => ({ click: clicked })) }),
    frames: vi.fn(() => [{
      url: () => policyLoaded ? "https://grumphya.com/privacidad" : "about:blank",
      evaluate: vi.fn(async () => ({
        entries: [],
        complete: true,
      })),
    }]),
    close: vi.fn(async () => undefined),
  };
  return {
    newPage: vi.fn(async () => page),
    route: vi.fn(async () => undefined),
    routeWebSocket: vi.fn(async () => undefined),
    cookies: vi.fn(async () => policyLoaded ? [{
      name: "grumphya_anon", domain: "grumphya.com", secure: true, httpOnly: true,
      sameSite: "Strict", expires: Date.parse("2027-12-29T00:00:00Z") / 1000,
      value: "grumphya-cookie-value",
    }] : []),
    close: vi.fn(async () => undefined),
    navigations,
    clicked,
  };
}

class MockElement {
  readonly tagName = "BUTTON";
  readonly className = "consent-actions";
  readonly parentElement = { tagName: "DIV", className: "consent-actions", getAttribute: () => null };
  readonly type: string = "button";
  clicked = false;

  constructor(readonly innerText: string) {}

  get textContent(): string { return this.innerText; }
  getBoundingClientRect(): DOMRect { return { width: 100, height: 30 } as DOMRect; }
  getAttribute(name: string): string | null { void name; return null; }
  closest(selector: string): null | { textContent: string } { void selector; return null; }
}

class MockButton extends MockElement {}
class MockInput extends MockElement {
  readonly type = "checkbox";
  readonly labels = null;
  checked: boolean;

  constructor(text: string, checked: boolean) {
    super(text);
    this.checked = checked;
  }

  override getAttribute(name: string): string | null { return name === "aria-checked" ? String(this.checked) : null; }
  override closest(selector: string): null | { textContent: string } {
    return selector.includes("data-provider") || selector === "li" || selector === "fieldset" || selector === "[role=group]"
      ? { textContent: this.innerText }
      : null;
  }
}
