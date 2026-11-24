import { afterEach, describe, expect, it, vi } from "vitest";
import {
  areVendorTogglesOff,
  clickConsentControl,
  findConsentControl,
  inspectConsentControls,
  inspectVendorToggles,
  turnVendorTogglesOff,
  type VendorToggle,
} from "./privacy-consent-controls.js";

afterEach(() => vi.unstubAllGlobals());

describe("privacy consent controls", () => {
  it("classifies visible first-layer actions and rejects form submissions", async () => {
    installDomGlobals();
    const page = makePage([
      new MockButton("Aceptar todas"),
      new MockButton("Rechazar todo"),
      new MockButton("Preferencias"),
      new MockButton("Guardar preferencias"),
      new MockButton("Aceptar", true, true),
      new MockButton("Oculto", false),
    ]);

    const controls = await inspectConsentControls(page as never);
    expect(controls.map(({ kind, safeToClick }) => [kind, safeToClick])).toEqual([
      ["accept", true], ["reject", true], ["manage", true], ["save", true], ["accept", false],
    ]);
    expect(findConsentControl(controls, "accept")?.label).toBe("Aceptar todas");
    expect(findConsentControl(controls, "save")?.kind).toBe("save");
    expect(findConsentControl(controls, "reject")).toMatchObject({ kind: "reject", safeToClick: true });
    expect(await clickConsentControl(page as never, controls[4]!)).toBe(false);
    expect(await clickConsentControl(page as never, controls[0]!)).toBe(true);
  });

  it("does not classify a generic permission button as a cookie-consent prompt", async () => {
    installDomGlobals();
    const permissionButton = new MockButton("Allow notifications");
    Object.defineProperty(permissionButton, "parentElement", {
      value: { tagName: "DIV", className: "notification-permissions", textContent: "Allow notifications", getAttribute: () => null },
    });
    expect(await inspectConsentControls(makePage([permissionButton]) as never)).toEqual([]);
  });

  it("attributes visible provider switches by row and records declared legitimate interest", async () => {
    installDomGlobals();
    const page = makePage([
      new MockToggle("Google Analytics — Interés legítimo", true),
      new MockToggle("Google Analytics — Estadísticas", true),
      new MockToggle("Otro proveedor", true),
      new MockToggle("Google Analytics oculto", true, false),
    ]);

    const result = await inspectVendorToggles(page as never, ["Google Analytics"]);
    expect(result.visibleCount).toBe(3);
    expect(result.unmatchedCount).toBe(1);
    expect(result.toggles).toEqual([{
      provider: "Google Analytics",
      indices: [0, 1],
      count: 2,
      enabled: true,
      declaredLegitimateInterest: true,
    }]);
  });

  it("disables every matched switch and verifies its resulting state", async () => {
    installDomGlobals();
    const toggles = [new MockToggle("Google Analytics", true), new MockToggle("Google Analytics", true)];
    const page = makePage(toggles);
    const provider: VendorToggle = {
      provider: "Google Analytics",
      indices: [0, 1],
      count: 2,
      enabled: true,
      declaredLegitimateInterest: false,
    };
    const beforeToggle = vi.fn();

    expect(await turnVendorTogglesOff(page as never, provider, beforeToggle)).toEqual({ disabled: true, actions: 2 });
    expect(beforeToggle).toHaveBeenCalledTimes(2);
    expect(await areVendorTogglesOff(page as never, provider)).toBe(true);
    expect(await turnVendorTogglesOff(page as never, provider)).toEqual({ disabled: true, actions: 0 });
  });

  it("leaves a control unknown when its state cannot be read or a click fails", async () => {
    installDomGlobals();
    const page = makePage([new MockToggle("Google Analytics", null)]);
    const provider: VendorToggle = {
      provider: "Google Analytics",
      indices: [0],
      count: 1,
      enabled: null,
      declaredLegitimateInterest: null,
    };
    expect(await turnVendorTogglesOff(page as never, provider)).toEqual({ disabled: false, actions: 0 });
    expect(await areVendorTogglesOff(page as never, provider)).toBe(null);

    const brokenPage = makePage([new MockToggle("Google Analytics", true, true, true)]);
    expect(await turnVendorTogglesOff(brokenPage as never, { ...provider, indices: [0] })).toEqual({ disabled: false, actions: 0 });
    expect(findConsentControl([], "accept")).toBeUndefined();
  });
});

function installDomGlobals(): void {
  vi.stubGlobal("HTMLElement", MockElement);
  vi.stubGlobal("HTMLButtonElement", MockButton);
  vi.stubGlobal("HTMLInputElement", MockToggle);
  vi.stubGlobal("getComputedStyle", (element: MockElement) => ({
    display: element.visible ? "block" : "none",
    visibility: "visible",
    opacity: "1",
  }));
  vi.stubGlobal("document", {
    getElementById: () => null,
  });
}

function makePage(elements: MockElement[]) {
  return {
    locator: vi.fn(() => ({
      evaluateAll: vi.fn(async (callback: (items: unknown[], providers?: string[]) => unknown, providers?: string[]) => callback(elements, providers)),
      nth: vi.fn((index: number) => ({
        click: vi.fn(async () => {
          const element = elements[index]!;
          if (element.clickFails) throw new Error("click failed");
          if (element instanceof MockToggle && element.checked !== null) element.checked = !element.checked;
          element.clicked = true;
        }),
        evaluate: vi.fn(async (callback: (element: MockElement) => unknown) => callback(elements[index]!)),
      })),
    })),
  };
}

class MockElement {
  readonly tagName: string;
  readonly className = "consent-controls";
  readonly parentElement = { tagName: "DIV", className: "consent-controls", getAttribute: () => null };
  clicked = false;

  constructor(readonly text: string, readonly visible = true, readonly clickFails = false) {
    this.tagName = this instanceof MockButton ? "BUTTON" : "INPUT";
  }

  get innerText(): string { return this.text; }
  get textContent(): string { return this.text; }
  getBoundingClientRect(): DOMRect { return { width: this.visible ? 100 : 0, height: 30 } as DOMRect; }
  getAttribute(name: string): string | null { return name === "aria-checked" ? null : null; }
  closest(selector: string): null | object { return selector === "form" && this.clickFails ? {} : null; }
}

class MockButton extends MockElement {
  readonly type = "button";
}

class MockToggle extends MockElement {
  readonly type = "checkbox";
  readonly labels = null;

  constructor(text: string, public checked: boolean | null, visible = true, clickFails = false) {
    super(text, visible, clickFails);
  }

  override getAttribute(name: string): string | null { return name === "aria-checked" && this.checked !== null ? String(this.checked) : null; }
  override closest(selector: string): null | { textContent: string } {
    return selector.includes("data-provider") || selector === "li" || selector === "fieldset" || selector === "[role=group]"
      ? { textContent: this.text }
      : null;
  }
}
