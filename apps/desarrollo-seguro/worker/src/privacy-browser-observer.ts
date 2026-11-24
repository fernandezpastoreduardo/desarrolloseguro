import { chromium, type Browser, type BrowserContext, type Page, type Request } from "playwright";
import { normalizeHostname, isThirdPartyPrivacyHost, PRIVACY_BROWSER_BUDGET } from "@desarrolloseguro/core";
import { PrivacyBrowserRequestGate } from "./privacy-browser-request-gate.js";
import {
  PrivacyRequestTimeline,
  type PrivacyRequestEvidence,
} from "./privacy-request-timeline.js";
import { PRIVACY_KNOWLEDGE_RULES } from "./privacy-knowledge-catalog.js";
import {
  areVendorTogglesOff,
  clickConsentControl,
  findConsentControl,
  inspectConsentControls,
  inspectVendorToggles,
  turnVendorTogglesOff,
  type VendorToggle,
  type VendorToggleInspection,
} from "./privacy-consent-controls.js";

const NAVIGATION_TIMEOUT_MS = 15_000;
const CONSENT_SETTLE_MS = 1_000;
const ACTION_TIMEOUT_MS = 5_000;
const MAX_RECORDED_NAMES = 200;
const MAX_PHASE_SNAPSHOT_NAMES = 50;
const MAX_RECORDED_HOSTS = 200;
const MAX_PROVIDER_CONTEXTS = Math.min(PRIVACY_BROWSER_BUDGET.individualProviders, PRIVACY_BROWSER_BUDGET.contexts - 4);
const NONESSENTIAL_TRACKING_CATEGORIES = new Set(["analytics", "advertising", "social"]);

export type PrivacyBrowserInput = {
  protocolVersion: 1;
  requestId: string;
  hostname: string;
};

export type PrivacyBrowserFlowObservation = {
  status: "evaluated" | "unknown" | "not_applicable";
  pageLoaded: boolean;
  consentPromptDetected: boolean | null;
  acceptVisibleAtFirstLayer: boolean | null;
  rejectVisibleAtFirstLayer: boolean | null;
  actionsToAccept: number | null;
  actionsToReject: number | null;
  preferenceWriteAllowed: boolean;
  rejectionPersistedAfterReload: boolean | null;
  signalHostsAfterChoice: string[];
  completedHostsAfterChoice: string[];
  cookiesAfterChoice: Array<{ name: string; domain: string; secure: boolean; httpOnly: boolean }>;
  storageKeysAfterChoice: Array<{
    name: string;
    domain: string;
    kind: "local" | "session" | "indexeddb" | "cache" | "window-name";
  }>;
  cookieReadComplete: boolean;
  storageReadComplete: boolean;
  phaseEvidence: {
    beforeChoice: PrivacyBrowserStateSnapshot | null;
    choiceActionAtMs: number | null;
    afterChoice: PrivacyBrowserStateSnapshot | null;
    reloadStartedAtMs: number | null;
    afterReload: PrivacyBrowserStateSnapshot | null;
    rejectionChoiceStateAfterReload: "rejected" | "not_rejected" | "unknown";
    rejectionChoiceEvidence: PrivacyRejectionChoiceEvidence | null;
    networkRequests: PrivacyRequestEvidence[];
    networkRequestsComplete: boolean;
  };
};

export type PrivacyRejectionChoiceEvidence = {
  state: "rejected" | "not_rejected" | "unknown";
  capturedAtMs: number;
  preferencesVisible: boolean;
  visibleToggleCount: number;
  unmatchedToggleCount: number;
  providers: Array<{ provider: string; state: "enabled" | "disabled" | "unknown" }>;
};

export type PrivacyBrowserStateSnapshot = {
  capturedAtMs: number;
  cookies: Array<{ name: string; domain: string; secure: boolean; httpOnly: boolean }>;
  storageKeys: Array<{
    name: string;
    domain: string;
    kind: "local" | "session" | "indexeddb" | "cache" | "window-name";
  }>;
  cookieReadComplete: boolean;
  storageReadComplete: boolean;
};

export type PrivacyBrowserObservation = {
  protocolVersion: 1;
  requestId: string;
  hostname: string;
  status: "complete" | "partial" | "unknown";
  context: { browser: "Chromium"; locale: "es-ES"; timezone: "Europe/Madrid"; viewport: "desktop-1365x768" };
  initial: PrivacyBrowserFlowObservation;
  accept: PrivacyBrowserFlowObservation;
  reject: PrivacyBrowserFlowObservation;
  vendorControlCoverage: "complete" | "partial" | "unknown" | "not_applicable";
  vendorControlCount: number;
  vendorControls: PrivacyVendorControlCheck[];
  requestCount: number;
  blockedRequestCount: number;
  requestBudgetExceeded: boolean;
  thirdPartyRequestHosts: string[];
  receivedBytes: number | null;
};

