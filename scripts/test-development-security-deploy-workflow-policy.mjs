import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const WORKFLOW_PATH = ".github/workflows/ci.yml";
const DEPLOY_SCRIPT_PATH = "scripts/deploy-development-security-analysis.sh";
const ARCHIVE_GATEWAY_PATH = "scripts/deploy-development-security-archive-gateway.sh";
const [workflow, deployScript, archiveGateway, compose] = await Promise.all([
  readFile(WORKFLOW_PATH, "utf8"),
  readFile(DEPLOY_SCRIPT_PATH, "utf8"),
  readFile(ARCHIVE_GATEWAY_PATH, "utf8"),
  readFile("compose.production.yaml", "utf8"),
]);
const normalizedDeployScript = deployScript.replace(/\\\n/gu, " ");

assert.match(workflow, /^name: CI\/CD Desarrollo Seguro$/mu);
assert.match(workflow, /^  pull_request:$/mu);
assert.match(workflow, /^  push:\n    branches: \[main\]$/mu);
assert.match(workflow, /^  workflow_dispatch:$/mu);
assert.match(workflow, /^      authorize_deploy:$/mu);
assert.match(workflow, /^        type: boolean$/mu);
assert.match(workflow, /^        default: false$/mu);
assert.match(
  workflow,
  /if: github\.event_name == 'workflow_dispatch' && github\.ref == 'refs\/heads\/main' && inputs\.authorize_deploy/u,
  "deployment must require a manual run on main and an explicitly checked authorization box",
);
assert.match(workflow, /^  quality-gates:$/mu);
assert.match(workflow, /^  e2e:$/mu);
assert.match(workflow, /^  postgres-integration:$/mu);
assert.match(workflow, /^  dependency-audit:$/mu);
assert.match(workflow, /^  build-and-scan-images:$/mu);
assert.match(workflow, /^  deploy:$/mu);
assert.doesNotMatch(
  workflow.split("\n  deploy:\n", 1)[0] ?? "",
  /^\s+needs:/mu,
  "quality, E2E, PostgreSQL, dependency audit, and image jobs must run independently",
);
assert.match(
  workflow,
  /needs: \[quality-gates, e2e, postgres-integration, dependency-audit, build-and-scan-images\]/u,
);
assert.match(
  workflow,
  /runs-on: ubuntu-24\.04/u,
  "deployment must run on an isolated GitHub-hosted runner",
);
assert.match(workflow, /^permissions:\n  contents: read$/mu);
assert.match(workflow, /persist-credentials: false/u);
assert.match(workflow, /environment: desarrollo-seguro-production/u);
assert.match(workflow, /run: pnpm ci:verify quality/u);
assert.match(workflow, /run: pnpm test:e2e/u);
assert.match(workflow, /run: pnpm ci:verify postgres/u);
assert.match(workflow, /run: pnpm ci:verify audit/u);
for (const target of [
  "development-security-production",
  "development-security-web",
  "development-security-worker",
  "development-security-runtime-coordinator",
  "development-security-executor",
  "development-security-egress-broker",
]) {
  assert.match(workflow, new RegExp(`--target ${target} `, "u"));
}
assert.match(workflow, /aquasecurity\/setup-trivy@[a-f0-9]{40}/u);
assert.match(workflow, /--severity HIGH,CRITICAL/u);
assert.match(workflow, /--vuln-type os,library/u);
assert.match(workflow, /retention-days: 14/u);
assert.match(
  workflow,
  /DS_DEPLOY_SSH_KEY: \$\{\{ secrets\.DS_DEPLOY_SSH_KEY \}\}/u,
);
assert.match(workflow, /DS_DEPLOY_KNOWN_HOSTS: \$\{\{ secrets\.DS_DEPLOY_KNOWN_HOSTS \}\}/u);
assert.match(workflow, /DS_DEPLOY_HOST: \$\{\{ secrets\.DS_DEPLOY_HOST \}\}/u);
assert.match(workflow, /git archive --format=tar "\$GITHUB_SHA"/u);
assert.match(workflow, /StrictHostKeyChecking=yes/u);
assert.match(workflow, /https:\/\/desarrolloseguro\.org\/api\/desarrollo-seguro\/v1\/health/u);
assert.doesNotMatch(workflow, /grumphya|caddy reload|compose down/iu);

assert.match(deployScript, /PROJECT_NAME="desarrollo-seguro"/u);
assert.match(deployScript, /COMPOSE_FILE="compose\.production\.yaml"/u);
assert.match(deployScript, /scripts\/configure-development-security-egress-firewall\.sh verify/u);
assert.match(
  normalizedDeployScript,
  /run --rm --no-deps development-security-migrate/u,
  "deployment must run only Desarrollo Seguro migrations before updating services",
);
assert.match(
  normalizedDeployScript,
  /up --detach --no-deps --wait\s+development-security-api development-security-runtime-coordinator development-security-worker development-security-web/u,
  "deployment must update only the four Desarrollo Seguro application services",
);
assert.doesNotMatch(deployScript, /grumphya|caddy reload|compose down/iu);
assert.match(archiveGateway, /SSH_ORIGINAL_COMMAND/u);
assert.match(archiveGateway, /MAX_ARCHIVE_BYTES=50000000/u);
assert.match(archiveGateway, /development_security_deploy_archive_path_rejected/u);
assert.match(archiveGateway, /development_security_deploy_archive_link_rejected/u);
assert.match(archiveGateway, /chmod 0755 "\$release_dir"\s+umask 022/u);
assert.match(archiveGateway, /deploy-development-security-analysis\.sh/u);
assert.doesNotMatch(archiveGateway, /grumphya|caddy reload|compose down/iu);
assert.match(compose, /^  development-security-(api|runtime-coordinator|worker|web):/mu);
assert.doesNotMatch(compose, /grumphya|caddy/iu);

process.stdout.write("Development Security deploy workflow policy passed.\n");
