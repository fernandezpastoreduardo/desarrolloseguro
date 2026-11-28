#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

# LAB-01 verifies only the isolated database, real production migrations, and
# production API image. Queue/worker/runtime/browser/UI traversal is LAB-04.
readonly API_IMAGE=${1:-${DEVELOPMENT_SECURITY_LAB_API_IMAGE:-}}
readonly POSTGRES_IMAGE=${2:-${DEVELOPMENT_SECURITY_LAB_POSTGRES_IMAGE:-desarrolloseguro-postgres:pg19-candidate}}
[[ -n $API_IMAGE ]] || {
  printf 'Usage: %s <development-security-api-image> [postgres-image]\n' "$0" >&2
  exit 2
}

readonly RUN_ID="$(openssl rand -hex 10)"
readonly STACK_ID="ds-public-audit-lab-${RUN_ID}"
readonly RESOURCE_LABEL='com.desarrolloseguro.public-audit-lab.run'
readonly NETWORK_NAME="${STACK_ID}-network"
readonly VOLUME_NAME="${STACK_ID}-postgres"
readonly DATABASE_CONTAINER_NAME="${STACK_ID}-database"
readonly MIGRATE_CONTAINER_NAME="${STACK_ID}-migrate"
readonly API_CONTAINER_NAME="${STACK_ID}-api"
readonly DATABASE_NAME=desarrollo_seguro
readonly DATABASE_HOST=development-security-database
readonly TEMP_ROOT="$(mktemp -d)"
readonly POSTGRES_HBA_FILE="$(pwd)/docker/postgres-pg_hba.conf"

cleanup() {
  local status=$?
  trap - EXIT
  if docker info >/dev/null 2>&1; then
    local resource_id resource_name
    while IFS= read -r resource_id; do
      [[ -n $resource_id ]] || continue
      resource_name=$(docker inspect --format '{{.Name}}' "$resource_id" 2>/dev/null | sed 's#^/##') || continue
      case "$resource_name" in
        "$DATABASE_CONTAINER_NAME"|"$MIGRATE_CONTAINER_NAME"|"$API_CONTAINER_NAME")
          docker rm --force "$resource_id" >/dev/null 2>&1 || true
          ;;
      esac
    done < <(docker ps --all --quiet --filter "label=${RESOURCE_LABEL}=${RUN_ID}" 2>/dev/null || true)

    while IFS= read -r resource_id; do
      [[ -n $resource_id ]] || continue
      resource_name=$(docker network inspect --format '{{.Name}}' "$resource_id" 2>/dev/null) || continue
      [[ $resource_name == "$NETWORK_NAME" ]] || continue
      docker network rm "$resource_id" >/dev/null 2>&1 || true
    done < <(docker network ls --quiet --filter "label=${RESOURCE_LABEL}=${RUN_ID}" 2>/dev/null || true)

    while IFS= read -r resource_id; do
      [[ -n $resource_id ]] || continue
      resource_name=$(docker volume inspect --format '{{.Name}}' "$resource_id" 2>/dev/null) || continue
      [[ $resource_name == "$VOLUME_NAME" ]] || continue
      docker volume rm "$resource_id" >/dev/null 2>&1 || true
    done < <(docker volume ls --quiet --filter "label=${RESOURCE_LABEL}=${RUN_ID}" 2>/dev/null || true)
  fi
  rm -rf -- "$TEMP_ROOT"
  exit "$status"
}
trap cleanup EXIT

docker info >/dev/null
printf 'LAB-01 starting run %s\n' "$RUN_ID"
[[ -f "$POSTGRES_HBA_FILE" ]] || { printf 'PostgreSQL HBA configuration is missing.\n' >&2; exit 1; }
mkdir -m 700 "$TEMP_ROOT/tls" "$TEMP_ROOT/secrets"
readonly ADMIN_PASSWORD="$(openssl rand -hex 24)"
readonly MIGRATOR_PASSWORD="$(openssl rand -hex 24)"
readonly API_PASSWORD="$(openssl rand -hex 24)"
readonly WORKER_PASSWORD="$(openssl rand -hex 24)"
readonly RETENTION_PASSWORD="$(openssl rand -hex 24)"
readonly BADGE_TOKEN="$(openssl rand -hex 32)"

openssl req -x509 -newkey rsa:2048 -nodes -days 1 \
  -subj "/CN=${STACK_ID}-ca" \
  -addext 'basicConstraints=critical,CA:TRUE' \
  -addext 'keyUsage=critical,keyCertSign,cRLSign' \
  -keyout "$TEMP_ROOT/tls/ca.key" -out "$TEMP_ROOT/secrets/internal_tls_ca.crt" >/dev/null 2>&1

