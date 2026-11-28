#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

# End-to-end public audit laboratory. Every created Docker resource belongs to
# one cryptographically unique Compose project and carries the run label.
# The stack is internal-only: no host ports and no access to production networks.

readonly API_IMAGE=${1:?API image required}
readonly WEB_IMAGE=${2:?web image required}
readonly WORKER_IMAGE=${3:?worker image required}
readonly RUNTIME_IMAGE=${4:?runtime image required}
readonly EXECUTOR_IMAGE=${5:?executor image required}
readonly POSTGRES_IMAGE=${6:?PostgreSQL image required}
readonly BROKER_BASE_IMAGE=${7:?broker base image required}
readonly PRIVACY_EGRESS_BASE_IMAGE=${8:?privacy egress base image required}
readonly PRIVACY_BROWSER_BASE_IMAGE=${9:?privacy browser base image required}
readonly RUN_ID="$(openssl rand -hex 16)"
readonly PROJECT="ds-public-audit-lab-${RUN_ID}"
readonly LABEL_KEY='com.desarrolloseguro.public-audit-lab.run'
readonly HOSTNAME="scan-${RUN_ID}.example.net"
readonly FIXTURE_ALIAS="public-audit-fixture-${RUN_ID}"
readonly FIXTURE_CONTAINER="${PROJECT}-fixture"
readonly UI_CONTAINER="${PROJECT}-ui"
readonly EGRESS_PROBE_CONTAINER="${PROJECT}-egress-probe"
readonly TEMP_ROOT="$(mktemp -d)"
readonly UI_STDIN="${TEMP_ROOT}/ui-stdin"
readonly UI_LOG="${TEMP_ROOT}/ui.log"
readonly ROOT="$(cd "$(dirname "$0")/.." && pwd)"
readonly SHIM_SOURCE="${ROOT}/apps/desarrollo-seguro/worker/scripts/public-audit-lab/lab-docker-cli.mjs"
readonly FIXTURE_ENTRYPOINT="${ROOT}/apps/desarrollo-seguro/worker/scripts/public-audit-lab/fixture-container.mjs"
readonly FIXTURE_SOURCE="${ROOT}/apps/desarrollo-seguro/worker/scripts/public-audit-lab/https-fixture.mjs"
readonly WORKER_DIR="/workspace/apps/desarrollo-seguro/worker/scripts/public-audit-lab"
readonly OVERRIDE_FILE="${TEMP_ROOT}/compose.override.yaml"
readonly COMPOSE_CONFIG="${TEMP_ROOT}/compose.rendered.json"
readonly FIXTURE_TLS_DIR="${TEMP_ROOT}/fixture-tls"
readonly FIXTURE_CERT="${FIXTURE_TLS_DIR}/fixture.crt"
readonly FIXTURE_KEY="${FIXTURE_TLS_DIR}/fixture.key"
readonly POSTGRES_HOST='development-security-database'
readonly POSTGRES_DB='desarrollo_seguro'

compose() {
  docker compose --project-name "$PROJECT" --file "$ROOT/compose.production.yaml" --file "$OVERRIDE_FILE" "$@"
}

assert_absent() {
  local label_filter="${LABEL_KEY}=${RUN_ID}"
  [[ -z "$(docker ps -aq --filter "label=${label_filter}")" ]] || return 1
  [[ -z "$(docker network ls -q --filter "label=${label_filter}")" ]] || return 1
  [[ -z "$(docker volume ls -q --filter "label=${label_filter}")" ]] || return 1
  [[ -z "$(docker ps -aq --filter "label=com.docker.compose.project=${PROJECT}")" ]] || return 1
  [[ -z "$(docker network ls -q --filter "name=^${PROJECT}-")" ]] || return 1
  [[ -z "$(docker volume ls -q --filter "name=^${PROJECT}-")" ]] || return 1
}

