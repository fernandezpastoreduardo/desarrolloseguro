import { describe, expect, it, vi } from "vitest";
import { ServiceUnavailableException } from "@nestjs/common";
import {
  DevelopmentSecurityHealthController,
  DevelopmentSecurityHealthService,
} from "./development-security-api.module.js";

describe("DevelopmentSecurityHealthService", () => {
  it("reports whether the isolated storage is reachable", async () => {
    const scanStore = { healthCheck: vi.fn().mockResolvedValue(true) };
    const service = new DevelopmentSecurityHealthService({ scanStore });

    await expect(service.isStorageAvailable()).resolves.toBe(true);
    expect(scanStore.healthCheck).toHaveBeenCalledOnce();
  });
});

describe("DevelopmentSecurityHealthController", () => {
  it("returns an OK status when storage is reachable", async () => {
    const health = new DevelopmentSecurityHealthService({
      scanStore: { healthCheck: vi.fn().mockResolvedValue(true) },
    });
    const controller = new DevelopmentSecurityHealthController(health);

    await expect(controller.getHealth()).resolves.toEqual({ status: "ok" });
  });

  it("returns service unavailable when storage is unreachable", async () => {
    const health = new DevelopmentSecurityHealthService({
      scanStore: { healthCheck: vi.fn().mockResolvedValue(false) },
    });
    const controller = new DevelopmentSecurityHealthController(health);

    try {
      await controller.getHealth();
      throw new Error("expected_storage_unavailable");
    } catch (error) {
      expect(error).toBeInstanceOf(ServiceUnavailableException);
      if (error instanceof ServiceUnavailableException) {
        expect(error.getStatus()).toBe(503);
        expect(error.message).toBe("development_security_unavailable");
      }
    }
  });
});
