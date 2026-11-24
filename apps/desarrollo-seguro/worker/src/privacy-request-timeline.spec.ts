import { describe, expect, it, vi } from "vitest";
import type { Page, Request } from "playwright";
import { PrivacyRequestTimeline, type PrivacyRequestPhase } from "./privacy-request-timeline.js";

describe("PrivacyRequestTimeline", () => {
  it("records request phases and only cookie names while redacting URL identifiers", async () => {
    const harness = attachTimeline();
    const request = makeRequest("https://user:secret@example.com/account/123456?email=user@example.com#private", {
      cookie: "session_id=secret; preferences=private",
    });

    harness.emit("request", request);
    harness.timeline.setPhase("after_choice");
    harness.emit("response", {
      request: () => request,
      status: () => 204,
      headersArray: () => Promise.resolve([
        { name: "Set-Cookie", value: "quota=secret; Secure" },
        { name: "set-cookie", value: "theme=private; SameSite=Strict" },
        { name: "content-type", value: "text/html" },
      ]),
    });
    harness.timeline.setPhase("after_reload");
    harness.emit("requestfinished", request);

    const snapshot = await harness.timeline.snapshot();
    expect(snapshot.complete).toBe(true);
    expect(snapshot.events).toEqual([expect.objectContaining({
      phaseAtStart: "before_choice",
      responsePhase: "after_choice",
      phaseAtCompletion: "after_reload",
      url: "https://example.com/account/:redacted",
      hostname: "example.com",
      method: "GET",
      resourceType: "document",
      responseStatus: 204,
      sentCookieNames: ["session_id", "preferences"],
      receivedCookieNames: ["quota", "theme"],
      failed: false,
    })]);
    expect(JSON.stringify(snapshot)).not.toContain("secret");
    expect(JSON.stringify(snapshot)).not.toContain("private");
    expect(JSON.stringify(snapshot)).not.toContain("user@example.com");
  });

  it("marks blocked and failed requests and ignores unsafe URLs", async () => {
    const harness = attachTimeline();
    const request = makeRequest("https://example.com/path", {});
    harness.timeline.markBlocked(request);
    harness.emit("request", request);
    harness.emit("requestfailed", request);
    harness.emit("request", makeRequest("file:///etc/passwd", {}));
    harness.emit("request", makeRequest("not a URL", {}));

    const snapshot = await harness.timeline.snapshot();
    expect(snapshot.events).toEqual([expect.objectContaining({ blockedByAudit: true, failed: true })]);
  });

  it("bounds request and cookie evidence and marks the snapshot incomplete", async () => {
    const harness = attachTimeline();
    const request = makeRequest("https://example.com/", {
      cookie: "one=x; two=x; three=x; four=x",
    });
    harness.emit("request", request);
    harness.emit("response", {
      request: () => request,
      status: () => 200,
      headersArray: () => Promise.resolve([
        { name: "set-cookie", value: "one=x" },
        { name: "set-cookie", value: "two=x" },
        { name: "set-cookie", value: "three=x" },
        { name: "set-cookie", value: "four=x" },
      ]),
    });
    for (let index = 0; index < 31; index += 1) harness.emit("request", makeRequest(`https://example.com/${index}`, {}));

    const snapshot = await harness.timeline.snapshot();
    expect(snapshot.events).toHaveLength(30);
    expect(snapshot.complete).toBe(false);
    expect(snapshot.events[0]).toMatchObject({
      sentCookieNames: ["one", "two", "three"],
      receivedCookieNames: ["one", "two", "three"],
    });
  });

  it("uses safe fallbacks for malformed methods and resource types and catches header failures", async () => {
    const harness = attachTimeline();
    const request = makeRequest("https://example.com/", {}, "invalid method", "IMAGE/PNG");
    harness.emit("request", request);
    harness.emit("response", {
      request: () => request,
      status: () => 200,
      headersArray: () => Promise.reject(new Error("headers unavailable")),
    });
    const snapshot = await harness.timeline.snapshot();
    expect(snapshot.events[0]).toMatchObject({ method: "OTHER", resourceType: "other", responseStatus: null, receivedCookieNames: [] });
    expect(snapshot.complete).toBe(true);
  });

  it("records an explicit phase timestamp and rejects unsupported phase values at compile time", () => {
    const timeline = new PrivacyRequestTimeline();
    const phase: PrivacyRequestPhase = "after_policy_link";
    expect(timeline.setPhase(phase)).toBeGreaterThanOrEqual(0);
    expect(timeline.elapsed()).toBeGreaterThanOrEqual(0);
  });
});

function attachTimeline() {
  const timeline = new PrivacyRequestTimeline();
  const listeners = new Map<string, ((value: never) => void)[]>();
  const page = {
    on: (event: string, listener: (value: never) => void) => {
      const entries = listeners.get(event) ?? [];
      entries.push(listener);
      listeners.set(event, entries);
    },
  } as unknown as Page;
  timeline.attach(page);
  return {
    timeline,
    emit: (event: string, value: unknown) => {
      for (const listener of listeners.get(event) ?? []) listener(value as never);
    },
  };
}

function makeRequest(
  url: string,
  headers: Record<string, string>,
  method = "GET",
  resourceType = "document",
): Request {
  return {
    url: () => url,
    allHeaders: vi.fn().mockResolvedValue(headers),
    method: () => method,
    resourceType: () => resourceType,
  } as unknown as Request;
}
