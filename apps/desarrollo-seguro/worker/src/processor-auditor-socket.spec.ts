import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { assessProcessorTransparency, toInternalAuditPublicSummary } from "@desarrolloseguro/core";
import { ProcessorAuditorClient } from "./processor-auditor-client.js";
import { startProcessorAuditor } from "./processor-auditor-server.js";

describe("processor auditor Unix socket", () => {
  let directory: string | undefined;
  let server: Awaited<ReturnType<typeof startProcessorAuditor>> | undefined;

  afterEach(async () => {
    await server?.close();
    server = undefined;
    if (directory) await rm(directory, { recursive: true, force: true });
    directory = undefined;
  });

  it("returns only a redacted 14-state summary for the private audit operation", async () => {
    directory = await mkdtemp(join(tmpdir(), "ds-audit-"));
    const socketPath = join(directory, "processor-auditor.sock");
    const uid = process.getuid?.() ?? 0;
    const gid = process.getgid?.() ?? 0;
    const expected = toInternalAuditPublicSummary(null);
    server = await startProcessorAuditor(
      {},
      { socketPath, socketUid: uid, socketGid: gid },
      undefined,
      async () => expected,
    );
    const client = new ProcessorAuditorClient({ socketPath, expectedSocketUid: uid, expectedSocketGid: gid });

    await expect(client.readInternalAuditSummary()).resolves.toEqual(expected);
    expect(expected.criteria).toHaveLength(14);
    expect(Object.keys(expected).sort()).toEqual(["criteria", "observedAt", "policyVersion", "status"]);
  });

  it("returns only the assessment for the fixed inventory operation", async () => {
    directory = await mkdtemp(join(tmpdir(), "ds-processor-auditor-"));
    const socketPath = join(directory, "processor-auditor.sock");
    const uid = process.getuid?.() ?? 0;
    const gid = process.getgid?.() ?? 0;
    const expected = assessProcessorTransparency({ status: "auditor_error" });
    server = await startProcessorAuditor({}, { socketPath, socketUid: uid, socketGid: gid }, async () => expected);
    const client = new ProcessorAuditorClient({
      socketPath,
      expectedSocketUid: uid,
      expectedSocketGid: gid,
    });

    await expect(client.read()).resolves.toEqual(expected);
  });
});
