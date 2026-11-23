import type { ScanRunInput } from "@desarrolloseguro/persistence";
import type { ClaimedScanJob } from "@desarrolloseguro/persistence";
import type { ScanExecutor } from "./scan-job-processor.js";
import { ProcessorAuditorClient } from "./processor-auditor-client.js";
import { assessDevelopmentSecurityProcessorRegistry } from "@desarrolloseguro/core";
import { DEVELOPMENT_SECURITY_PROCESSOR_REGISTRY } from "./development-security-processor-registry.js";

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
  ): Promise<Omit<ScanRunInput, "jobId" | "leaseToken" | "hostname" | "profileVersion">> {
    const result = await this.scanExecutor.execute(job, signal);
    if (job.hostname === "desarrolloseguro.org") {
      return {
        ...result,
        processorTransparencyAssessment: assessDevelopmentSecurityProcessorRegistry({
          deploymentRevision: this.deploymentRevision,
          registryRevision: DEVELOPMENT_SECURITY_PROCESSOR_REGISTRY.revision,
          processors: DEVELOPMENT_SECURITY_PROCESSOR_REGISTRY.processors,
        }),
      };
    }
    if (job.hostname !== "grumphya.com") return result;
    const processorTransparencyAssessment = await this.auditor.read(signal);
    const internalAuditSummary = await this.auditor.readInternalAuditSummary(signal);
    return { ...result, processorTransparencyAssessment, internalAuditSummary };
  }
}
