import type { Locator, Page } from "playwright";

export const CONSENT_CONTROL_SELECTOR = 'button,[role="button"],input[type="button"],input[type="submit"]';
const VENDOR_TOGGLE_SELECTOR = 'input[type="checkbox"],[role="switch"],[role="checkbox"]';
const ACTION_TIMEOUT_MS = 5_000;

export type ConsentControl = {
  index: number;
  label: string;
  kind: "accept" | "reject" | "manage" | "save";
  parentId: string | null;
  safeToClick: boolean;
};

export type VendorToggle = {
  provider: string;
  indices: number[];
  count: number;
  enabled: boolean | null;
  declaredLegitimateInterest: boolean | null;
};

export type VendorToggleInspection = {
  toggles: VendorToggle[];
  visibleCount: number;
  unmatchedCount: number;
};

export async function inspectConsentControls(page: Page): Promise<ConsentControl[]> {
  return page.locator(CONSENT_CONTROL_SELECTOR).evaluateAll((elements) => {
    const consentContextPattern = /(?:cookie|cookies|consent|consentimiento|privacidad|privacy|protecci[oó]n\s+(?:de\s+)?datos|data\s+protection|rgpd|gdpr|preferencias\s+de\s+cookies|solo\s+(?:las\s+)?esenciales|non-essential\s+cookies)/iu;
    const controls: ConsentControl[] = [];
    for (const [index, element] of elements.entries()) {
      if (!(element instanceof HTMLElement)) continue;
      const rect = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      if (rect.width <= 0 || rect.height <= 0 || style.display === "none" || style.visibility === "hidden" || Number(style.opacity) === 0) continue;
      const label = `${element.getAttribute("aria-label") ?? ""} ${element.innerText ?? element.textContent ?? ""}`.trim().slice(0, 200);
      const normalized = label.toLowerCase();
      let context = element.parentElement;
      const documentBody = typeof document === "undefined" ? null : document.body;
      let hasConsentContext = false;
      let contextDepth = 0;
      while (context && context !== documentBody && contextDepth < 8) {
        const attrs = `${context.getAttribute("id") ?? ""} ${String(context.className ?? "")}`;
        const marker = /(?:cookie|consent|privacy|privacidad|cmp|gdpr|rgpd)/iu.test(attrs);
        const text = context.textContent ?? "";
        if (marker || text.length <= 3_000 && consentContextPattern.test(text)) {
          hasConsentContext = true;
          break;
        }
        context = context.parentElement;
        contextDepth += 1;
      }
      if (!hasConsentContext && consentContextPattern.test(label)) hasConsentContext = true;
      if (!hasConsentContext) continue;
      let kind: ConsentControl["kind"] | null = null;
      if (/\b(aceptar|accept|allow|consentir|permitir|agree)\b/iu.test(normalized)) kind = "accept";
      else if (/\b(rechazar|reject|decline|denegar|solo necesarias|solo esenciales|essential only)\b/iu.test(normalized)) kind = "reject";
      else if (/\b(guardar|save|aplicar|apply|confirmar preferencias|save preferences)\b/iu.test(normalized)) kind = "save";
      else if (/\b(configurar|preferencias|settings|manage|personalizar|customize|opciones)\b/iu.test(normalized)) kind = "manage";
      if (!kind) continue;
      const control = element as HTMLButtonElement | HTMLInputElement;
      const supportedButton = control instanceof HTMLButtonElement || (control instanceof HTMLInputElement && control.type === "button");
      // A <button> without an explicit type defaults to "submit", even when it is
      // not inside a form. Clicking that standalone consent button cannot submit
      // anything; keep actual form controls blocked.
      const formAction = !supportedButton || element.closest("form") !== null;
      const parent = element.parentElement;
      const parentId = parent ? `${parent.tagName.toLowerCase()}:${parent.getAttribute("role") ?? ""}:${parent.className.toString().slice(0, 80)}` : null;
      controls.push({ index, label, kind, parentId, safeToClick: !formAction });
    }
    return controls;
  });
}

