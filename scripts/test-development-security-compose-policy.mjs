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
const SECRET_NAMES = [
  "development_security_admin_password",
  "development_security_admin_url",
  "development_security_migrator_password",
  "development_security_api_database_url",
  "development_security_database_tls.crt",
  "development_security_database_tls.key",
  "development_security_api_tls.crt",
  "development_security_api_tls.key",
  "internal_tls_ca.crt",
];

const [compose, nginx, postgresHba, dockerfile] = await Promise.all([
  readFile(COMPOSE_PATH, "utf8"),
  readFile(NGINX_PATH, "utf8"),
  readFile("docker/postgres-pg_hba.conf", "utf8"),
  readFile("Dockerfile", "utf8"),
]);

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

assert.match(database, /pgvector\/pgvector:0\.8\.7-pg17/u);
assert.match(database, /development-security-postgres:\/var\/lib\/postgresql\/data/u);
assert.match(database, /POSTGRES_USER:\s*ds_bootstrap/u);
assert.match(database, /POSTGRES_PASSWORD_FILE:.*development_security_admin_password/u);
assert.match(database, /ssl=on/u);
assert.match(database, /ssl_min_protocol_version=TLSv1\.2/u);
assert.match(database, /cap_drop:\s*\[ALL\]/u);
assert.match(database, /read_only:\s*true/u);
assert.doesNotMatch(database, /^\s+ports:/mu);

assert.match(migration, /DS_PRODUCTION_BOOTSTRAP_ENABLED:\s*"1"/u);
assert.match(migration, /production-provision-database\.js/u);
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
assert.match(web, /127\.0\.0\.1:\$\{DEVELOPMENT_SECURITY_WEB_HOST_PORT:-18080\}:8080/u);
assert.match(web, /internal_tls_ca\.crt/u);
assert.match(web, /cap_drop:\s*\[ALL\]/u);
assert.match(web, /read_only:\s*true/u);
assert.match(compose, /development-security-backend:\n    internal: true/u);
assert.match(compose, /development-security-edge:\n    internal: true/u);
assert.match(compose, /name: development-security-postgres/u);
assert.doesNotMatch(compose, /grumphya|apps\/api|apps\/web/iu);
assert.doesNotMatch(compose, /privileged:\s*true/u);
assert.doesNotMatch(compose, /worker|executor|scan-runner/iu);
assert.match(nginx, /proxy_pass https:\/\/development-security-api:3001/u);
assert.match(nginx, /proxy_ssl_verify on/u);
assert.match(nginx, /proxy_ssl_trusted_certificate \/run\/secrets\/internal_tls_ca\.crt/u);
assert.match(nginx, /try_files \$uri \$uri\/ \/app\/index\.html/u);
assert.match(dockerfile, /FROM nginx:1\.30-alpine AS development-security-web/u);
assert.match(dockerfile, /FROM node:26\.13\.0-trixie-slim/u);
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