cleanup_labeled_runtime_resources() {
  local id name kind
  while IFS= read -r id; do
    [[ -n $id ]] || continue
    name="$(docker inspect --format '{{.Name}}' "$id" 2>/dev/null | sed 's#^/##')" || continue
    case "$name" in
      development-security-job-*|development-security-broker-*|development-security-executor-*|development-security-privacy-proxy-*|development-security-privacy-browser-*|"$FIXTURE_CONTAINER"|"$UI_CONTAINER"|"$EGRESS_PROBE_CONTAINER")
        docker rm --force "$id" >/dev/null 2>&1 || true
        ;;
      *) printf 'Refusing to remove unexpected labeled container: %s\n' "$name" >&2; return 1 ;;
    esac
  done < <(docker ps -aq --filter "label=${LABEL_KEY}=${RUN_ID}" 2>/dev/null || true)

  while IFS= read -r id; do
    [[ -n $id ]] || continue
    name="$(docker network inspect --format '{{.Name}}' "$id" 2>/dev/null)" || continue
    case "$name" in
      development-security-privacy-*|"${PROJECT}-"*) docker network rm "$id" >/dev/null 2>&1 || true ;;
      *) printf 'Refusing to remove unexpected labeled network: %s\n' "$name" >&2; return 1 ;;
    esac
  done < <(docker network ls -q --filter "label=${LABEL_KEY}=${RUN_ID}" 2>/dev/null || true)

  while IFS= read -r id; do
    [[ -n $id ]] || continue
    name="$(docker volume inspect --format '{{.Name}}' "$id" 2>/dev/null)" || continue
    case "$name" in
      development-security-job-*|"${PROJECT}-"*) docker volume rm "$id" >/dev/null 2>&1 || true ;;
      *) printf 'Refusing to remove unexpected labeled volume: %s\n' "$name" >&2; return 1 ;;
    esac
  done < <(docker volume ls -q --filter "label=${LABEL_KEY}=${RUN_ID}" 2>/dev/null || true)

  local image
  for image in \
    "desarrolloseguro-public-audit-lab-broker:${RUN_ID}" \
    "desarrolloseguro-public-audit-lab-privacy-egress:${RUN_ID}" \
    "desarrolloseguro-public-audit-lab-privacy-browser:${RUN_ID}"; do
    if docker image inspect "$image" >/dev/null 2>&1; then
      [[ "$(docker image inspect --format '{{ index .Config.Labels "com.desarrolloseguro.public-audit-lab.run" }}' "$image")" == "$RUN_ID" ]] || {
        printf 'Refusing to remove unowned laboratory image: %s\n' "$image" >&2
        return 1
      }
      docker image rm "$image" >/dev/null || return 1
    fi
  done
}

cleanup() {
  local status=$?
  trap - EXIT INT TERM
  if docker info >/dev/null 2>&1; then
    if (( status != 0 )) && [[ -f $OVERRIDE_FILE ]]; then
      printf 'LAB-04 scoped failure logs (API, worker, runtime coordinator):\n' >&2
      compose logs --no-color --tail 120 \
        development-security-api development-security-worker development-security-runtime-coordinator >&2 || true
      local database_container="${PROJECT}-development-security-database-1"
      if docker inspect "$database_container" >/dev/null 2>&1; then
        printf 'LAB-04 scoped synthetic-job state:\n' >&2
        docker exec \
          "$database_container" \
          psql --username ds_bootstrap --dbname "$POSTGRES_DB" --no-psqlrc --tuples-only --no-align \
          --command "SELECT json_build_object('state', state, 'public_error_code', public_error_code, 'failure_diagnostic', failure_diagnostic, 'target_url', target_url)::text FROM public.ds_scan_jobs WHERE hostname = '${HOSTNAME}' ORDER BY queued_at;" >&2 || true
      fi
    fi
    if [[ -f $OVERRIDE_FILE ]]; then
      compose stop --timeout 30 development-security-worker >/dev/null 2>&1 || status=1
      compose stop --timeout 10 development-security-runtime-coordinator >/dev/null 2>&1 || status=1
    fi
    cleanup_labeled_runtime_resources || status=1
    if [[ -f $OVERRIDE_FILE ]]; then
      compose down --volumes --remove-orphans >/dev/null 2>&1 || status=1
    fi
  else
    printf 'Docker unavailable during cleanup; run %s resources remain labeled for manual inspection.\n' "$RUN_ID" >&2
    status=1
  fi
  rm -rf -- "$TEMP_ROOT"
  exit "$status"
}
trap cleanup EXIT INT TERM

