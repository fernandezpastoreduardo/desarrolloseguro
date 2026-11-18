import { createInternalAuditRuntime } from "./internal-audit-runtime.js";

async function main(): Promise<void> {
  try {
    const runtime = createInternalAuditRuntime(process.env);
    const result = await runtime.run();
    if (result.status === "completed") {
      process.stdout.write(`internal_audit_completed evidence=${result.report.evidence.length} criteria=${result.report.assessment.assessedCriteria}\n`);
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

await main();
