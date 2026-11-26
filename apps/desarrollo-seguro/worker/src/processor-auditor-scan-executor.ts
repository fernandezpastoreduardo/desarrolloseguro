import type { ClaimedScanJob } from "@desarrolloseguro/persistence";
import type { ScanExecutor } from "./scan-job-processor.js";
import type { PublicAuditProgressEvent } from "@desarrolloseguro/core";
import { ProcessorAuditorClient } from "./processor-auditor-client.js";
import { assessDevelopmentSecurityProcessorRegistry } from "@desarrolloseguro/core";
import { DEVELOPMENT_SECURITY_PROCESSOR_REGISTRY } from "./development-security-processor-registry.js";
import type { ScanExecutorResult } from "./public-policy-document-boundary.js";
import { withScanFailureStage } from "./runtime-diagnostics.js";

export class ProcessorAuditorScanExecutor implements ScanExecutor {
  constructor(
    private readonly scanExecutor: ScanExecutor,
    private readonly auditor: ProcessorAuditorClient,
    private readonly deploymentRevision: string,
  ) {}

  assertReady(): Promise<void> {
    return this.scanExecutor.assertReady?.() ?? Promise.resolve();
  }

  async execute(
    job: ClaimedScanJob,
    signal: AbortSignal,
    onProgress?: (event: PublicAuditProgressEvent) => Promise<void>,
  ): Promise<ScanExecutorResult> {
    const result = await withScanFailureStage("scan_runtime_executor", () =>
      this.scanExecutor.execute(job, signal, onProgress));
    if (job.hostname === "desarrolloseguro.org") {
      const processorTransparencyAssessment = await withScanFailureStage(
        "processor_registry_assessment",
        () => assessDevelopmentSecurityProcessorRegistry({
          deploymentRevision: this.deploymentRevision,
          registryRevision: DEVELOPMENT_SECURITY_PROCESSOR_REGISTRY.revision,
          processors: DEVELOPMENT_SECURITY_PROCESSOR_REGISTRY.processors,
        }),
      );
      return { ...result, processorTransparencyAssessment };
    }
    if (job.hostname !== "grumphya.com") return result;
    const processorTransparencyAssessment = await withScanFailureStage(
      "processor_auditor_read",
      () => this.auditor.read(signal),
    );
    const internalAuditSummary = await withScanFailureStage(
      "internal_audit_summary",
      () => this.auditor.readInternalAuditSummary(signal),
    );
    return { ...result, processorTransparencyAssessment, internalAuditSummary };
  }
}
