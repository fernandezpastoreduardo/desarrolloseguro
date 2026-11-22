import type { ScanRunInput } from "@desarrolloseguro/persistence";
import type { ClaimedScanJob } from "@desarrolloseguro/persistence";
import type { ScanExecutor } from "./scan-job-processor.js";
import { ProcessorAuditorClient } from "./processor-auditor-client.js";

export class ProcessorAuditorScanExecutor implements ScanExecutor {
  constructor(
    private readonly scanExecutor: ScanExecutor,
    private readonly auditor: ProcessorAuditorClient,
  ) {}

  assertReady(): Promise<void> {
    return this.scanExecutor.assertReady?.() ?? Promise.resolve();
  }

  async execute(
    job: ClaimedScanJob,
    signal: AbortSignal,
  ): Promise<Omit<ScanRunInput, "jobId" | "leaseToken" | "hostname" | "profileVersion">> {
    const result = await this.scanExecutor.execute(job, signal);
    if (job.hostname !== "grumphya.com") return result;
    const processorTransparencyAssessment = await this.auditor.read(signal);
    return { ...result, processorTransparencyAssessment };
  }
}
