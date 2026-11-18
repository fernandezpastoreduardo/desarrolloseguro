import assert from "node:assert/strict";
import { test } from "node:test";
import {
  describeCertificationTransition,
  validateCertificationTransition,
} from "./check-certification-transition.mjs";

function activeStatus() {
  return {
    hostname: "grumphya.com",
    lastReport: {
      id: "report-new",
      certification: {
        state: "active",
        latestAssessmentStatus: "eligible",
        certifiedReportId: "report-new",
        score: 92,
      },
    },
  };
}

test("accepts an active certification tied to the latest report", () => {
  assert.deepEqual(validateCertificationTransition(activeStatus()), {
    reportId: "report-new",
    score: 92,
  });
});

test("requires a refreshed report after a scheduled cycle", () => {
  assert.throws(
    () => validateCertificationTransition(activeStatus(), "report-new"),
    { message: "certification_report_not_refreshed" },
  );
});

test("rejects a pending certification without treating it as a transition", () => {
  const status = activeStatus();
  status.lastReport.certification.state = "pending";
  assert.throws(
    () => validateCertificationTransition(status),
    { message: "certification_transition_not_ready" },
  );
});

test("rejects a certification pointing to a different report", () => {
  const status = activeStatus();
  status.lastReport.certification.certifiedReportId = "report-old";
  assert.throws(
    () => validateCertificationTransition(status),
    { message: "certification_transition_inconsistent" },
  );
});

test("formats pending state as safe categorical diagnostics", () => {
  const status = activeStatus();
  status.lastReport.certification.state = "pending";
  status.lastReport.certification.latestAssessmentStatus = "pending";
  status.lastReport.certification.certifiedReportId = null;
  assert.equal(
    describeCertificationTransition(status),
    "report=present certification_state=pending assessment=pending certified_report=none report_refreshed=unknown",
  );
});

test("does not echo arbitrary external values in diagnostics", () => {
  const status = activeStatus();
  status.lastReport.certification.state = "unexpected-secret-value";
  status.lastReport.certification.latestAssessmentStatus = "unexpected-secret-value";
  status.lastReport.certification.certifiedReportId = "secret-report-id";
  assert.equal(
    describeCertificationTransition(status, "report-new"),
    "report=present certification_state=invalid assessment=invalid certified_report=different report_refreshed=no",
  );
});

test("distinguishes a missing certification from an invalid value", () => {
  const status = activeStatus();
  status.lastReport.certification = null;
  assert.equal(
    describeCertificationTransition(status),
    "report=present certification_state=missing assessment=missing certified_report=none report_refreshed=unknown",
  );
});
