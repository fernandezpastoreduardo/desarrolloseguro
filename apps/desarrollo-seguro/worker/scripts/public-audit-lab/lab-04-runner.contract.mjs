import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { URL } from "node:url";

const RUNNER_PATH = new URL("../../../../../scripts/run-development-security-public-audit-lab-04.sh", import.meta.url);
const PRIVACY_PROXY_PATH = new URL("./lab-privacy-egress-entrypoint.mjs", import.meta.url);
const FIXTURE_CONTAINER_PATH = new URL("./fixture-container.mjs", import.meta.url);
const runner = await readFile(RUNNER_PATH, "utf8");
const privacyProxy = await readFile(PRIVACY_PROXY_PATH, "utf8");
const fixtureContainer = await readFile(FIXTURE_CONTAINER_PATH, "utf8");

test("LAB-04 is scoped to a unique, internal-only Compose project", () => {
  assert.match(runner, /openssl rand -hex 16/u);
  assert.match(runner, /--project-name "\$PROJECT"/u);
  assert.match(runner, /external: false\s+internal: true/u);
  assert.doesNotMatch(runner, /subnet:\s*\d+\.\d+\.\d+\.\d+\/\d+/u);
  assert.match(runner, /docker network create --internal/u);
  assert.match(runner, /DS_TRUSTED_PROXY_CIDRS: "\$\{DS_LAB_EDGE_SUBNET\}"/u);
  assert.match(runner, /external: true/u);
  assert.match(runner, /lab_compose_host_port_forbidden/u);
  assert.match(runner, /compose config --format json/u);
  assert.match(runner, /assert_absent \|\|/u);
  assert.doesNotMatch(runner, /docker system prune|docker volume prune|docker network prune/u);
});

test("LAB-04 never passes a fixture private key to an image build", () => {
  assert.match(runner, /FIXTURE_KEY="\$\{FIXTURE_TLS_DIR\}\/fixture\.key"/u);
  assert.match(runner, /FIXTURE_CERT="\$\{FIXTURE_TLS_DIR\}\/fixture\.crt"/u);
  assert.match(runner, /lab:build-images -- "\$RUN_ID" "\$FIXTURE_CERT"/u);
  assert.doesNotMatch(runner, /lab:build-images --[^\n]*FIXTURE_KEY/u);
  assert.match(runner, /DS_LAB_TLS_KEY_FILE=\/run\/lab-tls\/fixture\.key/u);
});