create_leaf_certificate() {
  local name=$1
  local subject=$2
  local sans=$3
  openssl req -newkey rsa:2048 -nodes -subj "/CN=${subject}" \
    -keyout "$TEMP_ROOT/tls/${name}.key" -out "$TEMP_ROOT/tls/${name}.csr" >/dev/null 2>&1
  printf 'subjectAltName=%s\nextendedKeyUsage=serverAuth\n' "$sans" > "$TEMP_ROOT/tls/${name}.ext"
  openssl x509 -req -days 1 -in "$TEMP_ROOT/tls/${name}.csr" \
    -CA "$TEMP_ROOT/secrets/internal_tls_ca.crt" -CAkey "$TEMP_ROOT/tls/ca.key" \
    -CAcreateserial -extfile "$TEMP_ROOT/tls/${name}.ext" \
    -out "$TEMP_ROOT/tls/${name}.crt" >/dev/null 2>&1
}
create_leaf_certificate database "$DATABASE_HOST" "DNS:${DATABASE_HOST}"
create_leaf_certificate api development-security-api \
  'DNS:development-security-api,DNS:localhost,IP:127.0.0.1'

chmod 0444 "$TEMP_ROOT/secrets/internal_tls_ca.crt" \
  "$TEMP_ROOT/tls/database.crt" "$TEMP_ROOT/tls/database.key" \
  "$TEMP_ROOT/tls/api.crt" "$TEMP_ROOT/tls/api.key"
cp "$TEMP_ROOT/tls/api.crt" "$TEMP_ROOT/secrets/development-security-api.crt"
cp "$TEMP_ROOT/tls/api.key" "$TEMP_ROOT/secrets/development-security-api.key"
chmod 0444 "$TEMP_ROOT/secrets/development-security-api.crt" "$TEMP_ROOT/secrets/development-security-api.key"
chmod 0711 "$TEMP_ROOT" "$TEMP_ROOT/tls" "$TEMP_ROOT/secrets"

printf '%s\n' "postgresql://ds_bootstrap:${ADMIN_PASSWORD}@${DATABASE_HOST}:5432/postgres" \
  > "$TEMP_ROOT/secrets/development_security_admin_url"
printf '%s\n' "$MIGRATOR_PASSWORD" > "$TEMP_ROOT/secrets/development_security_migrator_password"
printf '%s\n' "postgresql://ds_api:${API_PASSWORD}@${DATABASE_HOST}:5432/${DATABASE_NAME}" \
  > "$TEMP_ROOT/secrets/development_security_api_database_url"
printf '%s\n' "postgresql://ds_worker:${WORKER_PASSWORD}@${DATABASE_HOST}:5432/${DATABASE_NAME}" \
  > "$TEMP_ROOT/secrets/development_security_worker_database_url"
printf '%s\n' "postgresql://ds_retention:${RETENTION_PASSWORD}@${DATABASE_HOST}:5432/${DATABASE_NAME}" \
  > "$TEMP_ROOT/secrets/development_security_retention_database_url"
