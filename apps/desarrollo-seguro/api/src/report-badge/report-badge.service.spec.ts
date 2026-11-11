import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { ReportBadgeService } from "./report-badge.service.js";

describe("ReportBadgeService", () => {
  const now = new Date("2026-11-11T12:00:00.000Z");
  const report = { id: "8d140e17-68d6-489a-b451-7e87408187ae", hostname: "grumphya.com", completedAt: now };

  it("issues a random bearer token only for an authorized real report", async () => {
    const store = { issue: vi.fn().mockResolvedValue(true), verify: vi.fn(), revoke: vi.fn() };
    const issuerToken = "a-secret-issuer-token-that-is-long-enough-32";
    const service = new ReportBadgeService(store, { issuerToken }, () => now);
    const result = await service.issue(issuerToken, "grumphya.com", report.id);
    expect(result.token).toMatch(/^[A-Za-z0-9_-]{43}$/u);
    expect(result.verifyUrl).toBe(`https://desarrolloseguro.org/desarrollo-seguro/verificar.html#token=${result.token}&hostname=grumphya.com&reportId=${report.id}`);
    expect(store.issue).toHaveBeenCalledWith(expect.objectContaining({
      hostname: "grumphya.com", reportId: report.id,
      tokenHash: expect.any(String), expiresAt: new Date("2026-12-11T12:00:00.000Z"),
    }));
    expect(store.issue.mock.calls[0]?.[0].tokenHash).not.toBe(result.token);
  });

  it("rejects an invalid issuer credential and non-allowlisted domains", async () => {
    const store = { issue: vi.fn().mockResolvedValue(true), verify: vi.fn(), revoke: vi.fn() };
    const issuerToken = "a-secret-issuer-token-that-is-long-enough-32";
    const service = new ReportBadgeService(store, { issuerToken }, () => now);
    await expect(service.issue("wrong", "grumphya.com", report.id)).rejects.toThrow();
    await expect(service.issue(issuerToken, "example.com", report.id)).rejects.toThrow();
    expect(store.issue).not.toHaveBeenCalled();
  });

  it("verifies token, report, hostname, expiry and revocation through the store", async () => {
    const store = { issue: vi.fn(), verify: vi.fn().mockResolvedValue(true), revoke: vi.fn().mockResolvedValue(true) };
    const service = new ReportBadgeService(store, { issuerToken: "a-secret-issuer-token-that-is-long-enough-32" }, () => now);
    const token = "A".repeat(43);
    const expectedHash = createHash("sha256").update(token).digest("hex");
    await expect(service.verify(token, "grumphya.com", report.id, "https://grumphya.com", "same-site")).resolves.toEqual({ verified: true, hostname: "grumphya.com", reportId: report.id });
    await expect(service.verify(token, "grumphya.com", report.id, "https://desarrolloseguro.org", "same-origin")).resolves.toEqual({ verified: true, hostname: "grumphya.com", reportId: report.id });
    await expect(service.verify(token, "grumphya.com", report.id, undefined, "same-origin")).resolves.toEqual({ verified: true, hostname: "grumphya.com", reportId: report.id });
    expect(store.verify).toHaveBeenCalledWith({ hostname: "grumphya.com", reportId: report.id, tokenHash: expectedHash, at: now });
    await expect(service.verify(token, "example.com", report.id, "https://grumphya.com", "same-site")).resolves.toEqual({ verified: false });
    await expect(service.verify(token, "grumphya.com", report.id, "https://attacker.example", "cross-site")).resolves.toEqual({ verified: false });
    await expect(service.verify(token, "grumphya.com", report.id, undefined, "cross-site")).resolves.toEqual({ verified: false });
    await expect(service.verify("bad", "grumphya.com", report.id, "https://grumphya.com", "same-site")).resolves.toEqual({ verified: false });
    await expect(service.revoke("a-secret-issuer-token-that-is-long-enough-32", token, "grumphya.com", report.id)).resolves.toEqual({ revoked: true });
    expect(store.revoke).toHaveBeenCalledWith({ hostname: "grumphya.com", reportId: report.id, tokenHash: expectedHash, at: now });
  });
});
