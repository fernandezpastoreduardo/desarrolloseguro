import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const SMOKE_SCRIPT = "scripts/test-development-security-production-smoke.sh";
const WORKFLOW = ".github/workflows/ci.yml";

const [smokeScript, workflow] = await Promise.all([
  readFile(SMOKE_SCRIPT, "utf8"),
  readFile(WORKFLOW, "utf8"),
]);

const databaseLaunch = smokeScript.match(
  /docker run --detach([\s\S]*?)\n\s*"\$POSTGRES_IMAGE"/u,
);
const apiLaunch = smokeScript.match(
  /docker create([\s\S]*?)\n\s*"\$IMAGE"/u,
);

assert.ok(
  databaseLaunch,
  "the smoke must start an isolated PostgreSQL service",
);
assert.ok(apiLaunch, "the smoke must start the supplied production API image");

assert.match(smokeScript, /set -Eeuo pipefail/);
assert.match(smokeScript, /umask 077/);
assert.match(
  smokeScript,
  /STACK_ID="ds-production-smoke-\$\{GITHUB_RUN_ID:-local\}-\$\{GITHUB_RUN_ATTEMPT:-1\}-\$\$"/,
  "parallel CI attempts must use distinct container and network names",
);
assert.match(smokeScript, /docker network create --internal/);
assert.match(databaseLaunch[1], /--network "\$NETWORK_NAME"/);
assert.doesNotMatch(
  databaseLaunch[1],
  /--publish|--network host|--volume/u,
  "the isolated smoke database must not expose a host port or persist data",
);
assert.match(apiLaunch[1], /--network "\$NETWORK_NAME"/);
assert.doesNotMatch(
  apiLaunch[1],
  /--privileged|--network host|--publish/u,
  "the API smoke container must not gain host or privileged access",
);
assert.match(smokeScript, /docker cp[\s\S]*?database_url[\s\S]*?database-url/u);
assert.match(smokeScript, /docker cp[\s\S]*?ca\.crt[\s\S]*?database-ca\.crt/u);
assert.match(smokeScript, /docker cp[\s\S]*?server\.crt[\s\S]*?api\.crt/u);
assert.match(smokeScript, /docker cp[\s\S]*?server\.key[\s\S]*?api\.key/u);
assert.match(smokeScript, /docker start "\$API_NAME"/);
assert.match(apiLaunch[1], /--env NODE_ENV=production/);
assert.match(smokeScript, /DS_API_TLS_REQUIRED=true/);
assert.match(smokeScript, /DS_DATABASE_TLS_REQUIRED=true/);
assert.match(smokeScript, /CREATE ROLE ds_api LOGIN PASSWORD .*NOSUPERUSER/);
assert.match(smokeScript, /NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION/);
assert.doesNotMatch(smokeScript, /POSTGRES_USER=ds_api/);
assert.match(
  smokeScript,
  /DS_DATABASE_URL_FILE=\/tmp\/development-security-database-url/,
);
assert.match(smokeScript, /hostnossl all all all reject/);
assert.match(smokeScript, /subjectAltName=DNS:db,DNS:localhost/);
assert.match(
  smokeScript,
  /docker exec \\\n\s+--env NODE_EXTRA_CA_CERTS=\/tmp\/development-security-database-ca\.crt \\\n\s+"\$API_NAME" node --input-type=module -e/u,
  "the HTTPS probe must run from the API container and trust only the temporary CA",
);
assert.match(
  smokeScript,
  /NODE_EXTRA_CA_CERTS=\/tmp\/development-security-database-ca\.crt/,
);
assert.match(
  smokeScript,
  /fetch\("https:\/\/localhost:3001\/api\/desarrollo-seguro\/v1\/health"\)/,
);
assert.match(smokeScript, /!response\.ok/);
assert.match(smokeScript, /body\.status !== "ok"/);
assert.doesNotMatch(smokeScript, /curl|wget|--publish/u);
assert.match(smokeScript, /trap cleanup EXIT/);
assert.match(smokeScript, /docker rm --force "\$API_NAME" "\$DATABASE_NAME"/);
assert.match(smokeScript, /docker network rm "\$NETWORK_NAME"/);
assert.match(smokeScript, /rm -rf -- "\$TEMP_ROOT"/);
assert.doesNotMatch(
  smokeScript,
  /compose\.production|vps-deploy|PRODUCTION_DEPLOY_ENABLED/u,
  "the isolated image smoke must not enter a legacy release path",
);
assert.match(
  workflow,
  /Smoke test production API image\n\s+run: bash scripts\/test-development-security-production-smoke\.sh "desarrolloseguro-api:\$\{GITHUB_SHA\}"/,
  "the smoke must exercise the image built from this workflow revision",
);
assert.match(
  workflow,
  /Build production images[\s\S]*?--target development-security-production[\s\S]*?Smoke test production API image/u,
  "the production image must be built before its isolated smoke run",
);
assert.doesNotMatch(
  workflow.replace("Verify canonical domain redirect and live Grumphya scan", ""),
  /grumphya|PRODUCTION_DEPLOY_ENABLED|DEVELOPMENT_SECURITY_DEPLOY_ENABLED/iu,
  "the workflow must not depend on the former project or deploy toggle",
);

process.stdout.write("Development Seguro production smoke policy passed.\n");
