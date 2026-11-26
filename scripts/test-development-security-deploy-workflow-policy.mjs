import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const WORKFLOW_PATH = ".github/workflows/ci.yml";
const DEPLOY_SCRIPT_PATH = "scripts/deploy-development-security-analysis.sh";
const ARCHIVE_GATEWAY_PATH = "scripts/deploy-development-security-archive-gateway.sh";
const [workflow, deployScript, archiveGateway, compose, provisioner] = await Promise.all([
  readFile(WORKFLOW_PATH, "utf8"),
  readFile(DEPLOY_SCRIPT_PATH, "utf8"),
  readFile(ARCHIVE_GATEWAY_PATH, "utf8"),
  readFile("compose.production.yaml", "utf8"),
  readFile("apps/desarrollo-seguro/persistence/src/production-provision-database.ts", "utf8"),
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
  "development-security-privacy-browser",
  "development-security-privacy-egress",
]) {
  assert.match(workflow, new RegExp(`--target ${target} `, "u"));
}
assert.match(workflow, /aquasecurity\/setup-trivy@[a-f0-9]{40}/u);
assert.match(workflow, /--severity HIGH,CRITICAL/u);
assert.match(workflow, /--pkg-types os,library/u);
assert.doesNotMatch(workflow, /--vuln-type/u);
assert.match(workflow, /node scripts\/trivy-report-summary\.mjs/u);
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
assert.match(workflow, /node scripts\/smoke-public-domain-scan\.mjs/u);
const liveScanSmoke = await readFile("scripts/smoke-public-domain-scan.mjs", "utf8");
const domainProfileMigration = await readFile(
  "apps/desarrollo-seguro/persistence/migrations/015_domain_v1_for_existing_domains.sql",
  "utf8",
);
const domainV2Migration = await readFile(
  "apps/desarrollo-seguro/persistence/migrations/018_domain_v2_tracking_performance.sql",
  "utf8",
);
const domainV3Migration = await readFile(
  "apps/desarrollo-seguro/persistence/migrations/019_domain_v3_tls_version_matrix.sql",
  "utf8",
);
const domainV4Migration = await readFile(
  "apps/desarrollo-seguro/persistence/migrations/038_public_policy_transparency_domain_v4.sql",
  "utf8",
);
assert.match(liveScanSmoke, /VALIDATION_HOSTNAME = process\.env\.DS_SMOKE_HOSTNAME \?\? "grumphya\.com"/u);
assert.match(liveScanSmoke, /profileVersion !== "domain-v5"/u);
assert.match(liveScanSmoke, /scannerVersion !== "domain-v5-network-adapter-2"/u);
assert.match(liveScanSmoke, /report\.checks\.length !== 10/u);
assert.match(liveScanSmoke, /domain-ethics-v6/u);
assert.match(liveScanSmoke, /publicPolicyTransparencyAssessment/u);

assert.match(liveScanSmoke, /conclusiveChecks\.length < 5/u);
assert.match(liveScanSmoke, /tls10Accepted/u);
assert.match(liveScanSmoke, /assessment\.score/u);
assert.match(liveScanSmoke, /self_domain_report_score_or_evidence_invalid/u);
assert.match(liveScanSmoke, /desarrolloseguro_source_registry/u);
assert.match(workflow, /DS_SMOKE_HOSTNAME: desarrolloseguro\.org/u);
assert.match(liveScanSmoke, /development_security_www_redirect_bad_target/u);
assert.match(liveScanSmoke, /destination\.port !== ""/u);
assert.doesNotMatch(liveScanSmoke, /desarrolloseguro\.com/u);
assert.match(domainProfileMigration, /SET profile_version = 'domain-v1'/u);
assert.match(domainProfileMigration, /WHERE profile_version = 'transport-v1'/u);
assert.match(domainV2Migration, /DS-PRIV-06/u);
assert.match(domainV2Migration, /DS-QUAL-02/u);
assert.match(domainV2Migration, /SET profile_version = 'domain-v2'/u);
assert.match(domainV3Migration, /DS-TLS-02/u);
assert.match(domainV3Migration, /SET profile_version = 'domain-v3'/u);
assert.match(domainV4Migration, /DS-PRIV-04/u);
assert.match(domainV4Migration, /SET profile_version = 'domain-v4'/u);
assert.doesNotMatch(
  workflow.replace("Verify canonical www redirect and live Grumphya scan", ""),
  /grumphya|caddy reload|compose down/iu,
);