export type PrivacyVendorControlCheck = {
  provider: string;
  status: "evaluated" | "unknown";
  declaredLegitimateInterest: boolean | null;
  toggleCount: number;
  actionsToDisable: number | null;
  disabled: boolean | null;
  persistedDisabled: boolean | null;
  signalHostsAfterDisable: string[];
  completedHostsAfterDisable: string[];
  cookiesAfterDisable: Array<{ name: string; domain: string }>;
};

type RequestLedger = {
  requestCount: number;
  blockedRequestCount: number;
  thirdPartyRequestHosts: Set<string>;
  signalHosts: Set<string>;
  overflow: boolean;
};

type VendorControlDiscovery = {
  status: PrivacyBrowserObservation["vendorControlCoverage"];
  visibleCount: number;
  candidates: VendorToggle[];
};

const UNKNOWN_FLOW: PrivacyBrowserFlowObservation = {
  status: "unknown",
  pageLoaded: false,
  consentPromptDetected: null,
  acceptVisibleAtFirstLayer: null,
  rejectVisibleAtFirstLayer: null,
  actionsToAccept: null,
  actionsToReject: null,
  preferenceWriteAllowed: false,
  rejectionPersistedAfterReload: null,
  signalHostsAfterChoice: [],
  completedHostsAfterChoice: [],
  cookiesAfterChoice: [],
  storageKeysAfterChoice: [],
  cookieReadComplete: false,
  storageReadComplete: false,
  phaseEvidence: {
    beforeChoice: null,
    choiceActionAtMs: null,
    afterChoice: null,
    reloadStartedAtMs: null,
    afterReload: null,
    rejectionChoiceStateAfterReload: "unknown",
    rejectionChoiceEvidence: null,
    networkRequests: [],
    networkRequestsComplete: true,
  },
};

const EMPTY_PHASE_EVIDENCE: PrivacyBrowserFlowObservation["phaseEvidence"] = {
  beforeChoice: null,
  choiceActionAtMs: null,
  afterChoice: null,
  reloadStartedAtMs: null,
  afterReload: null,
  rejectionChoiceStateAfterReload: "unknown",
  rejectionChoiceEvidence: null,
  networkRequests: [],
  networkRequestsComplete: true,
};

/** Runs one read-only baseline and isolated accept/reject flows through the egress proxy. */
export async function observePrivacyBehavior(
  input: PrivacyBrowserInput,
  options: { proxyUrl: string; signal?: AbortSignal; launchBrowser?: typeof chromium.launch } ,
): Promise<PrivacyBrowserObservation> {
  const hostname = normalizeHostname(input.hostname);
  if (input.protocolVersion !== 1 || !/^[0-9a-f-]{36}$/iu.test(input.requestId)) throw new Error("privacy_browser_request_invalid");
  if (typeof options.proxyUrl !== "string" || !options.proxyUrl.startsWith("http://")) throw new Error("privacy_browser_proxy_invalid");
  const gate = new PrivacyBrowserRequestGate({
    requestedHostname: hostname,
    isThirdPartyHost: isThirdPartyPrivacyHost,
    maxRequests: PRIVACY_BROWSER_BUDGET.requests,
  });
  const ledger: RequestLedger = {
    requestCount: 0,
    blockedRequestCount: 0,
    thirdPartyRequestHosts: new Set(),
    signalHosts: new Set(),
    overflow: false,
  };
  const launch = options.launchBrowser ?? chromium.launch.bind(chromium);
  const deadlineSignal = AbortSignal.timeout(PRIVACY_BROWSER_BUDGET.durationMs);
  const signal = options.signal ? AbortSignal.any([options.signal, deadlineSignal]) : deadlineSignal;
  let browser: Browser | undefined;
  try {
    if (signal.aborted) throw new Error("request_aborted");
    browser = await launch({
      headless: true,
      proxy: { server: options.proxyUrl, bypass: "<-loopback>" },
      args: ["--disable-background-networking", "--disable-component-update", "--disable-sync", "--no-first-run", "--disable-dev-shm-usage"],
    });
    const initial = await runFlow(browser, hostname, "initial", gate, ledger, signal);
    const accept = await runFlow(browser, hostname, "accept", gate, ledger, signal);
    const reject = await runFlow(browser, hostname, "reject", gate, ledger, signal);
    const discovery = await discoverVendorControls(browser, hostname, initial, gate, ledger, signal);
    const vendorControls: PrivacyVendorControlCheck[] = [];
    if (discovery.status !== "not_applicable") {
      for (const candidate of discovery.candidates.slice(0, MAX_PROVIDER_CONTEXTS)) {
        if (signal.aborted || gate.hasExceededBudget()) break;
        vendorControls.push(await runVendorControlCheck(browser, hostname, candidate, gate, ledger, signal));
      }
    }
    const vendorControlCoverage = resolveVendorControlCoverage(discovery, vendorControls);
    const status = resolvePrivacyObservationStatus({
      flows: [initial, accept, reject],
      requestCount: ledger.requestCount,
      budgetExceeded: gate.hasExceededBudget(),
      overflow: ledger.overflow,
      vendorControlsComplete: vendorControlCoverage === "complete" || vendorControlCoverage === "not_applicable",
    });
    return {
      protocolVersion: 1,
      requestId: input.requestId,
      hostname,
      status,
      context: { browser: "Chromium", locale: "es-ES", timezone: "Europe/Madrid", viewport: "desktop-1365x768" },
      initial,
      accept,
      reject,
      vendorControlCoverage,
      vendorControlCount: discovery.visibleCount,
      vendorControls,
      requestCount: ledger.requestCount,
      blockedRequestCount: ledger.blockedRequestCount,
      requestBudgetExceeded: gate.hasExceededBudget(),
      thirdPartyRequestHosts: [...ledger.thirdPartyRequestHosts].slice(0, MAX_RECORDED_HOSTS),
      receivedBytes: null,
    };
  } catch {
    return {
      protocolVersion: 1,
      requestId: input.requestId,
      hostname,
      status: "unknown",
      context: { browser: "Chromium", locale: "es-ES", timezone: "Europe/Madrid", viewport: "desktop-1365x768" },
      initial: UNKNOWN_FLOW,
      accept: UNKNOWN_FLOW,
      reject: UNKNOWN_FLOW,
      vendorControlCoverage: "unknown",
      vendorControlCount: 0,
      vendorControls: [],
      requestCount: ledger.requestCount,
      blockedRequestCount: ledger.blockedRequestCount,
      requestBudgetExceeded: gate.hasExceededBudget(),
      thirdPartyRequestHosts: [...ledger.thirdPartyRequestHosts].slice(0, MAX_RECORDED_HOSTS),
      receivedBytes: null,
    };
  } finally {
    await browser?.close().catch(() => undefined);
  }
}

