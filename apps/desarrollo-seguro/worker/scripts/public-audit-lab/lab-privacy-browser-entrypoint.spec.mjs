import { describe, expect, it, vi } from "vitest";
import {
  createLabBrowserLaunchers,
  parseLabPrivacyBrowserInput,
} from "./lab-privacy-browser-entrypoint.mjs";

const RUN_ID = "7f2e9120-29dc-4c55-8568-9d3773b9f006";
const HOSTNAME = `scan-${RUN_ID}.example.net`;

describe("public audit lab privacy browser entrypoint", () => {
  it("keeps the browser request URL path and query within the synthetic hostname", () => {
    expect(parseLabPrivacyBrowserInput({
      protocolVersion: 1,
      requestId: RUN_ID,
      hostname: HOSTNAME,
      targetUrl: `https://${HOSTNAME}/careers?campaign=summer&lab=${RUN_ID}`,
    })).toEqual({
      protocolVersion: 1,
      requestId: RUN_ID,
      hostname: HOSTNAME,
      targetUrl: `https://${HOSTNAME}/careers?campaign=summer&lab=${RUN_ID}`,
    });
  });

  it("rejects external hostnames and malformed coordinator payloads", () => {
    expect(() => parseLabPrivacyBrowserInput({
      protocolVersion: 1,
      requestId: RUN_ID,
      hostname: HOSTNAME,
      targetUrl: "https://example.net/careers",
    })).toThrow("lab_privacy_browser_request_invalid");
    expect(() => parseLabPrivacyBrowserInput({
      protocolVersion: 1,
      requestId: RUN_ID,
      hostname: HOSTNAME,
      unexpected: true,
    })).toThrow("lab_privacy_browser_request_invalid");
  });

  it("adds only the self-signed fixture trust flag and preserves observer launch options", async () => {
    const playwrightLaunch = vi.fn(async (options) => options);
    const puppeteerLaunch = vi.fn(async (options) => options);
    const { launchPlaywright, launchPuppeteer } = createLabBrowserLaunchers({
      playwright: { launch: playwrightLaunch },
      puppeteerCore: { launch: puppeteerLaunch },
    });

    const playwrightOptions = await launchPlaywright({
      headless: true,
      args: ["--disable-background-networking"],
      proxy: { server: "http://privacy-egress:3128" },
    });
    const puppeteerOptions = await launchPuppeteer({
      headless: true,
      args: ["--no-sandbox"],
      executablePath: "/usr/bin/chromium",
    });

    expect(playwrightOptions).toEqual({
      headless: true,
      args: ["--disable-background-networking", "--ignore-certificate-errors"],
      proxy: { server: "http://privacy-egress:3128" },
    });
    expect(puppeteerOptions).toEqual({
      headless: true,
      args: ["--no-sandbox", "--ignore-certificate-errors"],
      executablePath: "/usr/bin/chromium",
    });
    expect(playwrightLaunch).toHaveBeenCalledOnce();
    expect(puppeteerLaunch).toHaveBeenCalledOnce();
  });
});
