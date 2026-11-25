import { describe, expect, it, vi } from "vitest";
import type { ClaimedScanJob, ScanJobStore, ScanRunInput } from "@desarrolloseguro/persistence";
import { CatalogAwareScanExecutor } from "./catalog-aware-scan-executor.js";
import { ScanJobProcessor } from "./scan-job-processor.js";
import { readScanFailureDiagnostic } from "./runtime-diagnostics.js";

const JOB: ClaimedScanJob = {
  id: "d1d1d1d1-d1d1-41d1-81d1-d1d1d1d1d1d1",
  hostname: "grumphya.com",
  profileVersion: "domain-v4",
  trigger: "requested",
  attempts: 1,
  leaseToken: "fixture-lease-token",
  leaseUntil: new Date("2026-11-02T10:01:00.000Z"),
};

const RESULT: Omit<ScanRunInput, "jobId" | "leaseToken" | "hostname" | "profileVersion"> = {
  scannerVersion: "domain-v4-network-adapter-4",
  startedAt: new Date("2026-11-02T10:00:00.000Z"),
  completedAt: new Date("2026-11-02T10:00:30.000Z"),
  verdict: "inconclusive",
  scope: ["/"],
  checks: [],
  metrics: { requestsCount: 0, bytesCount: 0, durationMs: 0, pagesCount: 0 },
};

describe("CatalogAwareScanExecutor failure path", () => {
  it("carries a post-runtime catalog failure through ScanJobProcessor persistence and telemetry", async () => {
    const store = makeStore();
    const telemetry = vi.fn();
    const providerCatalog = {
      readActive: vi.fn().mockRejectedValue(new Error("private database failure detail")),
      recordDiscoveredProvider: vi.fn(),
    };
    const executor = new CatalogAwareScanExecutor(
      { execute: vi.fn().mockResolvedValue(RESULT) },
      providerCatalog,
    );
    const processor = new ScanJobProcessor(store, executor, () => new Date(), undefined, telemetry);

    await expect(processor.processNext()).resolves.toBe("retrying");

    const diagnostic = {
      stage: "provider_catalog_initial_read",
      code: "executor_application_failed",
    };
    expect(store.failScan).toHaveBeenCalledWith(
      JOB.id,
      JOB.leaseToken,
      "executor_failed",
      3,
      diagnostic,
    );
    expect(telemetry).toHaveBeenCalledWith(expect.objectContaining({
      type: "scan_job_failure",
      outcome: "retrying",
      failureCode: "executor_failed",
      failureDiagnostic: diagnostic,
    }));
    expect(JSON.stringify(telemetry.mock.calls)).not.toContain("private database failure detail");
  });

  it("distinguishes catalog persistence failures from document mapping failures", async () => {
    const documentUrl = "https://developers.openai.com/api/docs/guides/your-data";
    const result = {
      ...RESULT,
      publicPolicyDiscoveredDocuments: [{
        href: documentUrl,
        anchorText: "Data controls",
        kind: "privacy",
        documentRole: "provider_document",
        sourcePageUrl: "https://grumphya.com/politica-de-privacidad",
        fetchStatus: "fetched",
        sha256: "a".repeat(64),
      }],
    } as never;
    const providerCatalog = {
      readActive: vi.fn().mockResolvedValue({
        catalogVersion: "b".repeat(64),
        providerFacts: [{
          providerId: "openai-api",
          displayName: "OpenAI API",
          officialDocuments: [{
            documentId: "openai-api-data-controls",
            kind: "service",
            title: "Data controls in the OpenAI platform",
            url: documentUrl,
          }],
        }],
        legalRules: [],
        sources: [],
        createdAt: new Date("2026-11-25T00:00:00.000Z"),
      }),
      recordDiscoveredProvider: vi.fn().mockRejectedValue(new Error("private database failure detail")),
    };
    const executor = new CatalogAwareScanExecutor({ execute: vi.fn().mockResolvedValue(result) }, providerCatalog as never);

    let failure: unknown;
    try {
      await executor.execute(JOB, new AbortController().signal);
    } catch (error) {
      failure = error;
    }
    expect(readScanFailureDiagnostic(failure)).toEqual({
      stage: "provider_document_catalog_record",
      code: "executor_application_failed",
    });
    expect(JSON.stringify(failure)).not.toContain("private database failure detail");
    expect(providerCatalog.recordDiscoveredProvider).toHaveBeenCalledOnce();
  });
});

function makeStore(): ScanJobStore & {
  claimNextScan: ReturnType<typeof vi.fn>;
  failScan: ReturnType<typeof vi.fn>;
} {
  return {
    recoverExpiredLeases: vi.fn().mockResolvedValue(0),
    claimNextScan: vi.fn().mockResolvedValue(JOB),
    renewScanLease: vi.fn().mockResolvedValue(true),
    failScan: vi.fn().mockResolvedValue("retrying"),
    completeScan: vi.fn().mockResolvedValue("run-id"),
  };
}