export function resolvePrivacyObservationStatus(input: {
  flows: readonly Pick<PrivacyBrowserFlowObservation, "status">[];
  requestCount: number;
  budgetExceeded: boolean;
  overflow: boolean;
  vendorControlsComplete?: boolean;
}): PrivacyBrowserObservation["status"] {
  if (!Number.isSafeInteger(input.requestCount) || input.requestCount < 0) return "unknown";
  const flowsComplete = input.flows.length === 3 && input.flows.every(({ status }) =>
    status === "evaluated" || status === "not_applicable",
  );
  if (flowsComplete && !input.budgetExceeded && !input.overflow && input.vendorControlsComplete !== false) return "complete";
  return input.requestCount > 0 ? "partial" : "unknown";
}

async function runFlow(
  browser: Browser,
  hostname: string,
  action: "initial" | "accept" | "reject",
  gate: PrivacyBrowserRequestGate,
  ledger: RequestLedger,
  signal?: AbortSignal,
): Promise<PrivacyBrowserFlowObservation> {
  if (signal?.aborted || gate.hasExceededBudget()) return UNKNOWN_FLOW;
  const context = await browser.newContext({
    acceptDownloads: false,
    colorScheme: "light",
    javaScriptEnabled: true,
    locale: "es-ES",
    serviceWorkers: "block",
    timezoneId: "Europe/Madrid",
    viewport: { width: 1365, height: 768 },
  });
  let pageLoaded = false;
  const timeline = new PrivacyRequestTimeline();
  const completedHosts = new Set<string>();
  try {
    const flowHosts = await installRequestGate(context, gate, ledger, (request) => timeline.markBlocked(request));
    const page = await context.newPage();
    page.setDefaultTimeout(ACTION_TIMEOUT_MS);
    page.setDefaultNavigationTimeout(NAVIGATION_TIMEOUT_MS);
    timeline.attach(page);
    page.on("requestfinished", (request) => {
      const requestHostname = safeHostname(request.url());
      if (requestHostname) completedHosts.add(requestHostname);
    });
    try {
      await page.goto(`https://${hostname}/`, { waitUntil: "domcontentloaded" });
      pageLoaded = true;
    } catch {
      return await captureFlow(context, page, { ...UNKNOWN_FLOW, pageLoaded }, timeline, ledger, flowHosts, completedHosts);
    }
    await page.waitForTimeout(CONSENT_SETTLE_MS);
    context.on("page", (openedPage) => {
      if (openedPage !== page) void openedPage.close().catch(() => undefined);
    });
    const controls = await inspectConsentControls(page);
    const hasConsentControls = controls.length > 0;
    const acceptVisibleAtFirstLayer = controls.some(({ kind }) => kind === "accept");
    const rejectVisibleAtFirstLayer = controls.some(({ kind }) => kind === "reject");
    const firstLayerSnapshot = await captureStateSnapshot(context, page, timeline.elapsed());
    if (action === "initial") {
      return await captureFlow(context, page, {
        status: "evaluated",
        pageLoaded,
        consentPromptDetected: hasConsentControls,
        acceptVisibleAtFirstLayer,
        rejectVisibleAtFirstLayer,
        actionsToAccept: acceptVisibleAtFirstLayer ? 1 : hasConsentControls ? null : 0,
        actionsToReject: rejectVisibleAtFirstLayer ? 1 : hasConsentControls ? null : 0,
        preferenceWriteAllowed: false,
        rejectionPersistedAfterReload: null,
        signalHostsAfterChoice: [],
        completedHostsAfterChoice: [],
        cookiesAfterChoice: [],
        storageKeysAfterChoice: [],
        cookieReadComplete: false,
        storageReadComplete: false,
        phaseEvidence: { ...EMPTY_PHASE_EVIDENCE, beforeChoice: firstLayerSnapshot },
      }, timeline, ledger, flowHosts, completedHosts);
    }

    if (!hasConsentControls) {
      return await captureFlow(context, page, {
        ...UNKNOWN_FLOW,
        status: "not_applicable",
        pageLoaded,
        consentPromptDetected: false,
        acceptVisibleAtFirstLayer: false,
        rejectVisibleAtFirstLayer: false,
        actionsToAccept: 0,
        actionsToReject: 0,
        phaseEvidence: { ...EMPTY_PHASE_EVIDENCE, beforeChoice: firstLayerSnapshot },
      }, timeline, ledger, flowHosts, completedHosts);
    }

    const chosen = action === "accept" ? "accept" : "reject";
    let steps = 0;
    let selected = findConsentControl(controls, chosen);
    if (!selected) {
      const manage = findConsentControl(controls, "manage");
      if (manage && await clickConsentControl(page, manage)) {
        steps += 1;
        await page.waitForTimeout(CONSENT_SETTLE_MS);
        selected = findConsentControl(await inspectConsentControls(page), chosen);
      }
    }
    if (!selected || !selected.safeToClick) {
      return await captureFlow(context, page, {
        ...UNKNOWN_FLOW,
        pageLoaded,
        consentPromptDetected: hasConsentControls,
        phaseEvidence: { ...EMPTY_PHASE_EVIDENCE, beforeChoice: firstLayerSnapshot },
      }, timeline, ledger, flowHosts, completedHosts);
    }
    steps += 1;
    const beforeChoice = await captureStateSnapshot(context, page, timeline.elapsed());
    const preferenceWritesBefore = gate.getAllowedPreferenceWrites();
    gate.armPreferenceWrite();
    let choiceActionAtMs: number | null = null;
    if (!await clickConsentControl(page, selected, () => { choiceActionAtMs = timeline.setPhase("after_choice"); })) {
      return await captureFlow(context, page, { ...UNKNOWN_FLOW, pageLoaded,
        phaseEvidence: { ...EMPTY_PHASE_EVIDENCE, beforeChoice, choiceActionAtMs } }, timeline, ledger, flowHosts, completedHosts);
    }
    const afterChoice = await captureStateSnapshot(context, page, timeline.elapsed());
    await page.waitForTimeout(CONSENT_SETTLE_MS);
    const hostsAfterChoice = [...flowHosts];
    let afterReload: PrivacyBrowserStateSnapshot | null = null;
    let reloadStartedAtMs: number | null = null;
    let rejectionPersistedAfterReload: boolean | null = null;
    let rejectionChoiceEvidence: PrivacyRejectionChoiceEvidence | null = null;
    let legacyFinalSnapshot: PrivacyBrowserStateSnapshot | undefined;
    let legacyFlowHosts: Set<string> | undefined;
    let legacyCompletedHosts: Set<string> | undefined;
    if (action === "reject" && !gate.hasExceededBudget()) {
      try {
        reloadStartedAtMs = timeline.setPhase("after_reload");
        await page.reload({ waitUntil: "domcontentloaded" });
        const afterReloadControls = await inspectConsentControls(page);
        rejectionPersistedAfterReload = !afterReloadControls.some(({ kind }) => kind === "accept" || kind === "reject");
        legacyFinalSnapshot = await captureStateSnapshot(context, page, timeline.elapsed(), MAX_RECORDED_NAMES);
        afterReload = limitPhaseSnapshot(legacyFinalSnapshot);
        legacyFlowHosts = new Set(flowHosts);
        legacyCompletedHosts = new Set(completedHosts);
        rejectionChoiceEvidence = await capturePersistedChoiceState(page, gate, timeline);
      } catch {
        rejectionPersistedAfterReload = null;
      }
    }
    return await captureFlow(context, page, {
      status: "evaluated",
      pageLoaded,
      consentPromptDetected: hasConsentControls,
      acceptVisibleAtFirstLayer,
      rejectVisibleAtFirstLayer,
      actionsToAccept: action === "accept" ? steps : null,
      actionsToReject: action === "reject" ? steps : null,
      preferenceWriteAllowed: gate.getAllowedPreferenceWrites() > preferenceWritesBefore,
      rejectionPersistedAfterReload,
      signalHostsAfterChoice: hostsAfterChoice,
      completedHostsAfterChoice: [],
      cookiesAfterChoice: [],
      storageKeysAfterChoice: [],
      cookieReadComplete: false,
      storageReadComplete: false,
      phaseEvidence: { beforeChoice, choiceActionAtMs, afterChoice, reloadStartedAtMs, afterReload,
        rejectionChoiceStateAfterReload: rejectionChoiceEvidence?.state ?? "unknown",
        rejectionChoiceEvidence,
        networkRequests: [], networkRequestsComplete: true },
    }, timeline, ledger, legacyFlowHosts ?? flowHosts, legacyCompletedHosts ?? completedHosts, legacyFinalSnapshot);
  } finally {
    await context.close().catch(() => undefined);
  }
}

