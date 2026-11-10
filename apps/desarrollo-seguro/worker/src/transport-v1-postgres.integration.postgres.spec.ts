import { Pool } from "pg";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  PostgresScanStore,
  type EnsureScanResult,
} from "@desarrolloseguro/persistence";
import { ScanJobProcessor } from "./scan-job-processor.js";
import { IsolatedTransportV1Executor } from "./isolated-transport-v1-executor.js";

const TEST_DATABASE_URL = process.env.DS_TEST_DATABASE_URL;
const TEST_POSTGRES_ISOLATED = process.env.DS_TEST_POSTGRES_ISOLATED;
const TEST_HOSTNAME = "transport-v1-isolated-fixture.example.net";
const CHILD_FIXTURE = fileURLToPath(
  new URL("../test/fixtures/transport-v1-executor-child.mjs", import.meta.url),
);

const describeIsolatedPostgres = hasSafeTestTarget() ? describe : describe.skip;

describeIsolatedPostgres.sequential("transport-v1 child process and PostgreSQL", () => {
  let pool: Pool;
  let store: PostgresScanStore;
  let databaseReady = false;

  beforeAll(async () => {
    if (!TEST_DATABASE_URL) return;
    pool = new Pool({ connectionString: TEST_DATABASE_URL, max: 2 });
    store = new PostgresScanStore(pool);
    await store.healthCheck().then((healthy) => {
      if (!healthy) throw new Error("isolated_postgres_unavailable");
    });
    databaseReady = true;
  });

  beforeEach(async () => {
    await clearTestData();
    await store.ensureDomain(TEST_HOSTNAME, "monitored", "transport-v1");
  });

  afterAll(async () => {
    await clearTestData();
    await pool?.end();
  });

  it("sends a credential-free child result through lease validation into a public report", async () => {
    const now = new Date();
    const queued: EnsureScanResult = await store.ensureFreshScan({
      hostname: TEST_HOSTNAME,
      profileVersion: "transport-v1",
      trigger: "requested",
      now,
    });
    expect(queued.kind).toBe("queued");

    const processor = new ScanJobProcessor(
      store,
      new IsolatedTransportV1Executor({ entrypoint: CHILD_FIXTURE }),
      () => new Date(),
      60_000,
    );
    await expect(processor.processNext()).resolves.toBe("completed");

    const snapshot = await store.readPublicDomainSnapshot(TEST_HOSTNAME);
    const reportId = snapshot?.lastReport?.id;
    expect(snapshot?.lastReport).toMatchObject({
      hostname: TEST_HOSTNAME,
      profileVersion: "transport-v1",
      verdict: "inconclusive",
      scope: ["/"],
    });
    expect(reportId).toBeTruthy();

    const report = await store.readPublicReport(reportId ?? "");
    expect(report?.checks).toHaveLength(5);
    expect(report?.checks.every(({ status }) => status === "unknown")).toBe(true);
    expect(JSON.stringify(report)).not.toContain("leaseToken");
  });

  async function clearTestData(): Promise<void> {
    if (!pool || !databaseReady) return;
    await pool.query(
      `TRUNCATE ds_scan_metrics, ds_check_results, ds_scan_runs,
       ds_scan_jobs, ds_domains CASCADE`,
    );
  }
});

function hasSafeTestTarget(): boolean {
  if (TEST_POSTGRES_ISOLATED !== "1" || !TEST_DATABASE_URL) return false;
  try {
    const url = new URL(TEST_DATABASE_URL);
    const databaseName = decodeURIComponent(url.pathname.slice(1));
    return (
      (url.protocol === "postgres:" || url.protocol === "postgresql:") &&
      ["localhost", "127.0.0.1", "::1"].includes(url.hostname) &&
      databaseName.startsWith("development_security_test_") &&
      url.search === "" &&
      url.hash === ""
    );
  } catch {
    return false;
  }
}