[[ -f $SHIM_SOURCE && -f $FIXTURE_ENTRYPOINT && -f $FIXTURE_SOURCE ]] || { printf 'Laboratory sources are missing.\n' >&2; exit 1; }
docker info >/dev/null
assert_absent || { printf 'Unique project preflight collided with existing Docker resources; aborting.\n' >&2; exit 1; }
for lab_image in \
  "desarrolloseguro-public-audit-lab-broker:${RUN_ID}" \
  "desarrolloseguro-public-audit-lab-privacy-egress:${RUN_ID}" \
  "desarrolloseguro-public-audit-lab-privacy-browser:${RUN_ID}"; do
  if docker image inspect "$lab_image" >/dev/null 2>&1; then
    printf 'Unique laboratory image tag already exists; aborting.\n' >&2
    exit 1
  fi
done
mkdir -m 700 "$TEMP_ROOT/tls" "$TEMP_ROOT/secrets" "$TEMP_ROOT/audit-secrets" "$FIXTURE_TLS_DIR"

create_secret() { openssl rand -hex 32 > "$TEMP_ROOT/secrets/$1"; }
create_secret development_security_admin_password
create_secret development_security_migrator_password
create_secret development_security_api_database_password
create_secret development_security_worker_database_password
create_secret development_security_retention_database_password
create_secret development_security_badge_issuer_token
readonly ADMIN_PASSWORD="$(cat "$TEMP_ROOT/secrets/development_security_admin_password")"
readonly MIGRATOR_PASSWORD="$(cat "$TEMP_ROOT/secrets/development_security_migrator_password")"
readonly API_PASSWORD="$(cat "$TEMP_ROOT/secrets/development_security_api_database_password")"
readonly WORKER_PASSWORD="$(cat "$TEMP_ROOT/secrets/development_security_worker_database_password")"
readonly RETENTION_PASSWORD="$(cat "$TEMP_ROOT/secrets/development_security_retention_database_password")"

openssl req -x509 -newkey rsa:2048 -nodes -days 1 \
  -subj "/CN=${PROJECT}-ca" -addext 'basicConstraints=critical,CA:TRUE' \
  -addext 'keyUsage=critical,keyCertSign,cRLSign' \
  -keyout "$TEMP_ROOT/tls/ca.key" -out "$TEMP_ROOT/secrets/internal_tls_ca.crt" >/dev/null 2>&1

create_leaf() {
  local name=$1 subject=$2 san=$3
  openssl req -newkey rsa:2048 -nodes -subj "/CN=${subject}" \
    -keyout "$TEMP_ROOT/tls/${name}.key" -out "$TEMP_ROOT/tls/${name}.csr" >/dev/null 2>&1
  printf 'subjectAltName=%s\nextendedKeyUsage=serverAuth\n' "$san" > "$TEMP_ROOT/tls/${name}.ext"
  openssl x509 -req -days 1 -in "$TEMP_ROOT/tls/${name}.csr" \
    -CA "$TEMP_ROOT/secrets/internal_tls_ca.crt" -CAkey "$TEMP_ROOT/tls/ca.key" \
    -CAcreateserial -extfile "$TEMP_ROOT/tls/${name}.ext" \
    -out "$TEMP_ROOT/tls/${name}.crt" >/dev/null 2>&1
}
create_leaf database "$POSTGRES_HOST" "DNS:${POSTGRES_HOST}"
create_leaf api development-security-api 'DNS:development-security-api,DNS:localhost,IP:127.0.0.1'

# This exact keypair is used for both the isolated fixture and test images.
openssl req -x509 -newkey rsa:2048 -nodes -days 1 \
  -subj "/CN=${HOSTNAME}" -addext "subjectAltName=DNS:${HOSTNAME}" \
  -keyout "$FIXTURE_KEY" -out "$FIXTURE_CERT" >/dev/null 2>&1
chmod 0600 "$FIXTURE_KEY"
chmod 0444 "$FIXTURE_CERT" "$TEMP_ROOT/secrets/internal_tls_ca.crt"
[[ "$(openssl x509 -in "$FIXTURE_CERT" -noout -modulus)" == "$(openssl rsa -in "$FIXTURE_KEY" -noout -modulus 2>/dev/null)" ]]
chmod 0444 "$TEMP_ROOT/tls/database.crt" "$TEMP_ROOT/tls/database.key" \
  "$TEMP_ROOT/tls/api.crt" "$TEMP_ROOT/tls/api.key"
cp "$TEMP_ROOT/tls/api.crt" "$TEMP_ROOT/secrets/development_security_api_tls.crt"
cp "$TEMP_ROOT/tls/api.key" "$TEMP_ROOT/secrets/development_security_api_tls.key"