async function capturePersistedChoiceState(
  page: Page,
  gate: PrivacyBrowserRequestGate,
  timeline: PrivacyRequestTimeline,
): Promise<PrivacyRejectionChoiceEvidence> {
  gate.disarmPreferenceWrite();
  timeline.setPhase("cmp_inspection");
  const providers = [...new Set(PRIVACY_KNOWLEDGE_RULES
    .filter(({ category }) => NONESSENTIAL_TRACKING_CATEGORIES.has(category))
    .map(({ provider }) => provider))];
  let controls = await inspectConsentControls(page);
  let preferencesVisible = controls.some(({ kind }) => kind === "save");
  let inspection: VendorToggleInspection = { toggles: [], visibleCount: 0, unmatchedCount: 0 };
  if (preferencesVisible) inspection = await inspectVendorToggles(page, providers);
  else {
    const manage = findConsentControl(controls, "manage");
    if (manage && await clickConsentControl(page, manage)) {
      await page.waitForTimeout(CONSENT_SETTLE_MS);
      controls = await inspectConsentControls(page);
      inspection = await inspectVendorToggles(page, providers);
      preferencesVisible = controls.some(({ kind }) => kind === "save") ||
        (inspection.visibleCount > 0 && inspection.toggles.length > 0);
    }
  }
  const providerStates = inspection.toggles.map(({ provider, enabled }) => ({
    provider,
    state: enabled === null ? "unknown" as const : enabled ? "enabled" as const : "disabled" as const,
  }));
  const hasEnabledProvider = inspection.toggles.some(({ enabled }) => enabled === true);
  const hasUnknownProvider = inspection.toggles.some(({ enabled }) => enabled === null);
  const state = hasEnabledProvider
    ? "not_rejected"
    : !preferencesVisible || inspection.visibleCount === 0 || inspection.toggles.length === 0 ||
        inspection.unmatchedCount > 0 || hasUnknownProvider
      ? "unknown"
      : "rejected";
  return {
    state,
    capturedAtMs: timeline.elapsed(),
    preferencesVisible,
    visibleToggleCount: inspection.visibleCount,
    unmatchedToggleCount: inspection.unmatchedCount,
    providers: providerStates,
  };
}

