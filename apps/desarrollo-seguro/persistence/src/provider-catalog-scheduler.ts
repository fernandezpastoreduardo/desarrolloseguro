const MADRID_TIME_ZONE = "Europe/Madrid";
const REFRESH_HOUR = 3;
const REFRESH_DAY = 1;
const MAX_TIMER_DELAY_MS = 2_147_000_000;
export const PROVIDER_CATALOG_RETRY_DELAY_MS = 15 * 60 * 1_000;

export function nextProviderCatalogRefresh(now: Date): Date {
  if (!Number.isFinite(now.getTime())) throw new Error("provider_catalog_clock_invalid");
  const parts = madridDateParts(now);
  let year = parts.year;
  let month = parts.month;
  let candidate = madridLocalTimeToUtc(year, month, REFRESH_DAY, REFRESH_HOUR);
  if (candidate.getTime() <= now.getTime()) {
    month += 1;
    if (month > 12) {
      month = 1;
      year += 1;
    }
    candidate = madridLocalTimeToUtc(year, month, REFRESH_DAY, REFRESH_HOUR);
  }
  return candidate;
}

export async function runProviderCatalogScheduler(options: {
  signal: AbortSignal;
  refresh: (scheduledAt: Date) => Promise<void>;
  now?: () => Date;
  retryDelayMs?: number;
  wait?: (delayMs: number, signal: AbortSignal) => Promise<boolean>;
  onError?: () => void;
  onSuccess?: () => void;
}): Promise<void> {
  const now = options.now ?? (() => new Date());
  const retryDelayMs = options.retryDelayMs ?? PROVIDER_CATALOG_RETRY_DELAY_MS;
  const wait = options.wait ?? waitForDelay;
  if (!Number.isSafeInteger(retryDelayMs) || retryDelayMs < 1_000) {
    throw new Error("provider_catalog_retry_delay_invalid");
  }
  let completedLocalDate: string | null = null;
  while (!options.signal.aborted) {
    const scheduledAt = dueOrNextProviderCatalogRefresh(now(), completedLocalDate);
    const delay = scheduledAt.getTime() - now().getTime();
    if (!(await wait(Math.max(0, Math.min(delay, MAX_TIMER_DELAY_MS)), options.signal))) return;
    if (scheduledAt.getTime() > now().getTime()) continue;
    try {
      await options.refresh(scheduledAt);
      completedLocalDate = toMadridLocalDate(scheduledAt);
      options.onSuccess?.();
    } catch {
      options.onError?.();
      if (!(await wait(Math.min(retryDelayMs, MAX_TIMER_DELAY_MS), options.signal))) return;
    }
  }
}

export function toMadridLocalDate(date: Date): string {
  if (!Number.isFinite(date.getTime())) throw new Error("provider_catalog_clock_invalid");
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: MADRID_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map(({ type, value }) => [type, value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function dueOrNextProviderCatalogRefresh(current: Date, completedLocalDate: string | null): Date {
  const local = madridDateTimeParts(current);
  const candidate = madridLocalTimeToUtc(local.year, local.month, REFRESH_DAY, REFRESH_HOUR);
  const candidateDate = toMadridLocalDate(candidate);
  if (local.day === REFRESH_DAY && candidate.getTime() <= current.getTime() &&
      candidateDate !== completedLocalDate) return candidate;
  const next = nextProviderCatalogRefresh(current);
  return completedLocalDate === toMadridLocalDate(next)
    ? madridLocalTimeToUtc(local.month === 12 ? local.year + 1 : local.year, local.month === 12 ? 1 : local.month + 1, REFRESH_DAY, REFRESH_HOUR)
    : next;
}

function madridDateTimeParts(date: Date): { year: number; month: number; day: number } {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: MADRID_TIME_ZONE,
    year: "numeric",
    month: "numeric",
    day: "numeric",
  }).formatToParts(date);
  return {
    year: Number(parts.find(({ type }) => type === "year")?.value),
    month: Number(parts.find(({ type }) => type === "month")?.value),
    day: Number(parts.find(({ type }) => type === "day")?.value),
  };
}

function madridDateParts(date: Date): { year: number; month: number } {
  const { year, month } = madridDateTimeParts(date);
  return { year, month };
}

function madridLocalTimeToUtc(year: number, month: number, day: number, hour: number): Date {
  const targetUtc = Date.UTC(year, month - 1, day, hour);
  let candidate = targetUtc;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const parts = new Intl.DateTimeFormat("en-GB", {
      timeZone: MADRID_TIME_ZONE,
      year: "numeric",
      month: "numeric",
      day: "numeric",
      hour: "numeric",
      minute: "numeric",
      second: "numeric",
      hourCycle: "h23",
    }).formatToParts(new Date(candidate));
    const values = Object.fromEntries(parts.map(({ type, value }) => [type, Number(value)]));
    const renderedAsUtc = Date.UTC(values.year, values.month - 1, values.day, values.hour, values.minute, values.second);
    const offset = renderedAsUtc - candidate;
    candidate = targetUtc - offset;
  }
  return new Date(candidate);
}

function waitForDelay(delayMs: number, signal: AbortSignal): Promise<boolean> {
  if (signal.aborted) return Promise.resolve(false);
  return new Promise((resolve) => {
    const finish = (continueRunning: boolean) => {
      clearTimeout(timer);
      signal.removeEventListener("abort", abort);
      resolve(continueRunning);
    };
    const abort = () => finish(false);
    const timer = setTimeout(() => finish(true), Math.max(0, delayMs));
    signal.addEventListener("abort", abort, { once: true });
  });
}