assert.match(deployScript, /PROJECT_NAME="desarrollo-seguro"/u);
assert.match(deployScript, /COMPOSE_FILE="compose\.production\.yaml"/u);
assert.match(deployScript, /openssl rand -hex 32/u);
assert.match(deployScript, /export COMPOSE_PROFILES=""/u);
assert.match(deployScript, /export DEVELOPMENT_SECURITY_AUDIT_ENABLED="false"/u);
assert.match(deployScript, /RELEASE_REVISION_ARGUMENT="\$\{1:-\$\{DEVELOPMENT_SECURITY_RELEASE_REVISION:-\}\}"/u);
assert.match(deployScript, /RELEASE_DIRECTORY_NAME="\$\{PWD##\*\/\}"/u);
assert.match(deployScript, /gha-\(\[a-f0-9\]\{40\}\)\\\.\[A-Za-z0-9\]\{6\}/u);
assert.match(deployScript, /if \[\[ ! "\$RELEASE_REVISION" =~ \^\[a-f0-9\]\{40,64\}\$ \]\]/u);
assert.match(deployScript, /DEVELOPMENT_SECURITY_RELEASE_REVISION="\$RELEASE_REVISION"/u);
assert.match(deployScript, /export DEVELOPMENT_SECURITY_PROCESSOR_TRANSPARENCY_ENABLED="true"/u);
assert.match(deployScript, /PROCESSOR_AUDIT_SECRETS_DIR="\/opt\/desarrollo-seguro\/audit-secrets"/u);
assert.match(deployScript, /install -d -o root -g root -m 0700 "\$PROCESSOR_AUDIT_SECRETS_DIR"/u);
assert.match(deployScript, /install -o root -g root -m 0400/u);
assert.match(deployScript, /audit_jwt_private\.pem/u);
assert.match(deployScript, /release_attestation_public\.pem/u);
assert.match(deployScript, /export DEVELOPMENT_SECURITY_AUDIT_SECRETS_DIR="\$PROCESSOR_AUDIT_SECRETS_DIR"/u);
assert.match(deployScript, /172\.30\.0\.1\/32/u);
assert.match(deployScript, /development_security_badge_issuer_token/u);
assert.match(deployScript, /scripts\/configure-development-security-egress-firewall\.sh verify/u);
assert.match(
  normalizedDeployScript,
  /run --rm --no-deps development-security-migrate/u,
  "deployment must run only Desarrollo Seguro migrations before updating services",
);
assert.match(
  provisioner,
  /await migratorPool\.query\("SELECT public\.ds_advance_scan_admission_epoch\(\)"\)/u,
  "each deployment must advance the public URL scan admission epoch after migrations",
);
assert.match(
  normalizedDeployScript,
  /up --detach --no-deps --wait\s+development-security-runtime-coordinator[\s\S]*up --detach --no-deps --wait\s+development-security-processor-auditor[\s\S]*up --detach --no-deps --wait\s+development-security-api\s+development-security-worker\s+development-security-retention-scheduler\s+development-security-certification-scheduler\s+development-security-web/u,
  "deployment must wait for the isolated runtime coordinator and processor auditor before starting the worker and scheduler services",
);
assert.match(
  normalizedDeployScript,
  /logs --no-color --tail=20\s+development-security-retention-scheduler\s+development-security-certification-scheduler/u,
  "deployment must expose only bounded scheduler evidence",
);
assert.match(
  normalizedDeployScript,
  /restart --no-deps\s+development-security-retention-scheduler\s+development-security-certification-scheduler[\s\S]*up --detach --no-deps --wait\s+development-security-retention-scheduler\s+development-security-certification-scheduler/u,
  "deployment must verify scheduler recovery after a controlled restart",
);
assert.doesNotMatch(deployScript, /grumphya|caddy reload|compose down/iu);
assert.match(archiveGateway, /SSH_ORIGINAL_COMMAND/u);
assert.match(archiveGateway, /MAX_ARCHIVE_BYTES=50000000/u);
assert.match(archiveGateway, /development_security_deploy_archive_path_rejected/u);
assert.match(archiveGateway, /development_security_deploy_archive_link_rejected/u);
assert.match(archiveGateway, /chmod 0755 "\$release_dir"\s+umask 022/u);
assert.match(archiveGateway, /deploy-development-security-analysis\.sh "\$revision"/u);
assert.doesNotMatch(archiveGateway, /grumphya|caddy reload|compose down/iu);
assert.match(compose, /^  development-security-(api|runtime-coordinator|worker|web):/mu);
assert.match(compose, /development_security_badge_issuer_token/u);
assert.match(compose, /DS_BADGE_ISSUER_TOKEN/u);
const composeWithoutInternalAudit = compose.replace(
  /^  development-security-internal-audit:\n([\s\S]*?)(?=^  [a-z][a-z0-9-]*:|^networks:)/mu,
  "",
);
const composeWithoutExternalAuditors = composeWithoutInternalAudit
  .replace("  # Holds only the technical JWT private key and Grumphya's release public key.\n", "")
  .replace(
    /^  development-security-processor-auditor:\n([\s\S]*?)(?=^  [a-z][a-z0-9-]*:|^networks:)/mu,
    "",
  );
assert.doesNotMatch(composeWithoutExternalAuditors, /grumphya|caddy/iu);

process.stdout.write("Development Security deploy workflow policy passed.\n");
