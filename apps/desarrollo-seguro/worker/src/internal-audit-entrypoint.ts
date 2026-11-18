import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createInternalAuditRuntime } from "./internal-audit-runtime.js";
import type { InternalAuditReport } from "@desarrolloseguro/core";

export function formatInternalAuditCompletion(report: InternalAuditReport): string {
  return JSON.stringify({
    event: "internal_audit_completed",
    policyVersion: report.policyVersion,
    auditRef: report.auditRef,
    observedAt: report.observedAt,
    status: report.assessment.status,
    internalScore: report.assessment.score,
    externalScore: null,
    assessedCriteria: report.assessment.assessedCriteria,
    totalCriteria: report.assessment.totalCriteria,
    categories: report.assessment.categories,
  });
}

async function main(): Promise<void> {
  try {
    const runtime = createInternalAuditRuntime(process.env);
    const result = await runtime.run();
    if (result.status === "completed") {
      process.stdout.write(`${formatInternalAuditCompletion(result.report)}\n`);
      return;
    }
    process.stderr.write(`internal_audit_failed reason=${result.reasonCode} completed=${result.completedOperations}\n`);
    process.exitCode = 1;
  } catch (error) {
    const code = error instanceof Error && /^[a-z0-9_]+$/u.test(error.message)
      ? error.message
      : "internal_audit_startup_failed";
    process.stderr.write(`${code}\n`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
