import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { IsolatedTransportV1Executor } from "./isolated-transport-v1-executor.js";

const CHILD_FIXTURE = fileURLToPath(
  new URL("../test/fixtures/transport-v1-executor-child.mjs", import.meta.url),
);

describe("IsolatedTransportV1Executor", () => {
  it("sends only profile data and does not inherit coordinator environment", async () => {
    const previous = process.env.DS_TEST_EXECUTOR_SECRET;
    process.env.DS_TEST_EXECUTOR_SECRET = "coordinator-secret-fixture";
    try {
      const executor = new IsolatedTransportV1Executor({ entrypoint: CHILD_FIXTURE });
      const claimedJob = {
        id: "d1d1d1d1-d1d1-41d1-81d1-d1d1d1d1d1d1",
        hostname: " SAMPLE.EXAMPLE.NET. ",
        targetUrl: null,
        profileVersion: "transport-v1",
        trigger: "requested",
        attempts: 1,
        leaseToken: "coordinator-lease-fixture",
        leaseUntil: new Date("2026-11-10T12:30:00.000Z"),
      } as const;
      const result = await executor.execute(
        claimedJob,
        new AbortController().signal,
      );

      expect(result.scannerVersion).toBe("transport-v1-network-adapter-1");
      expect(result.metrics).toEqual({
        requestsCount: 1,
        bytesCount: 42,
        durationMs: 0,
        pagesCount: 0,
      });
      expect(result.checks).toHaveLength(5);
      expect(result.startedAt).toBeInstanceOf(Date);
      expect(JSON.stringify(result)).not.toContain("coordinator-secret-fixture");
      expect(JSON.stringify(result)).not.toContain("coordinator-lease-fixture");
    } finally {
      if (previous === undefined) delete process.env.DS_TEST_EXECUTOR_SECRET;
      else process.env.DS_TEST_EXECUTOR_SECRET = previous;
    }
  });

  it("kills the child when the coordinator cancels the scan", async () => {
    const controller = new AbortController();
    const executor = new IsolatedTransportV1Executor({
      entrypoint: CHILD_FIXTURE,
      timeoutMs: 5_000,
    });
    const request = executor.execute(
      {
        hostname: "sample.example.net",
        targetUrl: null, profileVersion: "transport-v1",
      },
      controller.signal,
    );
    controller.abort();

    await expect(request).rejects.toThrow("request_aborted");
  });
});
