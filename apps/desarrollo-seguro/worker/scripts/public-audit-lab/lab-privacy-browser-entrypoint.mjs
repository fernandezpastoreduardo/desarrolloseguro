import { Buffer } from "node:buffer";
import process from "node:process";
import { pathToFileURL } from "node:url";
import { chromium } from "playwright";
import puppeteer from "puppeteer-core";
import { parseScanTargetUrl } from "@desarrolloseguro/core";
import { PRIVACY_BROWSER_MAX_RESPONSE_BYTES } from "../../dist/privacy-browser-contract.js";
import { observePrivacyAndPerformance } from "../../dist/privacy-browser-observation.js";
import { observePrivacyBehavior } from "../../dist/privacy-browser-observer.js";
import { observePagePerformance } from "../../dist/performance-browser-observer.js";
import { observeLighthouseMobileProfile } from "../../dist/lighthouse-mobile-profile.js";

const MAX_INPUT_BYTES = 4 * 1024;
const LAB_CERTIFICATE_FLAG = "--ignore-certificate-errors";

/** Builds test-only browser launchers that trust only the local fixture certificate. */
export function createLabBrowserLaunchers({ playwright, puppeteerCore }) {
  return Object.freeze({
    launchPlaywright: (options) => playwright.launch(withFixtureCertificateFlag(options)),
    launchPuppeteer: (options) => puppeteerCore.launch(withFixtureCertificateFlag(options)),
  });
}

function withFixtureCertificateFlag(options) {
  return {
    ...options,
    args: [...(options.args ?? []), LAB_CERTIFICATE_FLAG],
  };
}

/** Keeps the fixture browser protocol identical to the production coordinator. */
export function parseLabPrivacyBrowserInput(value) {
  if (
    !isRecord(value) ||
    Object.keys(value).length !== (Object.hasOwn(value, "targetUrl") ? 4 : 3) ||
    value.protocolVersion !== 1 ||
    typeof value.requestId !== "string" ||
    !/^[0-9a-f-]{36}$/iu.test(value.requestId) ||
    typeof value.hostname !== "string" ||
    value.hostname.length > 253
  ) {
    throw new Error("lab_privacy_browser_request_invalid");
  }
  if (value.targetUrl !== undefined) {
    const target = parseScanTargetUrl(value.targetUrl);
    if (target.hostname !== value.hostname.toLowerCase()) {
      throw new Error("lab_privacy_browser_request_invalid");
    }
    return {
      protocolVersion: 1,
      requestId: value.requestId,
      hostname: value.hostname,
      targetUrl: target.targetUrl,
    };
  }
  return {
    protocolVersion: 1,
    requestId: value.requestId,
    hostname: value.hostname,
  };
}

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function readInput() {
  const chunks = [];
  let receivedBytes = 0;
  for await (const chunk of process.stdin) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    receivedBytes += bytes.byteLength;
    if (receivedBytes > MAX_INPUT_BYTES) throw new Error("lab_privacy_browser_request_invalid");
    chunks.push(bytes);
    if (bytes.includes(10)) break;
  }
  if (receivedBytes === 0) throw new Error("lab_privacy_browser_request_invalid");
  const line = Buffer.concat(chunks).toString("utf8").split("\n", 1)[0];
  return parseLabPrivacyBrowserInput(JSON.parse(line));
}

async function main() {
  const input = await readInput();
  const proxyUrl = process.env.DS_PRIVACY_PROXY_URL ?? "http://privacy-egress:3128";
  const { launchPlaywright, launchPuppeteer } = createLabBrowserLaunchers({
    playwright: chromium,
    puppeteerCore: puppeteer,
  });

  const result = await observePrivacyAndPerformance(input, {
    proxyUrl,
    observePrivacy: (request, options) => observePrivacyBehavior(request, {
      ...options,
      launchBrowser: launchPlaywright,
    }),
    observePerformance: (options) => observePagePerformance({
      ...options,
      launchBrowser: launchPlaywright,
      observeMobileProfile: (mobileOptions) => observeLighthouseMobileProfile({
        ...mobileOptions,
        launchBrowser: launchPuppeteer,
      }),
    }),
    onProgress: (progressEvent) => process.stdout.write(`${JSON.stringify({
      protocolVersion: 1,
      requestId: input.requestId,
      progressEvent,
    })}\n`),
  });

  const serialized = `${JSON.stringify(result)}\n`;
  if (Buffer.byteLength(serialized, "utf8") > PRIVACY_BROWSER_MAX_RESPONSE_BYTES) {
    process.stdout.write(`${JSON.stringify({
      protocolVersion: 1,
      requestId: input.requestId,
      hostname: input.hostname,
      status: "unknown",
      code: "privacy_browser_output_too_large",
    })}\n`);
    return;
  }
  process.stdout.write(serialized);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void main().catch(() => {
    process.stdout.write(`${JSON.stringify({
      protocolVersion: 1,
      status: "unknown",
      code: "privacy_browser_runtime_failed",
    })}\n`);
    process.exitCode = 0;
  });
}