async function discoverVendorControls(
  browser: Browser,
  hostname: string,
  initial: PrivacyBrowserFlowObservation,
  gate: PrivacyBrowserRequestGate,
  ledger: RequestLedger,
  signal: AbortSignal,
): Promise<VendorControlDiscovery> {
  if (initial.consentPromptDetected === false) return { status: "not_applicable", visibleCount: 0, candidates: [] };
  if (initial.consentPromptDetected !== true || signal.aborted || gate.hasExceededBudget()) {
    return { status: "unknown", visibleCount: 0, candidates: [] };
  }
  const context = await browser.newContext({
    acceptDownloads: false,
    colorScheme: "light",
    javaScriptEnabled: true,
    locale: "es-ES",
    serviceWorkers: "block",
    timezoneId: "Europe/Madrid",
    viewport: { width: 1365, height: 768 },
  });
  try {
    await installRequestGate(context, gate, ledger);
    const page = await context.newPage();
    page.setDefaultTimeout(ACTION_TIMEOUT_MS);
    page.setDefaultNavigationTimeout(NAVIGATION_TIMEOUT_MS);
    try {
      await page.goto(`https://${hostname}/`, { waitUntil: "domcontentloaded" });
      await page.waitForTimeout(CONSENT_SETTLE_MS);
      let controls = await inspectConsentControls(page);
      const manage = findConsentControl(controls, "manage");
      const openedSettings = manage ? await clickConsentControl(page, manage) : false;
      if (openedSettings) {
        await page.waitForTimeout(CONSENT_SETTLE_MS);
        controls = await inspectConsentControls(page);
      }
      const providers = [...new Set(PRIVACY_KNOWLEDGE_RULES.map(({ provider }) => provider))];
      const inspection = await inspectVendorToggles(page, providers);
      if (inspection.visibleCount === 0) return { status: "unknown", visibleCount: 0, candidates: [] };
      const capped = inspection.toggles.slice(0, PRIVACY_BROWSER_BUDGET.individualProviders);
      const status = !openedSettings && inspection.visibleCount === 0
        ? "unknown"
        : inspection.unmatchedCount > 0 || capped.length !== inspection.toggles.length
          ? "partial"
          : "complete";
      return { status, visibleCount: inspection.visibleCount, candidates: capped };
    } catch {
      return { status: "unknown", visibleCount: 0, candidates: [] };
    }
  } finally {
    await context.close().catch(() => undefined);
  }
}

