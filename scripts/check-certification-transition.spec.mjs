import assert from "node:assert/strict";
import { test } from "node:test";
import { validateCertificationTransition } from "./check-certification-transition.mjs";

function activeStatus() {
  return {
    hostname: "grumphya.com",
    lastReport: { id: "report-new" },
    certification: {
      state: "active",
      latestAssessmentStatus: "eligible",
      certifiedReportId: "report-new",
      score: 92,
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
  status.certification.state = "pending";
  assert.throws(
    () => validateCertificationTransition(status),
    { message: "certification_transition_not_ready" },
  );
});

test("rejects a certification pointing to a different report", () => {
  const status = activeStatus();
  status.certification.certifiedReportId = "report-old";
  assert.throws(
    () => validateCertificationTransition(status),
    { message: "certification_transition_inconsistent" },
  );
});