export async function inspectVendorToggles(page: Page, knownProviders: readonly string[]): Promise<VendorToggleInspection> {
  return page.locator(VENDOR_TOGGLE_SELECTOR).evaluateAll((elements, providers) => {
    const normalizeText = (value: string) => value.normalize("NFD").replace(/[\u0300-\u036f]/gu, "").toLowerCase();
    const providerNames = providers.map((provider) => ({ provider, normalized: normalizeText(provider) }));
    const byProvider = new Map<string, { indices: number[]; interests: boolean[]; states: Array<boolean | null> }>();
    let visibleCount = 0;
    let unmatchedCount = 0;
    for (const [index, element] of elements.entries()) {
      if (!(element instanceof HTMLElement)) continue;
      const rect = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      if (rect.width <= 0 || rect.height <= 0 || style.display === "none" || style.visibility === "hidden" || Number(style.opacity) === 0) continue;
      visibleCount += 1;
      const input = element instanceof HTMLInputElement ? element : null;
      const ariaChecked = element.getAttribute("aria-checked");
      const enabled = input?.type === "checkbox" ? input.checked
        : ariaChecked === "true" ? true
          : ariaChecked === "false" ? false
            : null;
      const labelledBy = (element.getAttribute("aria-labelledby") ?? "").split(/\s+/u)
        .map((id) => document.getElementById(id)?.textContent ?? "").join(" ");
      const explicitLabel = input?.labels ? Array.from(input.labels).map(({ textContent }) => textContent ?? "").join(" ") : "";
      const label = `${element.getAttribute("aria-label") ?? ""} ${labelledBy} ${explicitLabel} ${element.textContent ?? ""}`.trim();
      const row = element.closest("[data-provider],[data-vendor],fieldset,li,[role=group]") ?? element.parentElement;
      const rowText = `${label} ${row?.textContent ?? ""}`.replace(/\s+/gu, " ").slice(0, 600);
      const normalizedContext = normalizeText(rowText);
      const matches = providerNames.filter(({ normalized }) => normalized.length > 0 && normalizedContext.includes(normalized));
      if (matches.length !== 1) {
        unmatchedCount += 1;
        continue;
      }
      const { provider } = matches[0]!;
      const entry = byProvider.get(provider) ?? { indices: [], interests: [], states: [] };
      entry.indices.push(index);
      entry.interests.push(/inter[eé]s(?:\s+de)?\s+leg[ií]timo|legitimate\s+interest/iu.test(normalizeText(rowText)));
      entry.states.push(enabled);
      byProvider.set(provider, entry);
    }
    return {
      visibleCount,
      unmatchedCount,
      toggles: [...byProvider.entries()].map(([provider, entry]) => ({
        provider,
        indices: entry.indices,
        count: entry.indices.length,
        enabled: entry.states.some((state) => state === true)
          ? true
          : entry.states.length > 0 && entry.states.every((state) => state === false)
            ? false
            : null,
        declaredLegitimateInterest: entry.interests.some(Boolean),
      })),
    };
  }, [...knownProviders]);
}

export async function turnVendorTogglesOff(
  page: Page,
  toggle: VendorToggle,
  beforeToggle?: () => void,
): Promise<{ disabled: boolean; actions: number }> {
  let actions = 0;
  try {
    for (const index of toggle.indices) {
      const locator: Locator = page.locator(VENDOR_TOGGLE_SELECTOR).nth(index);
      const state = await readToggleState(locator);
      if (state === null) return { disabled: false, actions };
      if (state) {
        beforeToggle?.();
        await locator.click({ timeout: ACTION_TIMEOUT_MS });
        actions += 1;
      }
      if (await readToggleState(locator) !== false) return { disabled: false, actions };
    }
    return { disabled: true, actions };
  } catch {
    return { disabled: false, actions };
  }
}

export async function areVendorTogglesOff(page: Page, toggle: VendorToggle): Promise<boolean | null> {
  try {
    for (const index of toggle.indices) {
      const state = await readToggleState(page.locator(VENDOR_TOGGLE_SELECTOR).nth(index));
      if (state === null) return null;
      if (state) return false;
    }
    return true;
  } catch {
    return null;
  }
}

export async function clickConsentControl(page: Page, control: ConsentControl, beforeClick?: () => void): Promise<boolean> {
  if (!control.safeToClick) return false;
  const locator: Locator = page.locator(CONSENT_CONTROL_SELECTOR).nth(control.index);
  try {
    beforeClick?.();
    await locator.click({ timeout: ACTION_TIMEOUT_MS });
    return true;
  } catch {
    return false;
  }
}

export function findConsentControl(controls: ConsentControl[], kind: ConsentControl["kind"]): ConsentControl | undefined {
  return controls.find((control) => control.kind === kind && control.safeToClick);
}

async function readToggleState(locator: Locator): Promise<boolean | null> {
  return locator.evaluate((element) => {
    if (element instanceof HTMLInputElement && element.type === "checkbox") return element.checked;
    const value = element.getAttribute("aria-checked");
    if (value === "true") return true;
    if (value === "false") return false;
    return null;
  });
}
