import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const WORKFLOW_PATH = ".github/workflows/deploy-development-security.yml";
const DEPLOY_SCRIPT_PATH = "scripts/deploy-development-security-analysis.sh";
const ARCHIVE_GATEWAY_PATH = "scripts/deploy-development-security-archive-gateway.sh";
const [workflow, deployScript, archiveGateway, compose] = await Promise.all([
  readFile(WORKFLOW_PATH, "utf8"),
  readFile(DEPLOY_SCRIPT_PATH, "utf8"),
  readFile(ARCHIVE_GATEWAY_PATH, "utf8"),
  readFile("compose.production.yaml", "utf8"),
]);
const normalizedDeployScript = deployScript.replace(/\\\n/gu, " ");

assert.match(workflow, /^name: Deploy Desarrollo Seguro$/mu);
assert.match(workflow, /^  workflow_dispatch:$/mu);
assert.match(workflow, /^      deploy:$/mu);
assert.match(workflow, /^        type: boolean$/mu);
assert.match(workflow, /^        default: false$/mu);
assert.match(
  workflow,
  /if: github\.ref == 'refs\/heads\/main' && inputs\.deploy/u,
  "deployment must require both main and an explicitly checked box",
);
assert.match(
  workflow,
  /runs-on: ubuntu-24\.04/u,
  "deployment must run on an isolated GitHub-hosted runner",
);
assert.match(workflow, /^permissions:\n  contents: read$/mu);
assert.match(workflow, /persist-credentials: false/u);
assert.match(workflow, /environment: desarrollo-seguro-production/u);
assert.match(
  workflow,
  /DS_DEPLOY_SSH_KEY: \$\{\{ secrets\.DS_DEPLOY_SSH_KEY \}\}/u,
);
assert.match(workflow, /DS_DEPLOY_KNOWN_HOSTS: \$\{\{ secrets\.DS_DEPLOY_KNOWN_HOSTS \}\}/u);
assert.match(workflow, /DS_DEPLOY_HOST: \$\{\{ secrets\.DS_DEPLOY_HOST \}\}/u);
assert.match(workflow, /git archive --format=tar "\$GITHUB_SHA"/u);
assert.match(workflow, /StrictHostKeyChecking=yes/u);
assert.match(workflow, /curl .*https:\/\/desarrolloseguro\.org\/api\/desarrollo-seguro\/v1\/health/u);
assert.doesNotMatch(workflow, /^\s+(push|pull_request):/mu);
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
assert.match(archiveGateway, /deploy-development-security-analysis\.sh/u);
assert.doesNotMatch(archiveGateway, /grumphya|caddy reload|compose down/iu);
assert.match(compose, /^  development-security-(api|runtime-coordinator|worker|web):/mu);
assert.doesNotMatch(compose, /grumphya|caddy/iu);

process.stdout.write("Development Security deploy workflow policy passed.\n");
