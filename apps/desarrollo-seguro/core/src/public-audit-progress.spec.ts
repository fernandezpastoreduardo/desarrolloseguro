import { describe, expect, it } from "vitest";
import {
  advancePublicAuditProgress,
  createInitialPublicAuditProgress,
  parsePublicAuditProgress,
  parsePublicAuditProgressEvent,
} from "./public-audit-progress.js";

describe("public audit progress contract", () => {
  it("starts all four report aspects pending", () => {
    expect(createInitialPublicAuditProgress()).toEqual({
      policyVersion: "public-audit-progress-v1",
      aspects: { ethics: "pending", privacy: "pending", security: "pending", performance: "pending" },
    });
  });

  it("parses only the bounded four-aspect progress and events", () => {
    const initial = createInitialPublicAuditProgress();
    expect(parsePublicAuditProgress(initial)).toEqual(initial);
    expect(parsePublicAuditProgress({ ...initial, secret: "value" })).toBeNull();
    expect(parsePublicAuditProgressEvent({ aspect: "privacy", state: "running" }))
      .toEqual({ aspect: "privacy", state: "running" });
    expect(parsePublicAuditProgressEvent({ aspect: "privacy", state: "failed", detail: "error" })).toBeNull();
  });

  it("allows monotonic transitions and rejects regressions", () => {
    const initial = createInitialPublicAuditProgress();
    const running = advancePublicAuditProgress(initial, { aspect: "security", state: "running" });
    expect(running?.aspects.security).toBe("running");
    const complete = advancePublicAuditProgress(running!, { aspect: "security", state: "complete" });
    expect(complete?.aspects.security).toBe("complete");
    expect(advancePublicAuditProgress(complete!, { aspect: "security", state: "running" })).toBeNull();
  });
});
