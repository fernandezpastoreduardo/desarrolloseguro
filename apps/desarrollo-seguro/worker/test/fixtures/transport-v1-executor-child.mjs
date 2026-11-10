let input = "";
for await (const chunk of process.stdin) input += chunk.toString("utf8");

if (process.env.DS_TEST_EXECUTOR_SECRET) process.exit(41);

const request = JSON.parse(input);
const expectedKeys = ["hostname", "profileVersion", "protocolVersion", "requestId"];
if (Object.keys(request).sort().join(",") !== expectedKeys.sort().join(",")) {
  process.exit(42);
}

const observedAt = new Date().toISOString();
const checks = [
  ["DS-DNS-01", "DNS", "high"],
  ["DS-TLS-01", "TLS", "high"],
  ["DS-HTTP-01", "HEAD", "medium"],
  ["DS-HTTP-01", "GET", "medium"],
  ["DS-HDR-01", "GET", "medium"],
].map(([controlId, method, severity]) => ({
  controlId,
  status: "unknown",
  required: true,
  severity,
  observedAt,
  targetPath: "/",
  method,
  summary: "Synthetic executor process observation.",
  limitation: "Test fixture only.",
  evidence: {},
}));

process.stdout.write(`${JSON.stringify({
  protocolVersion: 1,
  requestId: request.requestId,
  result: {
    scannerVersion: "transport-v1-network-adapter-1",
    startedAt: observedAt,
    completedAt: observedAt,
    verdict: "inconclusive",
    scope: ["/"],
    checks,
    metrics: { requestsCount: 1, bytesCount: 42, durationMs: 0, pagesCount: 0 },
  },
})}\n`);
