import assert from "node:assert/strict";
import test from "node:test";
import { INFORMATIONAL_CATEGORIES, inspectLighthouseReport, lighthouseChromeFlags, REQUIRED_CATEGORIES } from "./lighthouse-lab.mjs";

function makeReport(scores = {}) {
  return {
    categories: Object.fromEntries([...REQUIRED_CATEGORIES, ...INFORMATIONAL_CATEGORIES].map((id) => [id, { score: (scores[id] ?? 100) / 100 }])),
    audits: {
      "network-requests": {
        details: { items: [{ url: "http://127.0.0.1:4173/app/" }, { url: "data:image/svg+xml,icon" }] },
      },
    },
  };
}

test("requires each gating Lighthouse category to meet the minimum", () => {
  const result = inspectLighthouseReport(makeReport({ performance: 95 }), "http://127.0.0.1:4173");
  assert.deepEqual(result.failures, ["performance: 95 < 96"]);
});

test("rejects a report with a missing category score", () => {
  const report = makeReport();
  delete report.categories.performance;
  const result = inspectLighthouseReport(report, "http://127.0.0.1:4173");
  assert.deepEqual(result.failures, ["performance: missing score"]);
});

test("reports a low SEO score without blocking while the app uses noindex", () => {
  const result = inspectLighthouseReport(makeReport({ seo: 63 }), "http://127.0.0.1:4173");
  assert.equal(result.categories.seo, 63);
  assert.deepEqual(result.failures, []);
});

test("reports missing SEO score without blocking the other categories", () => {
  const report = makeReport();
  delete report.categories.seo;
  const result = inspectLighthouseReport(report, "http://127.0.0.1:4173");
  assert.equal(result.categories.seo, null);
  assert.deepEqual(result.failures, []);
});

test("rejects Lighthouse reports that show a third-party request", () => {
  const report = makeReport();
  report.audits["network-requests"].details.items.push({ url: "https://tracker.example/pixel" });
  const result = inspectLighthouseReport(report, "http://127.0.0.1:4173");
  assert.deepEqual(result.failures, ["privacy: external request to https://tracker.example"]);
});

test("fails closed when network request evidence is missing", () => {
  const report = makeReport();
  delete report.audits["network-requests"];
  const result = inspectLighthouseReport(report, "http://127.0.0.1:4173");
  assert.deepEqual(result.failures, ["privacy: network request evidence is missing"]);
});

test("uses the CI-only Chromium flags needed by the isolated Linux runner", () => {
  assert.equal(
    lighthouseChromeFlags({ ci: true, platform: "linux" }),
    "--headless --disable-extensions --no-sandbox --disable-dev-shm-usage",
  );
  assert.equal(
    lighthouseChromeFlags({ ci: false, platform: "darwin" }),
    "--headless --disable-extensions",
  );
});