async function runVendorControlCheck(
  browser: Browser,
  hostname: string,
  candidate: VendorToggle,
  gate: PrivacyBrowserRequestGate,
  ledger: RequestLedger,
  signal: AbortSignal,
): Promise<PrivacyVendorControlCheck> {
  const unknown: PrivacyVendorControlCheck = {
    provider: candidate.provider,
    status: "unknown",
    declaredLegitimateInterest: candidate.declaredLegitimateInterest,
    toggleCount: candidate.count,
    actionsToDisable: null,
    disabled: null,
    persistedDisabled: null,
    signalHostsAfterDisable: [],
    completedHostsAfterDisable: [],
    cookiesAfterDisable: [],
  };
  if (signal.aborted || gate.hasExceededBudget()) return unknown;
  const context = await browser.newContext({
    acceptDownloads: false,
    colorScheme: "light",
    javaScriptEnabled: true,
    locale: "es-ES",
    serviceWorkers: "block",
    timezoneId: "Europe/Madrid",
    viewport: { width: 1365, height: 768 },
  });
  const flowHosts = await installRequestGate(context, gate, ledger);
  const completedHosts = new Set<string>();
  try {
    const page = await context.newPage();
    page.setDefaultTimeout(ACTION_TIMEOUT_MS);
    page.setDefaultNavigationTimeout(NAVIGATION_TIMEOUT_MS);
    page.on("requestfinished", (request) => {
      const requestHostname = safeHostname(request.url());
      if (requestHostname) completedHosts.add(requestHostname);
    });
    try {
      await page.goto(`https://${hostname}/`, { waitUntil: "domcontentloaded" });
      await page.waitForTimeout(CONSENT_SETTLE_MS);
      let controls = await inspectConsentControls(page);
      const accept = findConsentControl(controls, "accept");
      if (accept) {
        gate.armPreferenceWrite();
        if (!await clickConsentControl(page, accept)) return unknown;
        await page.waitForTimeout(CONSENT_SETTLE_MS);
        controls = await inspectConsentControls(page);
      }
      let toggles = await inspectVendorToggles(page, [candidate.provider]);
      if (toggles.toggles.length === 0) {
        const manage = findConsentControl(controls, "manage");
        if (!manage || !await clickConsentControl(page, manage)) return unknown;
        await page.waitForTimeout(CONSENT_SETTLE_MS);
        controls = await inspectConsentControls(page);
        toggles = await inspectVendorToggles(page, [candidate.provider]);
      }
      const toggle = toggles.toggles.find(({ provider }) => provider === candidate.provider);
      if (!toggle || toggles.unmatchedCount > 0) return unknown;
      const baselineCookies = await captureCookies(context);
      if (!baselineCookies.complete) return unknown;
      const baselineCookieKeys = new Set(baselineCookies.items.map(({ name, domain }) => `${name}\u0000${domain}`));
      const baselineSignalHosts = new Set(flowHosts);
      const baselineCompletedHosts = new Set(completedHosts);
      const disabled = await turnVendorTogglesOff(page, toggle, () => gate.armPreferenceWrite());
      if (!disabled.disabled) return { ...unknown, actionsToDisable: disabled.actions, disabled: false };
      const save = findConsentControl(await inspectConsentControls(page), "save");
      if (save) {
        gate.armPreferenceWrite();
        if (!await clickConsentControl(page, save)) return { ...unknown, actionsToDisable: disabled.actions, disabled: false };
      }
      await page.waitForTimeout(CONSENT_SETTLE_MS);
      try {
        await page.reload({ waitUntil: "domcontentloaded" });
        await page.waitForTimeout(CONSENT_SETTLE_MS);
        const afterReloadControls = await inspectConsentControls(page);
        const manageAfterReload = findConsentControl(afterReloadControls, "manage");
        if (manageAfterReload && await clickConsentControl(page, manageAfterReload)) {
          await page.waitForTimeout(CONSENT_SETTLE_MS);
        }
        const persistedCandidate = (await inspectVendorToggles(page, [candidate.provider])).toggles
          .find(({ provider }) => provider === candidate.provider);
        const persistedDisabled = persistedCandidate ? await areVendorTogglesOff(page, persistedCandidate) : null;
        const cookies = await captureCookies(context);
        if (!cookies.complete || persistedDisabled !== true) {
          return {
            ...unknown,
            actionsToDisable: disabled.actions + Number(Boolean(save)),
            disabled: true,
            persistedDisabled,
            signalHostsAfterDisable: [...flowHosts].filter((item) => !baselineSignalHosts.has(item)).slice(0, MAX_RECORDED_HOSTS),
            completedHostsAfterDisable: [...completedHosts].filter((item) => !baselineCompletedHosts.has(item)).slice(0, MAX_RECORDED_HOSTS),
            cookiesAfterDisable: cookies.items
              .filter(({ name, domain }) => !baselineCookieKeys.has(`${name}\u0000${domain}`))
              .map(({ name, domain }) => ({ name, domain })).slice(0, MAX_RECORDED_NAMES),
          };
        }
        return {
          provider: candidate.provider,
          status: "evaluated",
          declaredLegitimateInterest: candidate.declaredLegitimateInterest,
          toggleCount: toggle.count,
          actionsToDisable: disabled.actions + Number(Boolean(save)),
          disabled: true,
          persistedDisabled: true,
          signalHostsAfterDisable: [...flowHosts].filter((item) => !baselineSignalHosts.has(item)).slice(0, MAX_RECORDED_HOSTS),
          completedHostsAfterDisable: [...completedHosts].filter((item) => !baselineCompletedHosts.has(item)).slice(0, MAX_RECORDED_HOSTS),
          cookiesAfterDisable: cookies.items
            .filter(({ name, domain }) => !baselineCookieKeys.has(`${name}\u0000${domain}`))
            .map(({ name, domain }) => ({ name, domain })).slice(0, MAX_RECORDED_NAMES),
        };
      } catch {
        return { ...unknown, actionsToDisable: disabled.actions + Number(Boolean(save)), disabled: true, persistedDisabled: null };
      }
    } catch {
      return unknown;
    }
  } finally {
    await context.close().catch(() => undefined);
  }
}

