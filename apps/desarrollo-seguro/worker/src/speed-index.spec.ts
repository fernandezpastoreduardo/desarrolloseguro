import { describe, expect, it, vi } from "vitest";
import type { Page } from "playwright";
import { estimateSpeedIndexMs } from "./speed-index.js";

describe("estimateSpeedIndexMs", () => {
  it("decodes screencast frames in a fresh page so the audited page CSP cannot block data images", async () => {
    const frames = [
      { data: "first-frame", timestamp: 1 },
      { data: "last-frame", timestamp: 2 },
    ];
    const decoderPage = {
      evaluate: vi.fn(async () => 1_000),
      close: vi.fn(async () => undefined),
    };
    const context = { newPage: vi.fn(async () => decoderPage) };
    const auditedPage = { context: () => context } as unknown as Page;

    await expect(estimateSpeedIndexMs(auditedPage, frames)).resolves.toBe(1_000);

    expect(context.newPage).toHaveBeenCalledOnce();
    expect(decoderPage.evaluate).toHaveBeenCalledWith(expect.any(Function), frames);
    expect(decoderPage.close).toHaveBeenCalledOnce();
  });

  it("does not create a decoder page without enough captured frames", async () => {
    const newPage = vi.fn();
    const auditedPage = { context: () => ({ newPage }) } as unknown as Page;

    await expect(estimateSpeedIndexMs(auditedPage, [{ data: "only-frame", timestamp: 1 }])).resolves.toBeNull();

    expect(newPage).not.toHaveBeenCalled();
  });
});
