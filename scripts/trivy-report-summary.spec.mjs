import assert from "node:assert/strict";
import test from "node:test";

import { summarizeTrivyReports } from "./trivy-report-summary.mjs";

test("prints blocking vulnerabilities by image and returns a failing status", () => {
  const summary = summarizeTrivyReports([
    {
      fileName: "api.json",
      report: {
        ArtifactName: "desarrolloseguro-api:sha",
        Results: [
          {
            Vulnerabilities: [
              {
                VulnerabilityID: "CVE-2026-1234",
                PkgName: "example",
                InstalledVersion: "1.0.0",
                FixedVersion: "1.0.1",
                Severity: "HIGH",
              },
              {
                VulnerabilityID: "CVE-2026-2345",
                PkgName: "other",
                InstalledVersion: "2.0.0",
                Severity: "MEDIUM",
              },
            ],
          },
        ],
      },
    },
  ]);

  assert.equal(summary.failed, true);
  assert.match(summary.lines.join("\n"), /desarrolloseguro-api:sha/);
  assert.match(summary.lines.join("\n"), /CVE-2026-1234 HIGH example 1\.0\.0 -> 1\.0\.1/);
  assert.doesNotMatch(summary.lines.join("\n"), /CVE-2026-2345/);
});

test("passes when reports have no high or critical vulnerabilities", () => {
  const summary = summarizeTrivyReports([
    {
      fileName: "web.json",
      report: { ArtifactName: "desarrolloseguro-web:sha", Results: [] },
    },
  ]);

  assert.equal(summary.failed, false);
  assert.deepEqual(summary.lines, [
    "desarrolloseguro-web:sha: no HIGH or CRITICAL vulnerabilities.",
    "No HIGH or CRITICAL vulnerabilities found.",
  ]);
});