function resolveVendorControlCoverage(
  discovery: VendorControlDiscovery,
  checks: readonly PrivacyVendorControlCheck[],
): PrivacyBrowserObservation["vendorControlCoverage"] {
  if (discovery.status === "not_applicable") return "not_applicable";
  if (discovery.status === "unknown") return "unknown";
  if (discovery.status === "partial" || checks.length !== discovery.candidates.length ||
      checks.some(({ status }) => status !== "evaluated")) return "partial";
  return "complete";
}

async function installRequestGate(
  context: BrowserContext,
  gate: PrivacyBrowserRequestGate,
  ledger: RequestLedger,
  markRequestBlocked?: (request: Request) => void,
): Promise<Set<string>> {
  const flowHosts = new Set<string>();
  await context.route("**/*", async (route) => {
    const request = route.request();
    const decision = gate.inspect(request.url(), request.method());
    ledger.requestCount = gate.getRequestCount();
    if (decision.hostname) {
      ledger.signalHosts.add(decision.hostname);
      flowHosts.add(decision.hostname);
      if (decision.thirdParty) ledger.thirdPartyRequestHosts.add(decision.hostname);
    }
    if (!decision.allowed) {
      markRequestBlocked?.(request);
      ledger.blockedRequestCount += 1;
      if (decision.reason === "request_budget_exceeded") ledger.overflow = true;
      await route.abort("blockedbyclient").catch(() => undefined);
      return;
    }
    await route.fallback().catch(() => undefined);
  });
  await context.routeWebSocket("**/*", (socket) => {
    const decision = gate.inspect(socket.url(), "WEBSOCKET");
    ledger.requestCount = gate.getRequestCount();
    if (decision.hostname) {
      ledger.signalHosts.add(decision.hostname);
      flowHosts.add(decision.hostname);
      if (decision.thirdParty) ledger.thirdPartyRequestHosts.add(decision.hostname);
    }
    ledger.blockedRequestCount += 1;
    if (decision.reason === "request_budget_exceeded") ledger.overflow = true;
    socket.close({ code: 1008, reason: "websocket_blocked" });
  });
  return flowHosts;
}

async function captureFlow(
  context: BrowserContext,
  page: Page,
  base: PrivacyBrowserFlowObservation,
  timeline: PrivacyRequestTimeline,
  ledger: RequestLedger,
  flowHosts: Set<string>,
  completedHosts: Set<string>,
  finalSnapshotOverride?: PrivacyBrowserStateSnapshot,
): Promise<PrivacyBrowserFlowObservation> {
  const finalSnapshot = finalSnapshotOverride ?? await captureStateSnapshot(context, page, timeline.elapsed(), MAX_RECORDED_NAMES);
  const trackedRequests = await timeline.snapshot();
  const phaseEvidence = { ...base.phaseEvidence,
    networkRequests: trackedRequests.events,
    networkRequestsComplete: trackedRequests.complete,
  };
  const cookiesAfterChoice = base.cookiesAfterChoice.length > 0 ? base.cookiesAfterChoice : finalSnapshot.cookies;
  const storageKeysAfterChoice = base.storageKeysAfterChoice.length > 0 ? base.storageKeysAfterChoice : finalSnapshot.storageKeys;
  if (!finalSnapshot.cookieReadComplete || !finalSnapshot.storageReadComplete || ledger.signalHosts.size > MAX_RECORDED_HOSTS) {
    ledger.overflow = true;
  }
  return {
    ...base,
    status: finalSnapshot.cookieReadComplete && finalSnapshot.storageReadComplete ? base.status : "unknown",
    cookieReadComplete: finalSnapshot.cookieReadComplete,
    storageReadComplete: finalSnapshot.storageReadComplete,
    signalHostsAfterChoice: base.signalHostsAfterChoice.length > 0
      ? base.signalHostsAfterChoice
      : [...flowHosts].slice(0, MAX_RECORDED_HOSTS),
    completedHostsAfterChoice: [...completedHosts].slice(0, MAX_RECORDED_HOSTS),
    cookiesAfterChoice,
    storageKeysAfterChoice,
    phaseEvidence,
  };
}