printf 'postgresql://ds_bootstrap:%s@%s:5432/postgres\n' "$ADMIN_PASSWORD" "$POSTGRES_HOST" > "$TEMP_ROOT/secrets/development_security_admin_url"
printf '%s\n' "$MIGRATOR_PASSWORD" > "$TEMP_ROOT/secrets/development_security_migrator_password"
printf 'postgresql://ds_api:%s@%s:5432/%s\n' "$API_PASSWORD" "$POSTGRES_HOST" "$POSTGRES_DB" > "$TEMP_ROOT/secrets/development_security_api_database_url"
printf 'postgresql://ds_worker:%s@%s:5432/%s\n' "$WORKER_PASSWORD" "$POSTGRES_HOST" "$POSTGRES_DB" > "$TEMP_ROOT/secrets/development_security_worker_database_url"
printf 'postgresql://ds_retention:%s@%s:5432/%s\n' "$RETENTION_PASSWORD" "$POSTGRES_HOST" "$POSTGRES_DB" > "$TEMP_ROOT/secrets/development_security_retention_database_url"
chmod 0444 "$TEMP_ROOT/secrets"/*
cp "$TEMP_ROOT/tls/database.crt" "$TEMP_ROOT/secrets/development_security_database_tls.crt"
cp "$TEMP_ROOT/tls/database.key" "$TEMP_ROOT/secrets/development_security_database_tls.key"
chmod 0444 "$TEMP_ROOT/secrets/development_security_database_tls.crt" "$TEMP_ROOT/secrets/development_security_database_tls.key"

pnpm lab:build-images -- "$RUN_ID" "$FIXTURE_CERT" "$BROKER_BASE_IMAGE" "$PRIVACY_EGRESS_BASE_IMAGE" "$PRIVACY_BROWSER_BASE_IMAGE"

# Let Docker allocate the isolated edge subnet, then trust exactly that CIDR in
# the test API. This avoids fixed-subnet collisions without broadening proxy trust.
docker network create --internal \
  --label "${LABEL_KEY}=${RUN_ID}" \
  --label "com.docker.compose.project=${PROJECT}" \
  --label com.docker.compose.network=development-security-edge \
  "${PROJECT}-edge" >/dev/null
export DS_LAB_EDGE_SUBNET="$(docker network inspect --format '{{(index .IPAM.Config 0).Subnet}}' "${PROJECT}-edge")"
[[ $DS_LAB_EDGE_SUBNET =~ ^[0-9.]+/[0-9]+$ ]] || { printf 'Docker did not allocate an edge subnet.\n' >&2; exit 1; }
[[ "$(docker network inspect --format '{{.Internal}} {{index .Labels "com.desarrolloseguro.public-audit-lab.run"}}' "${PROJECT}-edge")" == "true ${RUN_ID}" ]] || {
  printf 'Refusing to use an edge network outside this isolated run.\n' >&2
  exit 1
}

cat > "$OVERRIDE_FILE" <<EOF
services:
  development-security-api:
    environment:
      DS_TRUSTED_PROXY_CIDRS: "${DS_LAB_EDGE_SUBNET}"
  development-security-runtime-coordinator:
    environment:
      DS_RUNTIME_EXECUTOR_IMAGE: "${EXECUTOR_IMAGE}"
      DS_RUNTIME_BROKER_IMAGE: "desarrolloseguro-public-audit-lab-broker:${RUN_ID}"
      DS_RUNTIME_PRIVACY_BROWSER_IMAGE: "desarrolloseguro-public-audit-lab-privacy-browser:${RUN_ID}"
      DS_RUNTIME_PRIVACY_EGRESS_IMAGE: "desarrolloseguro-public-audit-lab-privacy-egress:${RUN_ID}"
      DS_RUNTIME_DOCKER_BINARY: /run/public-audit-lab/lab-docker-cli.mjs
      DS_RUNTIME_EGRESS_NETWORK: "${PROJECT}-egress"
      DS_LAB_RUN_ID: "${RUN_ID}"
      DS_LAB_BROKER_IMAGE: "desarrolloseguro-public-audit-lab-broker:${RUN_ID}"
      DS_LAB_PRIVACY_EGRESS_IMAGE: "desarrolloseguro-public-audit-lab-privacy-egress:${RUN_ID}"
      DS_LAB_DOCKER_REAL_BIN: /usr/bin/docker
    volumes:
      - type: bind
        source: "${SHIM_SOURCE}"
        target: /run/public-audit-lab/lab-docker-cli.mjs
        read_only: true
  development-security-worker:
    environment:
      NODE_ENV: production
  development-security-processor-auditor:
    environment:
      AUDIT_ENABLED: "false"
    networks:
      - development-security-backend
networks:
  development-security-backend:
    name: "${PROJECT}-backend"
    external: false
    internal: true
  development-security-edge:
    name: "${PROJECT}-edge"
    external: true
  development-security-ingress:
    name: "${PROJECT}-ingress"
    external: false
    internal: true
  development-security-analysis-egress:
    name: "${PROJECT}-egress"
    external: false
    internal: true
volumes:
  development-security-postgres:
    name: "${PROJECT}-postgres"
    external: false
  development-security-runtime:
    name: "${PROJECT}-runtime"
    external: false
  development-security-audit-runtime:
    name: "${PROJECT}-audit-runtime"
    external: false
EOF

export DEVELOPMENT_SECURITY_SECRETS_DIR="$TEMP_ROOT/secrets"
export DEVELOPMENT_SECURITY_AUDIT_SECRETS_DIR="$TEMP_ROOT/audit-secrets"
export DEVELOPMENT_SECURITY_POSTGRES_VOLUME="${PROJECT}-postgres"
export DEVELOPMENT_SECURITY_DATABASE_IMAGE="$POSTGRES_IMAGE"
export DEVELOPMENT_SECURITY_IMAGE="$API_IMAGE"
export DEVELOPMENT_SECURITY_WEB_IMAGE="$WEB_IMAGE"
export DEVELOPMENT_SECURITY_WORKER_IMAGE="$WORKER_IMAGE"
export DEVELOPMENT_SECURITY_RUNTIME_IMAGE="$RUNTIME_IMAGE"
export DEVELOPMENT_SECURITY_PROCESSOR_TRANSPARENCY_ENABLED=false
export DEVELOPMENT_SECURITY_RELEASE_REVISION=public-audit-lab
compose config --format json > "$COMPOSE_CONFIG"

# Check rendered Compose names and all external networks before `up`; no fixed
# external resource or host-published port may enter this isolated stack.
node --input-type=module - "$COMPOSE_CONFIG" "$PROJECT" <<'NODE'
import { readFileSync } from 'node:fs';
const [file, project] = process.argv.slice(2);
const config = JSON.parse(readFileSync(file, 'utf8'));
for (const [name, network] of Object.entries(config.networks ?? {})) {
  const labEdge = name === 'development-security-edge';
  if (typeof network.name !== 'string' || !network.name.startsWith(`${project}-`) ||
      (labEdge ? network.external !== true : network.external || network.internal !== true)) {
    throw new Error(`lab_compose_network_not_isolated:${name}`);
  }
}
for (const [name, volume] of Object.entries(config.volumes ?? {})) {
  if (volume.external || typeof volume.name !== 'string' || !volume.name.startsWith(`${project}-`)) {
    throw new Error(`lab_compose_volume_not_isolated:${name}`);
  }
}
for (const [name, service] of Object.entries(config.services ?? {})) {
  if ((service.ports ?? []).length > 0) throw new Error(`lab_compose_host_port_forbidden:${name}`);
}
NODE

compose up --detach --no-build \
  development-security-database development-security-migrate \
  development-security-api development-security-runtime-coordinator \
  development-security-processor-auditor development-security-worker \
  development-security-web
compose ps --all

# Force a deterministic runtime startup error first: the production coordinator
# cannot start its broker while the run-scoped egress network is absent. The
# network is recreated only after the UI exposes its retry control.
if docker network inspect "${PROJECT}-egress" >/dev/null 2>&1; then
  network_project="$(docker network inspect --format '{{ index .Labels "com.docker.compose.project" }}' "${PROJECT}-egress")"
  network_internal="$(docker network inspect --format '{{.Internal}}' "${PROJECT}-egress")"
  [[ $network_project == "$PROJECT" && $network_internal == true ]] || {
    printf 'Refusing to remove an unowned or externally connected egress network.\n' >&2
    exit 1
  }
  while IFS= read -r attached; do
    [[ -n $attached ]] || continue
    service="$(docker inspect --format '{{ index .Config.Labels "com.docker.compose.service" }}' "$attached")"
    attached_project="$(docker inspect --format '{{ index .Config.Labels "com.docker.compose.project" }}' "$attached")"
    [[ $service == development-security-processor-auditor && $attached_project == "$PROJECT" ]] || {
      printf 'Unexpected container attached to the isolated egress network; aborting.\n' >&2
      exit 1
    }
    docker network disconnect "${PROJECT}-egress" "$attached"
  done < <(docker network inspect --format '{{range $id, $container := .Containers}}{{println $id}}{{end}}' "${PROJECT}-egress")
  network_containers="$(docker network inspect --format '{{len .Containers}}' "${PROJECT}-egress")"
  [[ $network_containers == 0 ]] || { printf 'Egress network still has an attached container.\n' >&2; exit 1; }
  docker network rm "${PROJECT}-egress" >/dev/null
fi

docker run --detach --name "$FIXTURE_CONTAINER" \
  --label "${LABEL_KEY}=${RUN_ID}" \
  --network "${PROJECT}-ingress" --network-alias "$FIXTURE_ALIAS" \
  --read-only --user 1000:1000 --cap-drop ALL --security-opt no-new-privileges \
  --pids-limit 32 --memory 128m --cpus 0.25 \
  --tmpfs /tmp:rw,noexec,nosuid,size=16m,uid=1000,gid=1000 \
  --volume "$FIXTURE_TLS_DIR:/run/lab-tls:ro" \
  --volume "$FIXTURE_ENTRYPOINT:$WORKER_DIR/fixture-container.mjs:ro" \
  --volume "$FIXTURE_SOURCE:$WORKER_DIR/https-fixture.mjs:ro" \
  --env "DS_LAB_RUN_ID=${RUN_ID}" \
  --env DS_LAB_TLS_KEY_FILE=/run/lab-tls/fixture.key \
  --env DS_LAB_TLS_CERT_FILE=/run/lab-tls/fixture.crt \
  --entrypoint node "desarrolloseguro-public-audit-lab-broker:${RUN_ID}" \
  "$WORKER_DIR/fixture-container.mjs" >/dev/null

cat > "$TEMP_ROOT/ui-runner.mjs" <<'NODE'
import { chromium } from 'playwright';
const runId = process.env.DS_LAB_RUN_ID;
const hostname = `scan-${runId}.example.net`;
const targetUrl = `https://${hostname}/consent?lab=${runId}`;
const browser = await chromium.launch({ headless: true, args: ['--disable-background-networking', '--disable-component-update', '--disable-sync', '--no-first-run', '--disable-dev-shm-usage'] });
const page = await browser.newPage();
const errors = [];
const admissionResponses = [];
page.on('pageerror', (error) => errors.push(error.message));
page.on('requestfailed', (request) => errors.push(`request_failed:${new URL(request.url()).pathname}:${request.failure()?.errorText ?? 'unknown'}`));
page.on('response', (response) => {
  if (!new URL(response.url()).pathname.endsWith('/analysis-requests')) return;
  const admission = { status: response.status(), body: '' };
  admissionResponses.push(admission);
  void response.text().then((body) => { admission.body = body.slice(0, 1_000); }).catch(() => undefined);
});
await page.goto('http://development-security-web:8080/app/', { waitUntil: 'domcontentloaded' });
const notice = page.getByRole('dialog', { name: 'Aviso informativo sobre cookies' });
if (await notice.count()) await notice.getByRole('button', { name: 'Entendido' }).click();
const ssrfResponses = await page.evaluate(async ({ hostname, runId }) => {
  const requests = [
    [`/api/desarrollo-seguro/v1/domains/127.0.0.1/analysis-requests`, { authorized: true, targetUrl: 'https://127.0.0.1/' }],
    [`/api/desarrollo-seguro/v1/domains/${encodeURIComponent(hostname)}/analysis-requests`, { authorized: true, targetUrl: `https://scan-${runId}.example.net.evil.invalid/` }],
  ];
  return Promise.all(requests.map(async ([path, body]) => {
    const response = await fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    return response.status;
  }));
}, { hostname, runId });
if (ssrfResponses.some((status) => status !== 400)) throw new Error('lab_ssrf_input_not_rejected');
await page.getByRole('textbox', { name: 'URL HTTPS que quieres auditar' }).fill(targetUrl);
await page.getByRole('button', { name: 'Consultar informe' }).click();
// The first attempt is intentionally denied at the internal egress DNS alias.
await page.getByRole('button', { name: 'Volver a solicitar análisis' }).waitFor({ timeout: 180_000 });
process.stdout.write(`LAB-04 first attempt failed as expected for ${hostname}\n`);
process.stdout.write('LAB-04_RETRY_READY\n');
await new Promise((resolve) => process.stdin.once('data', resolve));
const retryAdmissionResponse = page.waitForResponse(
  (response) => new URL(response.url()).pathname.endsWith('/analysis-requests'),
  { timeout: 30_000 },
).catch(() => null);
await page.getByRole('button', { name: 'Volver a solicitar análisis' }).click();
await retryAdmissionResponse;
let retryStatus = null;
const activationDeadline = Date.now() + 30_000;
while (Date.now() < activationDeadline) {
  retryStatus = await page.evaluate(async ({ hostname, targetUrl }) => {
    const response = await fetch(`/api/desarrollo-seguro/v1/domains/${encodeURIComponent(hostname)}/status?${new URLSearchParams({ targetUrl })}`);
    return response.ok ? response.json() : { diagnosticStatus: response.status };
  }, { hostname, targetUrl });
  if (retryStatus.diagnosticStatus || retryStatus.activeJobId || retryStatus.lastReport) break;
  await page.waitForTimeout(1_000);
}
if (!retryStatus?.diagnosticStatus && !retryStatus?.activeJobId && !retryStatus?.lastReport) {
  process.stderr.write(`LAB-04 retry admission never became active: ${JSON.stringify({ retryStatus, admissionResponses, errors })}\n`);
  throw new Error('lab_retry_admission_not_active');
}
try {
  await page.locator('.ds-portal__result h2').filter({ hasText: 'Informe vigente' }).waitFor({ timeout: 150_000 });
} catch (error) {
  const diagnostic = await page.evaluate(async ({ hostname, targetUrl }) => {
    const response = await fetch(`/api/desarrollo-seguro/v1/domains/${encodeURIComponent(hostname)}/status?${new URLSearchParams({ targetUrl })}`);
    return response.ok ? response.json() : { diagnosticStatus: response.status };
  }, { hostname, targetUrl });
  process.stderr.write(`LAB-04 retry did not finish: ${JSON.stringify({ visibleText: (await page.locator('body').innerText()).slice(-4000), status: diagnostic, admissionResponses, errors })}\n`);
  throw error;
}
const status = await page.evaluate(async ({ hostname, targetUrl }) => {
  const response = await fetch(`/api/desarrollo-seguro/v1/domains/${encodeURIComponent(hostname)}/status?${new URLSearchParams({ targetUrl })}`);
  if (!response.ok) throw new Error(`status_http_${response.status}`);
  return response.json();
}, { hostname, targetUrl });
const report = status.lastReport;
if (status.state !== 'fresh' || !report || report.hostname !== hostname) throw new Error('lab_report_not_fresh');
const cookieAudit = report.privacyAssessment?.evidence?.cookieAudit;
if (!cookieAudit?.initial || !cookieAudit?.accept || !cookieAudit?.reject) throw new Error('lab_privacy_cookie_evidence_missing');
for (const [phase, snapshot] of Object.entries({
  initial: cookieAudit.initial,
  acceptBefore: cookieAudit.accept.beforeChoice,
  acceptAfter: cookieAudit.accept.afterChoice,
  acceptReload: cookieAudit.accept.afterReload,
  rejectBefore: cookieAudit.reject.beforeChoice,
  rejectAfter: cookieAudit.reject.afterChoice,
  rejectReload: cookieAudit.reject.afterReload,
})) {
  if (!snapshot?.complete || snapshot.cookieCount === null) throw new Error(`lab_privacy_cookie_phase_incomplete:${phase}`);
}
if (cookieAudit.initial.cookieCount !== 1 || cookieAudit.reject.afterChoice.cookieCount !== 0 ||
    cookieAudit.reject.afterReload.cookieCount !== 1 || cookieAudit.accept.afterChoice.cookieCount !== 1) {
  throw new Error(`lab_privacy_cookie_phase_counts_unexpected:${JSON.stringify({ initial: cookieAudit.initial.cookieCount, accept: cookieAudit.accept.afterChoice.cookieCount, reject: cookieAudit.reject.afterChoice.cookieCount, rejectReload: cookieAudit.reject.afterReload.cookieCount })}`);
}
const performance = report.checks?.find((check) => check.controlId === 'DS-QUAL-02');
const performanceEvidence = performance?.evidence ?? {};
const requiredPerformanceMetrics = ['FcpMs', 'LcpMs', 'ClsMilli', 'TbtMs', 'TtfbMs', 'TransferBytes', 'Score'];
for (const profile of ['mobile', 'desktop']) {
  for (const metric of requiredPerformanceMetrics) {
    const value = performanceEvidence[`${profile}${metric}`];
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      throw new Error(`lab_performance_metric_missing:${profile}:${metric}`);
    }
  }
}
if (errors.length) throw new Error(`lab_browser_page_error:${errors.join('|').slice(0, 500)}`);
process.stdout.write('LAB-04 real UI retry, cookie phases, performance profiles and report passed\n');
await browser.close();
NODE

wait_for_log() {
  local needle=$1 timeout=$2 start=$SECONDS logs
  while (( SECONDS - start < timeout )); do
    logs="$(docker logs "$UI_CONTAINER" 2>&1 || true)"
    if [[ $logs == *"$needle"* ]]; then printf '%s\n' "$logs"; return 0; fi
    if [[ "$(docker inspect --format '{{.State.Running}}' "$UI_CONTAINER" 2>/dev/null || true)" == false ]]; then
      printf '%s\n' "$logs" >&2; return 1
    fi
    sleep 1
  done
  printf 'Timed out waiting for laboratory UI stage: %s\n' "$needle" >&2
  return 1
}
mkfifo -m 600 "$UI_STDIN"
docker run --interactive --name "$UI_CONTAINER" \
  --label "${LABEL_KEY}=${RUN_ID}" \
  --network "${PROJECT}-ingress" --read-only \
  --cap-drop ALL --security-opt no-new-privileges --pids-limit 96 \
  --memory 512m --cpus 0.5 --shm-size 128m \
  --tmpfs /tmp:rw,noexec,nosuid,size=64m,uid=1001,gid=1001 \
  --volume "$TEMP_ROOT/ui-runner.mjs:$WORKER_DIR/ui-runner.mjs:ro" \
  --env "DS_LAB_RUN_ID=${RUN_ID}" \
  --entrypoint node "desarrolloseguro-public-audit-lab-privacy-browser:${RUN_ID}" \
  "$WORKER_DIR/ui-runner.mjs" <"$UI_STDIN" >"$UI_LOG" 2>&1 &
readonly UI_DOCKER_PID=$!
exec 9>"$UI_STDIN"
wait_for_log LAB-04_RETRY_READY 240 >/dev/null
# Only now can scanner containers start. Recreate the missing network as an
# internal-only Compose resource, then attach the fixture to it.
docker network create --internal \
  --label "${LABEL_KEY}=${RUN_ID}" \
  --label "com.docker.compose.project=${PROJECT}" \
  --label com.docker.compose.network=development-security-analysis-egress \
  "${PROJECT}-egress" >/dev/null
# Make an outbound TCP attempt from inside the same internal network used by
# scanner egress. Any HTTP response means the lab has an unexpected route out.
docker run --rm --name "$EGRESS_PROBE_CONTAINER" --network "${PROJECT}-egress" \
  --label "${LABEL_KEY}=${RUN_ID}" \
  --read-only --cap-drop ALL --security-opt no-new-privileges \
  --pids-limit 32 --memory 64m --cpus 0.1 \
  --tmpfs /tmp:rw,noexec,nosuid,size=8m,uid=1001,gid=1001 \
  --entrypoint node "desarrolloseguro-public-audit-lab-privacy-browser:${RUN_ID}" \
  --input-type=module -e 'import {get} from "node:http"; const request=get("http://93.184.216.34/",(response)=>{response.resume();process.exit(3)}); request.setTimeout(3000,()=>request.destroy(new Error("egress_probe_timeout"))); request.on("error",()=>process.exit(0));'
docker network connect --alias "$FIXTURE_ALIAS" "${PROJECT}-egress" "$FIXTURE_CONTAINER"
printf '\n' >&9
exec 9>&-
ui_exit=0
wait "$UI_DOCKER_PID" || ui_exit=$?
if (( ui_exit != 0 )); then cat "$UI_LOG" >&2; exit "$ui_exit"; fi
cat "$UI_LOG"
grep -Fq 'LAB-04 real UI retry, cookie phases, performance profiles and report passed' "$UI_LOG"
printf 'LAB-04 passed: production UI, API, worker, runtime, executor, cookie evidence, performance profiles and report persistence traversed on isolated Docker resources.\n'
