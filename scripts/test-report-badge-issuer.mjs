import assert from "node:assert/strict";
import { issueReportBadge } from "./issue-report-badge.mjs";

const reportId = "8d140e17-68d6-489a-b451-7e87408187ae";
const issuerToken = "private-issuer-token-that-is-at-least-32-characters";
const publicToken = "A".repeat(43);
let observedRequest;

const result = await issueReportBadge(reportId, issuerToken, async (url, options) => {
  observedRequest = { url, options };
  return {
    ok: true,
    json: async () => ({
      hostname: "grumphya.com",
      reportId,
      token: publicToken,
      verifyUrl: `https://desarrolloseguro.org/desarrollo-seguro/verificar.html#token=${publicToken}&hostname=grumphya.com&reportId=${reportId}`,
      expiresAt: "2026-12-11T12:00:00.000Z",
    }),
  };
});

assert.equal(result.token, publicToken);
assert.equal(observedRequest.url, "https://desarrolloseguro.org/api/desarrollo-seguro/v1/badges");
assert.equal(observedRequest.options.cache, "no-store");
assert.equal(observedRequest.options.credentials, "omit");
assert.equal(observedRequest.options.headers.Authorization, `Bearer ${issuerToken}`);
assert.equal(observedRequest.options.body, JSON.stringify({ hostname: "grumphya.com", reportId }));
assert.doesNotMatch(observedRequest.url, /private-issuer-token/u);

await assert.rejects(
  issueReportBadge("not-a-report-id", issuerToken, async () => { throw new Error("fetch_must_not_run"); }),
  { message: "invalid_report_badge_issue_input" },
);
await assert.rejects(
  issueReportBadge(reportId, "too-short", async () => { throw new Error("fetch_must_not_run"); }),
  { message: "invalid_report_badge_issue_input" },
);

await assert.rejects(
  issueReportBadge(reportId, issuerToken, async () => ({
    ok: true,
    json: async () => ({ ...result, hostname: "attacker.example" }),
  })),
  { message: "invalid_report_badge_issue_response" },
);

process.stdout.write("Report badge issuer policy passed.\n");