test("LAB-04 proves browser retry, persisted cookie phases, and both performance profiles", () => {
  assert.match(runner, /Volver a solicitar análisis/u);
  assert.match(runner, /LAB-04_RETRY_READY/u);
  assert.match(runner, /DS_RUNTIME_EGRESS_NETWORK: "\$\{PROJECT\}-retry-egress"/u);
  assert.ok(runner.indexOf('docker network connect --alias "$FIXTURE_ALIAS"') < runner.indexOf('"$WORKER_DIR/ui-runner.mjs" <"$UI_STDIN"'));
  assert.ok(runner.indexOf("wait_for_log LAB-04_RETRY_READY") < runner.indexOf('DS_RUNTIME_EGRESS_NETWORK: "${PROJECT}-egress"'));
  assert.match(runner, /compose up --detach --force-recreate --wait development-security-runtime-coordinator/u);
  assert.match(runner, /docker network connect --alias "\$FIXTURE_ALIAS"/u);
  assert.match(runner, /typeof retryAdmission\?\.jobId !== 'string'/u);
  assert.match(runner, /new URLSearchParams\(\{ targetUrl, jobId \}\)/u);
  assert.match(runner, /retryStatus\?\.state === 'fresh' && retryStatus\.lastReport/u);
  assert.match(runner, /page\.waitForTimeout\(waitMs\)/u);
  assert.match(runner, /cookieAudit\?\.initial.*cookieAudit\?\.accept.*cookieAudit\?\.reject/u);
  assert.match(runner, /requiredPerformanceMetrics = \['FcpMs', 'LcpMs', 'ClsMilli', 'TbtMs', 'TtfbMs', 'TransferBytes', 'Score'\]/u);
  assert.match(runner, /lab_performance_metric_missing/u);
  assert.match(runner, /Informe vigente/u);
  assert.match(runner, /lab_ssrf_input_not_rejected/u);
  assert.match(runner, /https:\/\/127\.0\.0\.1\//u);
  assert.match(runner, /egress_probe_timeout/u);
  assert.match(runner, /--network "\$\{PROJECT\}-egress"/u);
});

test("LAB-04 preflights fixture HTTPS on the isolated egress network before browser execution", () => {
  const preflight = runner.indexOf("LAB fixture HTTPS network probe passed");
  const browser = runner.indexOf('"$WORKER_DIR/ui-runner.mjs" <"$UI_STDIN"');
  assert.ok(preflight > 0 && preflight < browser);
  const probe = runner.slice(runner.indexOf("# Check the fixture route directly"), browser);
  assert.match(probe, /--network "\$\{PROJECT\}-egress"/u);
  assert.match(probe, /servername: hostname/u);
  assert.match(probe, /headers: \{ Host: hostname \}/u);
  assert.match(probe, /hostname: process\.env\.DS_LAB_FIXTURE_ADDRESS/u);
  assert.match(probe, /res\.headers\["set-cookie"\]/u);
  assert.match(probe, /lab_fixture_https_preflight/u);
  assert.match(probe, /attempt < 12/u);
  assert.match(probe, /stage: result\.stage, code: result\.code/u);
  assert.match(runner, /DS_LAB_EGRESS_NETWORK=.*node -e/u);
  assert.match(runner, /DS_LAB_FIXTURE_ADDRESS: "\$\{FIXTURE_EGRESS_IP\}"/u);
  assert.match(runner, /public_audit_lab_fixture_ready/u);
  assert.match(runner, /\| grep -q /u);
  assert.doesNotMatch(runner, /\| rg -q /u);
  assert.match(runner, /--user "\$\{FIXTURE_UID\}:\$\{FIXTURE_GID\}"/u);
  assert.match(runner, /FIXTURE_UID="\$\(id -u\)"/u);
  assert.match(runner, /LAB-04 scoped fixture startup \(synthetic endpoint only\)/u);
  assert.doesNotMatch(probe, /console\.(?:log|error).*?(?:cookie|body|hostname)/iu);
});

test("LAB-04 fixture startup diagnostics expose only an allowlisted stage and error code", () => {
  assert.match(fixtureContainer, /event: "public_audit_lab_fixture_start_failed"/u);
  assert.match(fixtureContainer, /const knownCodes = new Set\(\["EACCES"/u);
  assert.doesNotMatch(fixtureContainer, /error\.(?:message|stack)|console\.(?:log|error)/u);
});

test("LAB-04 privacy proxy keeps the production readiness and stats protocol", () => {
  assert.match(privacyProxy, /event: "privacy_proxy_ready"/u);
  assert.match(privacyProxy, /event: "privacy_proxy_stats"/u);
  assert.doesNotMatch(privacyProxy, /lab_privacy_proxy_(?:ready|closed)/u);
});

test("cleanup removes only this run's labeled resources and the exact Compose project", () => {
  assert.match(runner, /docker ps -aq --filter "label=\$\{LABEL_KEY\}=\$\{RUN_ID\}"/u);
  assert.match(runner, /docker network ls -q --filter "label=\$\{LABEL_KEY\}=\$\{RUN_ID\}"/u);
  assert.match(runner, /docker volume ls -q --filter "label=\$\{LABEL_KEY\}=\$\{RUN_ID\}"/u);
  assert.match(runner, /compose down --volumes --remove-orphans/u);
  assert.match(runner, /Refusing to remove unexpected labeled container/u);
  assert.match(runner, /Refusing to remove unexpected labeled network/u);
  assert.match(runner, /Refusing to remove unexpected labeled volume/u);
  assert.equal((runner.match(/docker network connect --alias "\$FIXTURE_ALIAS"/gu) ?? []).length, 1);
  assert.ok(runner.indexOf("compose stop --timeout 30 development-security-worker") < runner.indexOf("cleanup_labeled_runtime_resources || status=1"));
  assert.ok(runner.lastIndexOf("compose down --volumes --remove-orphans") < runner.lastIndexOf("cleanup_labeled_runtime_resources || status=1"));
});
