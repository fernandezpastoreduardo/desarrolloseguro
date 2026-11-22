import assert from "node:assert/strict";
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { readFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";

const COMPOSE_PATH = "compose.production.yaml";
const NGINX_PATH = "docker/nginx-development-security.conf";
const CADDY_FRAGMENT_PATH = "docker/Caddyfile.development-security";
const SECRET_NAMES = [
  "development_security_admin_password",
  "development_security_admin_url",
  "development_security_migrator_password",
  "development_security_api_database_url",
  "development_security_worker_database_url",
  "development_security_retention_database_url",
  "development_security_database_tls.crt",
  "development_security_database_tls.key",
  "development_security_api_tls.crt",
  "development_security_api_tls.key",
  "internal_tls_ca.crt",
];

const [compose, nginx, postgresHba, dockerfile, caddyFragment, workflow] = await Promise.all([
  readFile(COMPOSE_PATH, "utf8"),
  readFile(NGINX_PATH, "utf8"),
  readFile("docker/postgres-pg_hba.conf", "utf8"),
  readFile("Dockerfile", "utf8"),
  readFile(CADDY_FRAGMENT_PATH, "utf8"),
  readFile(".github/workflows/ci.yml", "utf8"),
]);
const sandboxVerifier = await readFile(
  "scripts/verify-executor-sandbox.sh",
  "utf8",
);
const sandboxProbe = await readFile("scripts/executor-sandbox-probe.mjs", "utf8");

function serviceBlock(serviceName) {
  const pattern = new RegExp(
    `^  ${serviceName}:\\n([\\s\\S]*?)(?=^  [a-z][a-z0-9-]*:|^networks:)`,
    "mu",
  );
  const match = compose.match(pattern);
  assert.ok(match, `Compose must define ${serviceName}`);
  return match[1];
}

const database = serviceBlock("development-security-database");
const migration = serviceBlock("development-security-migrate");
const api = serviceBlock("development-security-api");
const web = serviceBlock("development-security-web");
const worker = serviceBlock("development-security-worker");
const runtimeCoordinator = serviceBlock("development-security-runtime-coordinator");
const retentionScheduler = serviceBlock("development-security-retention-scheduler");
const certificationScheduler = serviceBlock("development-security-certification-scheduler");
const internalAudit = serviceBlock("development-security-internal-audit");
const processorAuditor = serviceBlock("development-security-processor-auditor");

assert.match(database, /desarrolloseguro-postgres:local/u);
assert.match(database, /dockerfile: docker\/postgres\/Dockerfile/u);
assert.match(database, /PGDATA: \$\{DEVELOPMENT_SECURITY_POSTGRES_DATA_DIRECTORY:-\/var\/lib\/postgresql\/19\/docker\}/u);
assert.match(database, /development-security-postgres:\$\{DEVELOPMENT_SECURITY_POSTGRES_DATA_MOUNT:-\/var\/lib\/postgresql\}/u);
assert.match(database, /POSTGRES_USER:\s*ds_bootstrap/u);
assert.match(database, /POSTGRES_PASSWORD_FILE:.*development_security_admin_password/u);
assert.match(database, /ssl=on/u);
assert.match(database, /ssl_min_protocol_version=TLSv1\.2/u);
assert.match(database, /cap_drop:\s*\[ALL\]/u);
assert.match(database, /read_only:\s*true/u);
assert.doesNotMatch(database, /^\s+ports:/mu);
assert.match(workflow, /image: pgvector\/pgvector:0\.8\.7-pg19-trixie/u);
assert.match(workflow, /docker\/postgres\/Dockerfile/u);
assert.match(workflow, /database_image=desarrolloseguro-postgres:pg19-candidate/u);
assert.match(workflow, /--ignore-unfixed/u);
assert.match(workflow, /desarrollo-seguro-trivy-raw-reports/u);
assert.match(workflow, /scripts\/test-postgres-major-upgrade\.sh/u);

assert.match(migration, /DS_PRODUCTION_BOOTSTRAP_ENABLED:\s*"1"/u);
assert.match(migration, /production-provision-database\.js/u);
assert.match(migration, /DS_PRODUCTION_WORKER_DATABASE_URL_FILE=/u);
assert.match(migration, /DS_PRODUCTION_RETENTION_DATABASE_URL_FILE=/u);
assert.match(migration, /service_healthy/u);
assert.match(compose, /service_completed_successfully/u);
assert.match(migration, /read_only:\s*true/u);

assert.match(api, /target:\s*development-security-production/u);
assert.match(api, /DS_API_TLS_REQUIRED:\s*"true"/u);
assert.match(api, /DS_DATABASE_TLS_REQUIRED:\s*"true"/u);
assert.match(api, /DS_DATABASE_URL_FILE_REQUIRED:\s*"true"/u);
assert.match(api, /DS_TRUSTED_PROXY_CIDRS:\s*172\.29\.0\.0\/24/u);
assert.match(api, /cap_drop:\s*\[ALL\]/u);
assert.match(api, /read_only:\s*true/u);
assert.doesNotMatch(api, /^\s+ports:/mu);

assert.match(web, /target:\s*development-security-web/u);
assert.match(web, /internal_tls_ca\.crt/u);
assert.match(web, /cap_drop:\s*\[ALL\]/u);
assert.match(web, /user:\s*"0:0"/u);
assert.match(web, /cap_add:\s*\[CHOWN, SETUID, SETGID\]/u);
assert.match(web, /\/var\/run:rw,noexec,nosuid,size=8m,uid=101,gid=101,mode=1777/u);
assert.match(web, /read_only:\s*true/u);
assert.match(web, /http:\/\/127\.0\.0\.1:8080\//u);
assert.doesNotMatch(web, /^\s+ports:/mu);
assert.match(
  web,
  /development-security-ingress:\n\s+aliases: \[development-security-web\]/u,
);
assert.doesNotMatch(api, /development-security-ingress/u);
assert.doesNotMatch(database, /development-security-ingress/u);
assert.match(worker, /target:\s*development-security-worker/u);
assert.match(worker, /development_security_worker_database_url/u);
assert.match(worker, /internal_tls_ca\.crt/u);
assert.match(worker, /DS_WORKER_DATABASE_TLS_REQUIRED=true/u);
assert.match(worker, /development-security-runtime:\/run\/development-security:ro/u);
assert.match(worker, /development-security-audit-runtime:\/run\/development-security-audit:ro/u);
assert.match(worker, /DS_PROCESSOR_AUDITOR_SOCKET/u);
assert.match(worker, /development-security-backend/u);
assert.doesNotMatch(worker, /docker\.sock|development-security-egress|ports:/u);
assert.match(processorAuditor, /AUDIT_ENABLED:\s*\$\{DEVELOPMENT_SECURITY_PROCESSOR_TRANSPARENCY_ENABLED:-false\}/u);
assert.match(processorAuditor, /audit_jwt_private\.pem/u);
assert.match(processorAuditor, /release_attestation_public\.pem/u);
assert.match(processorAuditor, /development-security-analysis-egress/u);
assert.match(processorAuditor, /development-security-audit-runtime:\/run\/development-security-audit/u);
assert.match(processorAuditor, /user:\s*"0:1000"/u);
assert.match(processorAuditor, /cap_drop:\s*\[ALL\]/u);
assert.match(processorAuditor, /read_only:\s*true/u);
assert.doesNotMatch(processorAuditor, /development_security_.*database|docker\.sock|ports:|development-security-backend/u);
assert.match(internalAudit, /profiles:\s*\[internal-audit\]/u);
assert.match(internalAudit, /image:\s*\$\{DEVELOPMENT_SECURITY_WORKER_IMAGE:-desarrolloseguro-worker:local\}/u);
assert.match(internalAudit, /AUDIT_ENABLED:\s*\$\{DEVELOPMENT_SECURITY_AUDIT_ENABLED:-false\}/u);
assert.match(internalAudit, /AUDIT_TECHNICAL_AUTH_ALLOWED_KIDS/u);
assert.match(internalAudit, /AUDIT_ALLOWED_NETWORKS/u);
assert.match(internalAudit, /audit_jwt_private\.pem/u);
assert.match(internalAudit, /release_attestation_public\.pem/u);
assert.match(internalAudit, /development-security-analysis-egress/u);
assert.doesNotMatch(internalAudit, /development_security_.*database|docker\.sock|ports:/u);
assert.match(internalAudit, /internal_audit_disabled/u);
assert.match(internalAudit, /cap_drop:\s*\[ALL\]/u);
assert.match(internalAudit, /cap_add:\s*\[CHOWN, SETUID, SETGID, DAC_OVERRIDE, FOWNER\]/u);
assert.match(internalAudit, /read_only:\s*true/u);
assert.match(runtimeCoordinator, /target:\s*development-security-runtime-coordinator/u);
assert.match(runtimeCoordinator, /network_mode:\s*none/u);
assert.match(runtimeCoordinator, /user:\s*"0:1000"/u);
assert.match(runtimeCoordinator, /\/var\/run\/docker\.sock:\/var\/run\/docker\.sock/u);
assert.doesNotMatch(runtimeCoordinator, /\/usr\/bin\/docker:\/usr\/bin\/docker/u);
assert.match(runtimeCoordinator, /DS_RUNTIME_DOCKER_BINARY:\s*\/usr\/bin\/docker/u);
assert.match(runtimeCoordinator, /development-security-runtime:\/run\/development-security/u);
assert.doesNotMatch(runtimeCoordinator, /development-security-ingress|development-security-backend|ports:/u);
assert.match(runtimeCoordinator, /DS_RUNTIME_EGRESS_NETWORK:\s*development-security-egress/u);
assert.match(runtimeCoordinator, /DS_RUNTIME_PRIVACY_BROWSER_IMAGE:\s*desarrolloseguro-privacy-browser:local/u);
assert.match(runtimeCoordinator, /DS_RUNTIME_PRIVACY_EGRESS_IMAGE:\s*desarrolloseguro-privacy-egress:local/u);
assert.match(runtimeCoordinator, /cap_drop:\s*\[ALL\]/u);
assert.match(runtimeCoordinator, /cap_add:\s*\[CHOWN, FOWNER\]/u);
assert.match(runtimeCoordinator, /read_only:\s*true/u);
for (const scheduler of [retentionScheduler, certificationScheduler]) {
  assert.match(scheduler, /target:\s*development-security-production/u);
  assert.match(scheduler, /development_security_retention_database_url/u);
  assert.match(scheduler, /internal_tls_ca\.crt/u);
  assert.match(scheduler, /DS_RETENTION_DATABASE_URL_FILE=/u);
  assert.match(scheduler, /DS_RETENTION_DATABASE_TLS_CA_FILE=/u);
  assert.match(scheduler, /development-security-backend/u);
  assert.match(scheduler, /service_completed_successfully/u);
  assert.match(scheduler, /cap_drop:\s*\[ALL\]/u);
  assert.match(scheduler, /read_only:\s*true/u);
  assert.match(scheduler, /healthcheck:\n\s+test:\s*\[CMD-SHELL, test -r \/proc\/1\/cmdline && head -c 1 \/proc\/1\/cmdline \| grep -q \.\]/u);
  assert.doesNotMatch(scheduler, /kill -0 1/u);
  assert.doesNotMatch(scheduler, /development-security-egress|ports:|docker\.sock/u);
}
assert.match(compose, /development-security-backend:\n    internal: true/u);
assert.match(compose, /development-security-edge:\n    internal: true/u);
assert.match(
  compose,
  /development-security-ingress:\n    name: development-security-ingress\n    external: true/u,
);
assert.match(
  compose,
  /development-security-analysis-egress:\n    name: development-security-egress\n    external: true/u,
);
assert.match(caddyFragment, /^desarrolloseguro\.org \{/mu);
assert.match(caddyFragment, /reverse_proxy development-security-web:8080/u);
assert.match(caddyFragment, /Content-Security-Policy "default-src 'self'; base-uri 'self'; object-src 'none'; frame-ancestors 'none'; form-action 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'"/u);
assert.match(caddyFragment, /www\.desarrolloseguro\.org \{/u);
assert.doesNotMatch(caddyFragment, /api:3001|database|grumphya/iu);
assert.match(compose, /name: \$\{DEVELOPMENT_SECURITY_POSTGRES_VOLUME:-development-security-postgres-pg19\}/u);
assert.match(dockerfile, /AS development-security-worker\n/u);
assert.match(
  dockerfile,
  /development-security-worker-dependencies --chown=node:node \/workspace\/apps\/desarrollo-seguro\/persistence\/node_modules \/workspace\/apps\/desarrollo-seguro\/persistence\/node_modules/u,
);
assert.match(dockerfile, /AS development-security-runtime-coordinator\n/u);
assert.match(dockerfile, /FROM development-security-worker AS development-security-runtime-coordinator[\s\S]*?apk add --no-cache docker-cli/u);
assert.match(runtimeCoordinator, /\/var\/run\/docker\.sock:\/var\/run\/docker\.sock/u);
const composeWithoutScopedAuditors = compose
  .replace("  # Holds only the technical JWT private key and Grumphya's release public key.\n", "")
  .replace(internalAudit, "")
  .replace(processorAuditor, "");
assert.doesNotMatch(composeWithoutScopedAuditors, /grumphya|apps\/api|apps\/web/iu);
assert.doesNotMatch(compose, /privileged:\s*true/u);
assert.match(dockerfile, /AS development-security-executor\n/u);
assert.match(dockerfile, /ENTRYPOINT \["node", "apps\/desarrollo-seguro\/worker\/dist\/transport-v1-executor-child\.js"\]/u);
assert.match(sandboxVerifier, /--network none/u);
assert.match(sandboxVerifier, /--read-only/u);
assert.match(sandboxVerifier, /--cap-drop ALL/u);
assert.match(sandboxVerifier, /--security-opt no-new-privileges/u);
assert.match(sandboxVerifier, /--pids-limit 64/u);
assert.match(sandboxVerifier, /--memory 256m/u);
assert.match(sandboxVerifier, /--cpus 0\.5/u);
assert.match(
  sandboxVerifier,
  /--entrypoint \/bin\/busybox[\s\S]+stat -c '%a %u %g %F'/u,
  "the broker socket check must use the BusyBox utility available in Alpine images",
);
const verifierWithoutBrokerSocketMounts = sandboxVerifier.replace(
  /--mount "type=volume,source=\$broker_volume,target=\/run\/development-security-egress(?:,readonly)?"/gu,
  "",
);
assert.equal(
  sandboxVerifier.match(
    /--mount "type=volume,source=\$broker_volume,target=\/run\/development-security-egress(?:,readonly)?"/gu,
  )?.length,
  4,
  "Sandbox verifier may mount only the private broker socket volume",
);
assert.doesNotMatch(
  verifierWithoutBrokerSocketMounts,
  /--volume|--mount|--env|--publish|--privileged/u,
);
assert.match(sandboxProbe, /capabilities_not_dropped/u);
assert.match(sandboxProbe, /root_mount_not_read_only/u);
assert.match(sandboxProbe, /temporary_mount_not_restricted/u);
assert.match(sandboxProbe, /docker_socket_unavailable/u);
assert.match(sandboxProbe, /process_limit_not_applied/u);
assert.match(sandboxProbe, /memory_limit_not_applied/u);
assert.match(sandboxProbe, /cpu_limit_not_applied/u);
assert.match(sandboxProbe, /default_network_route_present/u);
assert.match(sandboxVerifier, /profileVersion":"controls-v1/u);
assert.match(sandboxVerifier, /executor_entrypoint_probe_failed/u);
assert.match(
  sandboxVerifier,
  /broker_response" != \*'egress_broker_startup_invalid'\*/u,
  "the broker sandbox probe must expect the safe invalid-scope response",
);
assert.match(nginx, /proxy_pass https:\/\/development-security-api:3001/u);
assert.match(nginx, /absolute_redirect off;/u);
assert.match(nginx, /port_in_redirect off;/u);
assert.match(nginx, /proxy_ssl_verify on/u);
assert.match(nginx, /proxy_ssl_trusted_certificate \/run\/secrets\/internal_tls_ca\.crt/u);
assert.match(nginx, /client_body_temp_path \/tmp\/client_temp/u);
assert.match(nginx, /fastcgi_temp_path \/tmp\/fastcgi_temp/u);
assert.match(nginx, /proxy_temp_path \/tmp\/proxy_temp/u);
assert.match(nginx, /scgi_temp_path \/tmp\/scgi_temp/u);
assert.match(nginx, /uwsgi_temp_path \/tmp\/uwsgi_temp/u);
assert.match(
  nginx,
  /location = \/ \{\s+add_header Cache-Control "no-store" always;\s+try_files \/desarrollo-seguro\/index\.html =404;\s+\}/u,
);
assert.match(
  nginx,
  /location = \/desarrollo-seguro\/badge-widget\.js \{\s+add_header Cross-Origin-Resource-Policy "cross-origin" always;\s+add_header Cache-Control "no-store" always;\s+try_files \$uri =404;\s+\}/u,
  "only the public badge widget opts into cross-origin embedding under COEP",
);
assert.match(
  nginx,
  /location = \/desarrollo-seguro\/badge-api\.mjs \{\s+default_type application\/javascript;\s+add_header Cache-Control "no-store" always;\s+try_files \$uri =404;\s+\}/u,
  "the verification page's ES module dependency uses a browser-executable MIME type",
);
assert.match(nginx, /location \^~ \/desarrollo-seguro\/ \{\s+add_header Cache-Control "no-store" always;/u);
assert.match(nginx, /location \/app\/ \{\s+add_header Cache-Control "no-store" always;\s+try_files \$uri \$uri\/ \/app\/index\.html/u);
assert.doesNotMatch(nginx, /location \^~ \/app\//u, "hashed asset locations must remain eligible for immutable caching");
assert.match(nginx, /Cache-Control "public, max-age=31536000, immutable"/u);
assert.match(dockerfile, /FROM nginx:1\.30-alpine AS development-security-web/u);
assert.match(dockerfile, /FROM node:26\.13\.1-alpine3\.24 AS node-base/u);
assert.match(dockerfile, /COPY --from=development-security-build \/workspace\/apps\/desarrollo-seguro\/web\/dist\/desarrollo-seguro \/usr\/share\/nginx\/html\/desarrollo-seguro/u);
assert.match(dockerfile, /RUN apk upgrade --no-cache/u);
assert.match(postgresHba, /^hostnossl all all all reject$/mu);

const composeCli = spawnSync("docker", ["compose", "version"], {
  encoding: "utf8",
});
if (!composeCli.error) {
  const tempRoot = mkdtempSync(join(tmpdir(), "development-security-compose-"));
  const secretDirectory = join(tempRoot, "secrets");
  mkdirSync(secretDirectory, { mode: 0o700 });
  for (const name of SECRET_NAMES) {
    writeFileSync(join(secretDirectory, name), "synthetic-only\n", {
      mode: 0o600,
    });
  }
  chmodSync(tempRoot, 0o700);
  try {
    const result = spawnSync(
      "docker",
      ["compose", "--file", COMPOSE_PATH, "config", "--quiet"],
      {
        encoding: "utf8",
        env: {
          ...process.env,
          DEVELOPMENT_SECURITY_IMAGE: "desarrolloseguro-api:synthetic",
          DEVELOPMENT_SECURITY_WEB_IMAGE: "desarrolloseguro-web:synthetic",
          DEVELOPMENT_SECURITY_SECRETS_DIR: secretDirectory,
        },
      },
    );
    assert.equal(
      result.status,
      0,
      `docker compose config rejected the standalone stack: ${result.stderr}`,
    );
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
}

process.stdout.write("Development Seguro standalone Compose policy passed.\n");