function limitPhaseSnapshot(snapshot: PrivacyBrowserStateSnapshot): PrivacyBrowserStateSnapshot {
  return {
    ...snapshot,
    cookies: snapshot.cookies.slice(0, MAX_PHASE_SNAPSHOT_NAMES),
    storageKeys: snapshot.storageKeys.slice(0, MAX_PHASE_SNAPSHOT_NAMES),
    cookieReadComplete: snapshot.cookieReadComplete && snapshot.cookies.length <= MAX_PHASE_SNAPSHOT_NAMES,
    storageReadComplete: snapshot.storageReadComplete && snapshot.storageKeys.length <= MAX_PHASE_SNAPSHOT_NAMES,
  };
}

async function captureStateSnapshot(
  context: BrowserContext,
  page: Page,
  capturedAtMs: number,
  maxNames = MAX_PHASE_SNAPSHOT_NAMES,
): Promise<PrivacyBrowserStateSnapshot> {
  const [cookies, storage] = await Promise.all([captureCookies(context, maxNames), captureStorageKeys(page, maxNames)]);
  return {
    capturedAtMs,
    cookies: cookies.items,
    storageKeys: storage.items,
    cookieReadComplete: cookies.complete,
    storageReadComplete: storage.complete,
  };
}

async function captureCookies(
  context: BrowserContext,
  maxNames = MAX_RECORDED_NAMES,
): Promise<{ items: PrivacyBrowserFlowObservation["cookiesAfterChoice"]; complete: boolean }> {
  try {
    const cookies = await context.cookies();
    const complete = cookies.length <= maxNames;
    return { items: cookies.slice(0, maxNames).map(({ name, domain, secure, httpOnly }) => ({
      name: safeName(name),
      domain: safeName(domain.replace(/^\./u, "").toLowerCase()),
      secure,
      httpOnly,
    })).filter(({ name, domain }) => name !== "" && domain !== ""), complete };
  } catch {
    return { items: [], complete: false };
  }
}

async function captureStorageKeys(
  page: Page,
  maxNames = MAX_RECORDED_NAMES,
): Promise<{ items: PrivacyBrowserFlowObservation["storageKeysAfterChoice"]; complete: boolean }> {
  const items: PrivacyBrowserFlowObservation["storageKeysAfterChoice"] = [];
  let complete = true;
  for (const frame of page.frames()) {
    const domain = safeHostname(frame.url());
    if (!domain) continue;
    try {
      const result = await frame.evaluate(async () => {
        const entries: Array<{ name: string; kind: "local" | "session" | "indexeddb" | "cache" | "window-name" }> = [];
        let frameComplete = true;
        try {
          for (let index = 0; index < localStorage.length; index += 1) {
            const name = localStorage.key(index);
            if (name) entries.push({ name, kind: "local" });
          }
          for (let index = 0; index < sessionStorage.length; index += 1) {
            const name = sessionStorage.key(index);
            if (name) entries.push({ name, kind: "session" });
          }
        } catch {
          frameComplete = false;
        }
        try {
          if (typeof indexedDB.databases !== "function") frameComplete = false;
          else for (const database of await indexedDB.databases()) {
            if (database.name) entries.push({ name: database.name, kind: "indexeddb" });
          }
        } catch {
          frameComplete = false;
        }
        try {
          if (typeof caches?.keys !== "function") frameComplete = false;
          else for (const cacheName of await caches.keys()) entries.push({ name: cacheName, kind: "cache" });
        } catch {
          frameComplete = false;
        }
        if (window.name) entries.push({ name: "window.name", kind: "window-name" });
        return { entries, complete: frameComplete };
      });
      complete &&= result.complete;
      items.push(...result.entries.map(({ name, kind }) => ({ name: safeName(name), domain, kind }))
        .filter(({ name }) => name !== ""));
    } catch {
      complete = false;
    }
  }
  if (items.length > maxNames) complete = false;
  return { items: items.slice(0, maxNames), complete };
}

function safeHostname(urlInput: string): string | null {
  try {
    const url = new URL(urlInput);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    return normalizeHostname(url.hostname);
  } catch {
    return null;
  }
}

function safeName(value: string): string {
  return value.length <= 100 && /^[\p{L}\p{N}_.:@+-]+$/u.test(value) ? value : "";
}
