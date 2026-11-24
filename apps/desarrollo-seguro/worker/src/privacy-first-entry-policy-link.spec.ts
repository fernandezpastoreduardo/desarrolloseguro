import { afterEach, describe, expect, it, vi } from "vitest";
import { runInNewContext } from "node:vm";
import { detectThirdPartyCookiePresence, inspectFirstEntryPolicyLinks, verifyFirstEntryPolicyDocument } from "./privacy-first-entry-policy-link.js";

afterEach(() => vi.unstubAllGlobals());

const privacyLink = { hostname: "example.org", path: "/privacy", kind: "privacy" as const };

describe("first-entry third-party cookie detection", () => {
  it("uses cookie domains from the clean initial context, not third-party requests", () => {
    expect(detectThirdPartyCookiePresence({
      auditedHostname: "app.www.example.org",
      cookies: [{ domain: ".example.org" }, { domain: "www.example.org" }, { domain: "assets.example.org" }],
      complete: true,
    })).toBe(false);
    expect(detectThirdPartyCookiePresence({
      auditedHostname: "example.org",
      cookies: [{ domain: "analytics.example.net" }],
      complete: true,
    })).toBe(true);
    expect(detectThirdPartyCookiePresence({
      auditedHostname: "example.org",
      cookies: [{ domain: "" }],
      complete: true,
    })).toBeNull();
  });

  it("does not treat an incomplete cookie inventory as proof of absence", () => {
    expect(detectThirdPartyCookiePresence({
      auditedHostname: "example.org",
      cookies: [],
      complete: false,
    })).toBeNull();
  });
});

describe("visible policy link placement", () => {
  it("accepts a visible policy link inside the consent component", async () => {
    const page = makePage({ prompt: true, consentLink: true, footerLink: true, isolatedExecution: true });
    const result = await inspectFirstEntryPolicyLinks(page as never, true);
    expect(result).toMatchObject({
      status: "evaluated",
      consentComponentDetected: true,
      consentComponentLink: { hostname: "example.org", path: "/privacy", kind: "privacy" },
      footerLink: { hostname: "example.org", path: "/footer-privacy", kind: "privacy" },
    });
  });

  it("does not treat a footer-only link as being inside a consent component", async () => {
    const result = await inspectFirstEntryPolicyLinks(makePage({ prompt: true, consentLink: false, footerLink: true }) as never, true);
    expect(result).toMatchObject({ status: "evaluated", consentComponentDetected: true, consentComponentLink: null, footerLink: { path: "/footer-privacy" } });
  });

  it("finds footer legal information without a consent prompt", async () => {
    const result = await inspectFirstEntryPolicyLinks(makePage({ prompt: false, consentLink: false, footerLink: true }) as never, false);
    expect(result).toMatchObject({ status: "evaluated", consentComponentDetected: false, consentComponentLink: null, footerLink: { path: "/footer-privacy" } });
  });

  it("finds the policy link inside an informational cookie notice without consent controls", async () => {
    const result = await inspectFirstEntryPolicyLinks(makePage({ prompt: false, consentLink: true, footerLink: false }) as never, false);
    expect(result).toMatchObject({
      status: "evaluated",
      consentComponentDetected: false,
      informationNoticeLink: { hostname: "example.org", path: "/privacy", kind: "privacy" },
    });
  });

  it("keeps a detected consent interface with an unidentifiable component unknown", async () => {
    const result = await inspectFirstEntryPolicyLinks({ locator: () => { throw new Error("DOM unavailable"); } } as never, true);
    expect(result).toMatchObject({ status: "unknown", consentComponentDetected: null });
  });

  it("checks the visible link destination with a read-only navigation in the caller's fresh context", async () => {
    const goto = vi.fn(async () => ({
      status: () => 200,
      headers: () => ({ "content-type": "text/html; charset=utf-8" }),
      url: () => "https://example.org/privacy",
    }));
    const result = await verifyFirstEntryPolicyDocument({
      goto,
      locator: () => ({ innerText: async () => "Política de privacidad: información sobre el tratamiento de datos personales." }),
      url: () => "https://example.org/",
    } as never, privacyLink);
    expect(result).toBe("accessible");
    expect(goto).toHaveBeenCalledWith("https://example.org/privacy", { waitUntil: "domcontentloaded" });
  });

  it("marks an unavailable legal destination as inaccessible", async () => {
    const result = await verifyFirstEntryPolicyDocument({
      goto: vi.fn(async () => ({ status: () => 404, headers: () => ({ "content-type": "text/html" }), url: () => "https://example.org/privacy" })),
      url: () => "https://example.org/",
    } as never, privacyLink);
    expect(result).toBe("unavailable");
  });

  it("does not call an empty 200 HTML response an accessible legal document", async () => {
    const result = await verifyFirstEntryPolicyDocument({
      goto: vi.fn(async () => ({
        status: () => 200,
        headers: () => ({ "content-type": "text/html; charset=utf-8" }),
        url: () => "https://example.org/privacy",
      })),
      locator: () => ({ innerText: async () => "  \n  " }),
      url: () => "https://example.org/",
    } as never, privacyLink);
    expect(result).toBe("unavailable");
  });
});

