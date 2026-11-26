/* global AbortSignal */
import process from "node:process";
import { randomUUID } from "node:crypto";
import { URL } from "node:url";
import { chromium } from "playwright";
import puppeteer from "puppeteer-core";
import { resolveLighthouseHeadlessShellPath } from "../dist/lighthouse-mobile-profile.js";
import { observePrivacyBehavior } from "../dist/privacy-browser-observer.js";

async function main() {
  const lighthouseBrowser = await puppeteer.launch({
    headless: true,
    executablePath: resolveLighthouseHeadlessShellPath(chromium.executablePath()),
    args: ["--no-sandbox", "--disable-breakpad", "--disable-background-networking", "--disable-dev-shm-usage"],
  });
  await lighthouseBrowser.close();

  const hostname = "solistos.example.org";
  const browserInput = {
    protocolVersion: 1,
    requestId: randomUUID(),
    hostname,
  };

  const observation = await observePrivacyBehavior(browserInput, {
    proxyUrl: "http://127.0.0.1:9",
    signal: AbortSignal.timeout(120_000),
    launchBrowser: async () => {
      const browser = await chromium.launch({
        headless: true,
        args: ["--no-sandbox", "--disable-background-networking", "--disable-dev-shm-usage"],
      });
      const newContext = browser.newContext.bind(browser);
      browser.newContext = async (options) => {
        const context = await newContext(options);
        await context.route("**/*", async (route) => {
          const url = new URL(route.request().url());
          if (url.hostname === hostname) {
            await route.fulfill({ status: 200, contentType: "text/html; charset=utf-8", body: FIXTURE_HTML });
            return;
          }
          if (url.hostname === "www.google-analytics.com") {
            await route.fulfill({ status: 204, body: "" });
            return;
          }
          await route.abort("blockedbyclient");
        });
        return context;
      };
      return browser;
    },
  });

  if (
    observation.status !== "complete" ||
    observation.vendorControlCoverage !== "complete" ||
    observation.vendorControls.length !== 1 ||
    observation.vendorControls[0]?.provider !== "Google Analytics" ||
    observation.vendorControls[0]?.status !== "evaluated" ||
    observation.vendorControls[0]?.disabled !== true ||
    observation.vendorControls[0]?.persistedDisabled !== true ||
    observation.vendorControls[0]?.signalHostsAfterDisable.includes("www.google-analytics.com") ||
    observation.vendorControls[0]?.cookiesAfterDisable.some(({ name }) => name.startsWith("_ga"))
  ) {
    process.stderr.write(`${JSON.stringify({
      error: "privacy_browser_fixture_smoke_failed",
      status: observation.status,
      initial: {
        status: observation.initial.status,
        pageLoaded: observation.initial.pageLoaded,
        consentPromptDetected: observation.initial.consentPromptDetected,
      },
      requestCount: observation.requestCount,
      vendorControlCoverage: observation.vendorControlCoverage,
      vendorControlCount: observation.vendorControlCount,
      vendorControls: observation.vendorControls.map(({ provider, status, toggleCount, disabled, persistedDisabled }) => ({
        provider,
        status,
        toggleCount,
        disabled,
        persistedDisabled,
      })),
    })}\n`);
    process.exitCode = 1;
  } else {
    process.stdout.write("Chromium consent and provider-control fixture passed with network disabled.\n");
  }
}

void main().catch((error) => {
  const code = error instanceof Error ? error.message.slice(0, 100) : "unknown_error";
  process.stderr.write(`${JSON.stringify({ error: "privacy_browser_fixture_smoke_failed", code })}\n`);
  process.exitCode = 1;
});

const FIXTURE_HTML = `<!doctype html>
<html lang="es"><head><meta charset="utf-8"><title>Solistos fixture</title></head>
<body><main><h1>Portada de prueba</h1><div id="consent"></div></main>
<script>
(() => {
  const choiceKey = "fixture-choice";
  const providerKey = "fixture-google-analytics";
  let accepted = localStorage.getItem(choiceKey) === "accept";
  let rejected = localStorage.getItem(choiceKey) === "reject";
  let analyticsEnabled = localStorage.getItem(providerKey) !== "off";
  const root = document.querySelector("#consent");
  const sendAnalytics = () => fetch("https://www.google-analytics.com/g/collect").catch(() => undefined);
  const render = () => {
    if (accepted || rejected) {
      root.innerHTML = '<button type="button">Preferencias</button>';
      root.querySelector("button").addEventListener("click", showPreferences);
      return;
    }
    root.innerHTML = '<button type="button">Aceptar todo</button><button type="button">Rechazar todo</button><button type="button">Preferencias</button>';
    const [accept, reject, preferences] = root.querySelectorAll("button");
    accept.addEventListener("click", () => {
      accepted = true;
      localStorage.setItem(choiceKey, "accept");
      render();
      if (analyticsEnabled) {
        document.cookie = "_ga=fixture; Path=/; SameSite=Lax";
        void sendAnalytics();
      }
    });
    reject.addEventListener("click", () => {
      rejected = true;
      localStorage.setItem(choiceKey, "reject");
      render();
    });
    preferences.addEventListener("click", showPreferences);
  };
  function showPreferences() {
    root.innerHTML = '<ul><li><label><input type="checkbox"><span>Google Analytics — Interés legítimo</span></label></li></ul><button type="button">Guardar preferencias</button>';
    const toggle = root.querySelector('input[type="checkbox"]');
    toggle.checked = analyticsEnabled;
    toggle.addEventListener("change", () => {
      analyticsEnabled = toggle.checked;
      if (!analyticsEnabled) document.cookie = "_ga=; Path=/; Max-Age=0; SameSite=Lax";
    });
    root.querySelector("button").addEventListener("click", () => {
      localStorage.setItem(providerKey, analyticsEnabled ? "on" : "off");
      render();
    });
  }
  render();
})();
</script></body></html>`;
