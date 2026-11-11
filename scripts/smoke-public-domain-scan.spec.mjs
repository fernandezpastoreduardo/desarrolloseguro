import assert from "node:assert/strict";
import { test } from "node:test";
import {
  validateWwwRedirect,
  validateCompletedReport,
} from "./smoke-public-domain-scan.mjs";

function completedStatus() {
  const checks = [
    { controlId: "DS-DNS-01", status: "pass", summary: "DNS válido" },
    { controlId: "DS-TLS-01", status: "pass", summary: "TLS válido" },
    { controlId: "DS-HTTP-01", status: "pass", summary: "HTTP válido" },
    { controlId: "DS-HTTP-01", status: "pass", summary: "HTTP válido" },
    { controlId: "DS-HDR-01", status: "fail", summary: "Faltan cabeceras" },
    { controlId: "DS-PRIV-05", status: "pass", summary: "Sin cookies conocidas" },
  ];
  const criteria = [
    { id: "dns-integrity", status: "pass" },
    { id: "transport-security", status: "pass" },
    { id: "http-availability", status: "pass" },
    { id: "security-headers", status: "fail" },
    { id: "third-party-data-use", status: "unknown" },
    { id: "initial-cookie-risk", status: "pass" },
    { id: "tracking", status: "unknown" },
    { id: "performance", status: "unknown" },
  ];
  return {
    hostname: "grumphya.com",
    lastReport: {
      id: "f7490d2d-2976-4a89-a9a7-001690e873ef",
      profileVersion: "domain-v1",
      scannerVersion: "domain-v1-network-adapter-1",
      completedAt: "2026-11-11T20:00:00.000Z",
      checks,
      ethicsAssessment: {
        score: 82,
        assessedCriteria: 5,
        totalCriteria: 8,
        criteria,
      },
    },
  };
}

test("accepts a refreshed domain-v1 report with observations and scoring", () => {
  const status = completedStatus();
  const report = validateCompletedReport(
    status,
    "previous-report-id",
  );
  assert.equal(report.ethicsAssessment.score, 82);
});

test("accepts www HTTPS redirect to the canonical domain without an exposed port", () => {
  assert.equal(
    validateWwwRedirect(301, "https://desarrolloseguro.org/").href,
    "https://desarrolloseguro.org/",
  );
  assert.throws(
    () => validateWwwRedirect(301, "https://desarrolloseguro.org:8080/"),
    { message: "development_security_www_redirect_bad_target" },
  );
  assert.throws(
    () => validateWwwRedirect(200, null),
    { message: "development_security_www_redirect_missing" },
  );
});

test("rejects reports where network failures were saved as empty unknowns", () => {
  const status = completedStatus();
  status.lastReport.checks = status.lastReport.checks.map((check) => ({
    ...check,
    status: "unknown",
    summary: `Comprobación ${check.controlId}: unknown.`,
  }));
  status.lastReport.ethicsAssessment.score = null;
  status.lastReport.ethicsAssessment.assessedCriteria = 0;

  assert.throws(
    () => validateCompletedReport(status, "previous-report-id"),
    { message: "public_scan_insufficient_observations" },
  );
});

test("rejects reports missing the initial cookie assessment", () => {
  const status = completedStatus();
  const cookieCriterion = status.lastReport.ethicsAssessment.criteria.find(
    ({ id }) => id === "initial-cookie-risk",
  );
  if (!cookieCriterion) throw new Error("cookie_criterion_fixture_missing");
  cookieCriterion.status = "unknown";

  assert.throws(
    () => validateCompletedReport(status, "previous-report-id"),
    { message: "public_scan_ethics_assessment_incomplete" },
  );
});
