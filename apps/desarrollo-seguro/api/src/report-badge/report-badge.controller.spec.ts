import { describe, expect, it, vi } from "vitest";
import { ReportBadgeController } from "./report-badge.controller.js";
import { ReportBadgeService } from "./report-badge.service.js";

describe("ReportBadgeController", () => {
  it("accepts the verification token in a no-store POST body instead of the URL", async () => {
    const service = {
      verify: vi.fn().mockResolvedValue({
        verified: true,
        hostname: "grumphya.com",
        reportId: "8d140e17-68d6-489a-b451-7e87408187ae",
      }),
    };
    const controller = new ReportBadgeController(
      service as unknown as ReportBadgeService,
    );
    const body = {
      token: "A".repeat(43),
      hostname: "grumphya.com",
      reportId: "8d140e17-68d6-489a-b451-7e87408187ae",
    };

    await expect(
      controller.verify(body, "https://grumphya.com", "cross-site"),
    ).resolves.toEqual({
      verified: true,
      hostname: "grumphya.com",
      reportId: "8d140e17-68d6-489a-b451-7e87408187ae",
    });
    expect(service.verify).toHaveBeenCalledWith(
      body.token,
      body.hostname,
      body.reportId,
      "https://grumphya.com",
      "cross-site",
    );
    await expect(
      controller.verify({ ...body, token: 1 }, "https://grumphya.com", "cross-site"),
    ).rejects.toThrow("invalid_report_badge_verification");
  });
});
