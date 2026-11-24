import type { Page, Request } from "playwright";

const MAX_REQUESTS = 30;
const MAX_COOKIE_NAMES_PER_REQUEST = 3;

export type PrivacyRequestPhase = "before_choice" | "after_choice" | "after_reload" | "cmp_inspection" | "after_policy_link";

export type PrivacyRequestEvidence = {
  phaseAtStart: PrivacyRequestPhase;
  responsePhase: PrivacyRequestPhase | null;
  responseAtMs: number | null;
  phaseAtCompletion: PrivacyRequestPhase | null;
  startedAtMs: number;
  completedAtMs: number | null;
  url: string;
  hostname: string;
  method: string;
  resourceType: string;
  responseStatus: number | null;
  blockedByAudit: boolean;
  failed: boolean;
  sentCookieNames: string[];
  receivedCookieNames: string[];
};

/** Stores bounded, value-free network evidence with a monotonic clock per page flow. */
export class PrivacyRequestTimeline {
  private readonly startedAt = performance.now();
  private currentPhase: PrivacyRequestPhase = "before_choice";
  private readonly entries: PrivacyRequestEvidence[] = [];
  private readonly requestEntries = new Map<Request, PrivacyRequestEvidence>();
  private readonly blockedRequests = new WeakSet<Request>();
  private readonly pending = new Set<Promise<void>>();
  private overflowed = false;

  attach(page: Page): void {
    page.on("request", (request) => this.recordRequest(request));
    page.on("response", (response) => this.recordResponse(response.request(), response.status(), response.headersArray()));
    page.on("requestfinished", (request) => this.recordCompletion(request, false));
    page.on("requestfailed", (request) => this.recordCompletion(request, true));
  }

  setPhase(phase: PrivacyRequestPhase): number {
    this.currentPhase = phase;
    return this.elapsed();
  }

  async snapshot(): Promise<{ events: PrivacyRequestEvidence[]; complete: boolean }> {
    while (this.pending.size > 0) await Promise.all([...this.pending]);
    return { events: this.entries.map((entry) => ({ ...entry,
      sentCookieNames: [...entry.sentCookieNames], receivedCookieNames: [...entry.receivedCookieNames],
    })), complete: !this.overflowed };
  }

  elapsed(): number {
    return Math.max(0, Math.round(performance.now() - this.startedAt));
  }

  markBlocked(request: Request): void {
    this.blockedRequests.add(request);
    const entry = this.requestEntries.get(request);
    if (entry) entry.blockedByAudit = true;
  }

  private recordRequest(request: Request): void {
    if (this.entries.length >= MAX_REQUESTS) {
      this.overflowed = true;
      return;
    }
    const requestUrl = safeRequestUrl(request.url());
    if (!requestUrl) return;
    const entry: PrivacyRequestEvidence = {
      phaseAtStart: this.currentPhase,
      responsePhase: null,
      responseAtMs: null,
      phaseAtCompletion: null,
      startedAtMs: this.elapsed(),
      completedAtMs: null,
      url: requestUrl.url,
      hostname: requestUrl.hostname,
      method: safeMethod(request.method()),
      resourceType: safeToken(request.resourceType(), 30),
      responseStatus: null,
      blockedByAudit: this.blockedRequests.has(request),
      failed: false,
      sentCookieNames: [],
      receivedCookieNames: [],
    };
    this.entries.push(entry);
    this.requestEntries.set(request, entry);
    this.track(this.readSentCookieNames(request, entry));
  }

  private recordCompletion(request: Request, failed: boolean): void {
    const entry = this.requestEntries.get(request);
    if (!entry || entry.completedAtMs !== null) return;
    entry.completedAtMs = this.elapsed();
    entry.phaseAtCompletion = this.currentPhase;
    entry.failed = failed;
  }

  private recordResponse(request: Request, status: number, headersPromise: Promise<Array<{ name: string; value: string }>>): void {
    const entry = this.requestEntries.get(request);
    if (!entry) return;
    entry.responsePhase = this.currentPhase;
    entry.responseAtMs = this.elapsed();
    entry.responseStatus = status;
    this.track(this.readResponseCookieNames(headersPromise, entry));
  }

  private track(promise: Promise<void>): void {
    const task = promise.catch(() => undefined);
    this.pending.add(task);
    void task.then(() => this.pending.delete(task));
  }

  private async readSentCookieNames(request: Request, entry: PrivacyRequestEvidence): Promise<void> {
    try {
      const headers = await request.allHeaders();
      const result = cookieNames(headers.cookie ?? "");
      entry.sentCookieNames = result.names;
      this.overflowed ||= !result.complete;
    } catch {
      entry.sentCookieNames = [];
    }
  }

  private async readResponseCookieNames(headersPromise: Promise<Array<{ name: string; value: string }>>, entry: PrivacyRequestEvidence): Promise<void> {
    try {
      const headers = await headersPromise;
      const result = headers.filter(({ name }) => name.toLowerCase() === "set-cookie")
        .flatMap(({ value }) => cookieNameFromSetCookie(value));
      entry.receivedCookieNames = result.slice(0, MAX_COOKIE_NAMES_PER_REQUEST);
      this.overflowed ||= result.length > MAX_COOKIE_NAMES_PER_REQUEST;
    } catch {
      entry.responseStatus = null;
      entry.receivedCookieNames = [];
    }
  }
}

function cookieNames(header: string): { names: string[]; complete: boolean } {
  const names = header.split(";").map((part) => part.split("=", 1)[0]?.trim() ?? "")
    .filter(isSafeCookieName);
  return { names: names.slice(0, MAX_COOKIE_NAMES_PER_REQUEST), complete: names.length <= MAX_COOKIE_NAMES_PER_REQUEST };
}

function cookieNameFromSetCookie(header: string): string[] {
  const name = header.split("=", 1)[0]?.trim() ?? "";
  return isSafeCookieName(name) ? [name] : [];
}

function isSafeCookieName(value: string): boolean {
  return value.length <= 100 && /^[\p{L}\p{N}_.:@+-]+$/u.test(value);
}

function safeRequestUrl(input: string): { url: string; hostname: string } | null {
  try {
    const url = new URL(input);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    url.username = "";
    url.password = "";
    url.search = "";
    url.hash = "";
    url.pathname = url.pathname.split("/").map((segment) => normalizePathSegment(segment)).join("/");
    return { url: `${url.origin}${url.pathname}`.slice(0, 300), hostname: url.hostname.toLowerCase() };
  } catch {
    return null;
  }
}

function normalizePathSegment(segment: string): string {
  if (segment === "") return "";
  if (segment.length > 80 || /^\d{6,}$/u.test(segment) || /^[0-9a-f]{20,}$/iu.test(segment) ||
      /^[0-9a-f]{8}-[0-9a-f-]{27,}$/iu.test(segment)) return ":redacted";
  return /^[\p{L}\p{N}_.~%-]+$/u.test(segment) ? segment : ":redacted";
}

function safeMethod(value: string): string {
  return /^[A-Z]{1,16}$/u.test(value) ? value : "OTHER";
}

function safeToken(value: string, maxLength: number): string {
  return value.length <= maxLength && /^[a-z-]+$/u.test(value) ? value : "other";
}