function makePage(options: { prompt: boolean; consentLink: boolean; footerLink: boolean; isolatedExecution?: boolean }) {
  class TestElement {
    readonly tagName: string;
    readonly hidden = false;
    readonly className = "";
    readonly parentElement: TestElement | null;
    private readonly attributes: Record<string, string>;

    constructor(tagName: string, attributes: Record<string, string>, parent: TestElement | null, readonly innerText: string) {
      this.tagName = tagName.toUpperCase();
      this.attributes = attributes;
      this.parentElement = parent;
    }
    get textContent(): string { return this.innerText; }
    getBoundingClientRect(): DOMRect { return { width: 50, height: 20 } as DOMRect; }
    getAttribute(name: string): string | null { return this.attributes[name] ?? null; }
    contains(item: TestElement): boolean { return item === this || item.parentElement !== null && this.contains(item.parentElement); }
  }
  class TestHTMLElement extends TestElement {}

  const body = new TestHTMLElement("body", {}, null, "");
  const footer = new TestHTMLElement("footer", {}, body, "");
  const banner = new TestHTMLElement("div", { id: "cookie-banner" }, body, "Usamos cookies");
  const controls = options.prompt ? [
    new TestHTMLElement("button", {}, banner, "Aceptar todas las cookies"),
    new TestHTMLElement("button", {}, banner, "Rechazar no esenciales"),
  ] : [];
  const anchors: TestElement[] = [];
  if (options.consentLink) anchors.push(new TestHTMLElement("a", { href: "/privacy?session=private" }, banner, "Política de privacidad"));
  if (options.footerLink) anchors.push(new TestHTMLElement("a", { href: "/footer-privacy#section" }, footer, "Privacidad"));
  vi.stubGlobal("HTMLElement", TestHTMLElement);
  vi.stubGlobal("Element", TestElement);
  vi.stubGlobal("getComputedStyle", () => ({ display: "block", visibility: "visible", opacity: "1" }));
  vi.stubGlobal("document", {
    body,
    documentElement: new TestHTMLElement("html", {}, null, ""),
    location: { href: "https://example.org/" },
    querySelectorAll: () => controls,
  });
  return {
    locator: () => ({ evaluateAll: <Result, Argument>(callback: (anchors: Element[], argument: Argument) => Result, argument: Argument) => {
      if (options.isolatedExecution) {
        return runInNewContext(`(${callback.toString()})(anchors, argument)`, {
          anchors: anchors as unknown as Element[],
          argument,
          Element: TestElement,
          HTMLElement: TestHTMLElement,
          getComputedStyle: globalThis.getComputedStyle,
          document: globalThis.document,
          URL,
        }) as Result;
      }
      return callback(anchors as unknown as Element[], argument);
    } }),
  };
}