printf '%s\n' "$BADGE_TOKEN" > "$TEMP_ROOT/secrets/development_security_badge_issuer_token"
chmod 0444 "$TEMP_ROOT/secrets"/*

docker network create --internal --label "${RESOURCE_LABEL}=${RUN_ID}" "$NETWORK_NAME" >/dev/null
docker volume create --label "${RESOURCE_LABEL}=${RUN_ID}" "$VOLUME_NAME" >/dev/null

# TLS is enabled before PostgreSQL accepts any network connections. The
# database hostname and certificate SAN match production configuration.
docker run --detach --name "$DATABASE_CONTAINER_NAME" \
  --label "${RESOURCE_LABEL}=${RUN_ID}" \
  --network "$NETWORK_NAME" --network-alias "$DATABASE_HOST" \
  --volume "${VOLUME_NAME}:/var/lib/postgresql" \
  --volume "$TEMP_ROOT/tls:/run/lab-tls:ro" \
  --volume "$POSTGRES_HBA_FILE:/etc/postgresql/pg_hba.conf:ro" \
  --env PGDATA=/var/lib/postgresql/19/docker \
  --env POSTGRES_DB=postgres --env POSTGRES_USER=ds_bootstrap \
  --env "POSTGRES_PASSWORD=${ADMIN_PASSWORD}" \
  --entrypoint /bin/sh "$POSTGRES_IMAGE" -ec '
    install -d -o postgres -g postgres -m 0700 /run/postgresql/development-security-tls
    install -o postgres -g postgres -m 0644 /run/lab-tls/database.crt /run/postgresql/development-security-tls/server.crt
    install -o postgres -g postgres -m 0600 /run/lab-tls/database.key /run/postgresql/development-security-tls/server.key
    exec docker-entrypoint.sh postgres \
      -c ssl=on \
      -c ssl_min_protocol_version=TLSv1.2 \
      -c ssl_cert_file=/run/postgresql/development-security-tls/server.crt \
      -c ssl_key_file=/run/postgresql/development-security-tls/server.key \
      -c hba_file=/etc/postgresql/pg_hba.conf
  ' >/dev/null

wait_for_database() {
  for _ in $(seq 1 60); do
    if docker exec "$DATABASE_CONTAINER_NAME" pg_isready -U ds_bootstrap -d postgres >/dev/null 2>&1; then
      return 0
    fi
    sleep 1
  done
  return 1
}
if ! wait_for_database; then
  printf 'Isolated PostgreSQL did not become ready with TLS enabled.\n' >&2
  docker logs "$DATABASE_CONTAINER_NAME" >&2 || true
  exit 1
fi

run_database_provisioning() {
  docker run --detach --name "$MIGRATE_CONTAINER_NAME" \
    --label "${RESOURCE_LABEL}=${RUN_ID}" \
    --network "$NETWORK_NAME" --user node \
    --volume "$TEMP_ROOT/secrets:/run/secrets:ro" \
    --env NODE_ENV=production \
    --env DS_PRODUCTION_BOOTSTRAP_ENABLED=1 \
    --env DS_PRODUCTION_DATABASE_NAME="$DATABASE_NAME" \
    --env DS_PRODUCTION_ADMIN_URL_FILE=/run/secrets/development_security_admin_url \
    --env DS_PRODUCTION_MIGRATOR_PASSWORD_FILE=/run/secrets/development_security_migrator_password \
    --env DS_PRODUCTION_API_DATABASE_URL_FILE=/run/secrets/development_security_api_database_url \
    --env DS_PRODUCTION_WORKER_DATABASE_URL_FILE=/run/secrets/development_security_worker_database_url \
    --env DS_PRODUCTION_RETENTION_DATABASE_URL_FILE=/run/secrets/development_security_retention_database_url \
    --env DS_PRODUCTION_TLS_CA_FILE=/run/secrets/internal_tls_ca.crt \
    --entrypoint node "$API_IMAGE" \
    apps/desarrollo-seguro/persistence/dist/production-provision-database.js >/dev/null
}
run_database_provisioning

migration_exit_code=''
for _ in $(seq 1 180); do
  migration_running=$(docker inspect --format '{{.State.Running}}' "$MIGRATE_CONTAINER_NAME")
  if [[ $migration_running == false ]]; then
    migration_exit_code=$(docker inspect --format '{{.State.ExitCode}}' "$MIGRATE_CONTAINER_NAME")
    break
  fi
  sleep 1
done
if [[ -z $migration_exit_code ]]; then
  printf 'Database provisioning and migrations timed out.\n' >&2
  docker logs "$MIGRATE_CONTAINER_NAME" >&2 || true
  exit 1
fi
if [[ $migration_exit_code != 0 ]]; then
  printf 'Database provisioning and migrations failed (exit %s).\n' "$migration_exit_code" >&2
  docker logs "$MIGRATE_CONTAINER_NAME" >&2 || true
  exit 1
fi

docker run --detach --name "$API_CONTAINER_NAME" \
  --label "${RESOURCE_LABEL}=${RUN_ID}" \
  --network "$NETWORK_NAME" --network-alias development-security-api \
  --volume "$TEMP_ROOT/secrets:/run/secrets:ro" \
  --env NODE_ENV=production --env DS_API_PORT=3001 \
  --env DS_API_TLS_REQUIRED=true \
  --env DS_API_TLS_CERT_FILE=/run/secrets/development-security-api.crt \
  --env DS_API_TLS_KEY_FILE=/run/secrets/development-security-api.key \
  --env DS_DATABASE_URL_FILE=/run/secrets/development_security_api_database_url \
  --env DS_DATABASE_URL_FILE_REQUIRED=true \
  --env DS_DATABASE_TLS_REQUIRED=true \
  --env DS_DATABASE_TLS_CA_FILE=/run/secrets/internal_tls_ca.crt \
  --env NODE_EXTRA_CA_CERTS=/run/secrets/internal_tls_ca.crt \
  --env "DS_BADGE_ISSUER_TOKEN=${BADGE_TOKEN}" \
  "$API_IMAGE" >/dev/null

api_ready=0
for _ in $(seq 1 60); do
  if docker exec --user node --env NODE_EXTRA_CA_CERTS=/run/secrets/internal_tls_ca.crt \
    "$API_CONTAINER_NAME" node --input-type=module -e '
      const response = await fetch("https://127.0.0.1:3001/api/desarrollo-seguro/v1/health");
      const body = await response.json();
      if (!response.ok || body.status !== "ok") process.exit(1);
    ' >/dev/null 2>&1; then
    api_ready=1
    break
  fi
  sleep 1
done
[[ $api_ready == 1 ]] || {
  printf 'Production API failed its in-container health check after real migrations.\n' >&2
  docker logs "$API_CONTAINER_NAME" >&2 || true
  exit 1
}

printf 'LAB-01 passed: isolated internal PostgreSQL, production-mode provisioning/migrations, and production API health check. No host ports were published. Queue/worker/runtime/browser/UI traversal remains LAB-04.\n'
