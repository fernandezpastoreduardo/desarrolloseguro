#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

readonly IMAGE=${1:-}
[[ -n $IMAGE ]] || {
  printf 'Usage: %s <development-security-production-image>\n' "$0" >&2
  exit 2
}

readonly STACK_ID="ds-production-smoke-${GITHUB_RUN_ID:-local}-${GITHUB_RUN_ATTEMPT:-1}-$$"
readonly NETWORK_NAME="$STACK_ID-network"
readonly DATABASE_NAME="$STACK_ID-database"
readonly API_NAME="$STACK_ID-api"
readonly TEMP_ROOT=$(mktemp -d)
readonly POSTGRES_IMAGE='pgvector/pgvector:0.8.7-pg17'
readonly ADMIN_PASSWORD='ci-development-security-admin-password'
readonly DATABASE_PASSWORD='ci-development-security-password'

cleanup() {
  local status=$?
  trap - EXIT
  docker rm --force "$API_NAME" "$DATABASE_NAME" >/dev/null 2>&1 || true
  docker network rm "$NETWORK_NAME" >/dev/null 2>&1 || true
  rm -rf -- "$TEMP_ROOT"
  exit "$status"
}
trap cleanup EXIT

if ! docker info >/dev/null 2>&1; then
  printf 'Docker daemon is unavailable; Desarrollo Seguro image smoke cannot run.\n' >&2
  exit 1
fi

mkdir -m 700 "$TEMP_ROOT/tls" "$TEMP_ROOT/secrets"
openssl req -x509 -newkey rsa:2048 -nodes -days 1 \
  -subj '/CN=development-security-smoke-ca' \
  -addext 'basicConstraints=critical,CA:TRUE' \
  -addext 'keyUsage=critical,keyCertSign,cRLSign' \
  -keyout "$TEMP_ROOT/tls/ca.key" \
  -out "$TEMP_ROOT/tls/ca.crt" >/dev/null 2>&1
openssl req -newkey rsa:2048 -nodes \
  -subj '/CN=db' \
  -keyout "$TEMP_ROOT/tls/server.key" \
  -out "$TEMP_ROOT/tls/server.csr" >/dev/null 2>&1
cat > "$TEMP_ROOT/tls/server.ext" <<'EOF'
subjectAltName=DNS:db,DNS:localhost
extendedKeyUsage=serverAuth
EOF
openssl x509 -req -days 1 \
  -in "$TEMP_ROOT/tls/server.csr" \
  -CA "$TEMP_ROOT/tls/ca.crt" \
  -CAkey "$TEMP_ROOT/tls/ca.key" \
  -CAcreateserial \
  -extfile "$TEMP_ROOT/tls/server.ext" \
  -out "$TEMP_ROOT/tls/server.crt" >/dev/null 2>&1
printf 'postgresql://ds_api:%s@db:5432/desarrollo_seguro' "$DATABASE_PASSWORD" \
  > "$TEMP_ROOT/secrets/database_url"
chmod 0444 "$TEMP_ROOT/secrets/database_url"
chmod 0444 "$TEMP_ROOT/tls/ca.crt" "$TEMP_ROOT/tls/server.crt"
chmod 0444 "$TEMP_ROOT/tls/server.key"
# Let the non-root API process traverse the temporary bind-mount directories.
chmod 0711 "$TEMP_ROOT" "$TEMP_ROOT/tls" "$TEMP_ROOT/secrets"

docker network create --internal "$NETWORK_NAME" >/dev/null
docker run --detach \
  --name "$DATABASE_NAME" \
  --network "$NETWORK_NAME" \
  --network-alias db \
  --label "com.desarrolloseguro.smoke.stack=$STACK_ID" \
  --env POSTGRES_DB=development_security_smoke_admin \
  --env POSTGRES_USER=development_security_smoke_admin \
  --env "POSTGRES_PASSWORD=$ADMIN_PASSWORD" \
  "$POSTGRES_IMAGE" >/dev/null

database_ready=0
for _ in $(seq 1 60); do
  if docker exec "$DATABASE_NAME" psql \
    -U development_security_smoke_admin \
    -d development_security_smoke_admin \
    -Atqc 'SELECT 1' >/dev/null 2>&1; then
    database_ready=1
    break
  fi
  sleep 1
done
[[ $database_ready == 1 ]] || {
  printf 'Isolated PostgreSQL did not become ready.\n' >&2
  exit 1
}

docker exec "$DATABASE_NAME" psql \
  -U development_security_smoke_admin \
  -d development_security_smoke_admin \
  -v ON_ERROR_STOP=1 \
  -c "CREATE ROLE ds_api LOGIN PASSWORD '$DATABASE_PASSWORD' NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION" \
  -c 'CREATE DATABASE desarrollo_seguro OWNER ds_api' >/dev/null

docker cp "$TEMP_ROOT/tls/server.crt" "$DATABASE_NAME:/var/lib/postgresql/data/server.crt"
docker cp "$TEMP_ROOT/tls/server.key" "$DATABASE_NAME:/var/lib/postgresql/data/server.key"
docker exec --user 0 "$DATABASE_NAME" sh -c \
  'chown postgres:postgres /var/lib/postgresql/data/server.crt /var/lib/postgresql/data/server.key && chmod 600 /var/lib/postgresql/data/server.key'
docker exec "$DATABASE_NAME" psql \
  -U development_security_smoke_admin \
  -d development_security_smoke_admin \
  -v ON_ERROR_STOP=1 \
  -c "ALTER SYSTEM SET ssl = 'on'" \
  -c "ALTER SYSTEM SET ssl_cert_file = '/var/lib/postgresql/data/server.crt'" \
  -c "ALTER SYSTEM SET ssl_key_file = '/var/lib/postgresql/data/server.key'" \
  -c "SELECT pg_reload_conf()" >/dev/null
docker exec "$DATABASE_NAME" sh -c \
  'hba_file=$(psql -U development_security_smoke_admin -d development_security_smoke_admin -Atc "SHOW hba_file") && sed -i "1ihostnossl all all all reject" "$hba_file" && psql -U development_security_smoke_admin -d development_security_smoke_admin -c "SELECT pg_reload_conf()" >/dev/null'
docker restart "$DATABASE_NAME" >/dev/null

tls_ready=0
for _ in $(seq 1 60); do
  if docker exec "$DATABASE_NAME" psql \
    -U development_security_smoke_admin \
    -d development_security_smoke_admin \
    -Atqc 'SELECT 1' >/dev/null 2>&1; then
    tls_ready=1
    break
  fi
  sleep 1
done
[[ $tls_ready == 1 ]] || {
  printf 'TLS-enabled isolated PostgreSQL did not become ready.\n' >&2
  exit 1
}

docker create \
  --name "$API_NAME" \
  --network "$NETWORK_NAME" \
  --label "com.desarrolloseguro.smoke.stack=$STACK_ID" \
  --env NODE_ENV=production \
  --env DS_API_TLS_REQUIRED=true \
  --env DS_API_TLS_CERT_FILE=/tmp/development-security-api.crt \
  --env DS_API_TLS_KEY_FILE=/tmp/development-security-api.key \
  --env DS_DATABASE_URL_FILE=/tmp/development-security-database-url \
  --env DS_DATABASE_TLS_REQUIRED=true \
  --env DS_DATABASE_TLS_CA_FILE=/tmp/development-security-database-ca.crt \
  "$IMAGE" >/dev/null
docker cp "$TEMP_ROOT/secrets/database_url" \
  "$API_NAME:/tmp/development-security-database-url" >/dev/null
docker cp "$TEMP_ROOT/tls/ca.crt" \
  "$API_NAME:/tmp/development-security-database-ca.crt" >/dev/null
docker cp "$TEMP_ROOT/tls/server.crt" \
  "$API_NAME:/tmp/development-security-api.crt" >/dev/null
docker cp "$TEMP_ROOT/tls/server.key" \
  "$API_NAME:/tmp/development-security-api.key" >/dev/null
docker start "$API_NAME" >/dev/null

health_ready=0
for _ in $(seq 1 60); do
  if docker exec \
    --env NODE_EXTRA_CA_CERTS=/tmp/development-security-database-ca.crt \
    "$API_NAME" node --input-type=module -e '
      const response = await fetch("https://localhost:3001/api/desarrollo-seguro/v1/health");
      const body = await response.json();
      if (!response.ok || body.status !== "ok") process.exit(1);
    ' >/dev/null 2>&1; then
    health_ready=1
    break
  fi
  sleep 1
done
[[ $health_ready == 1 ]] || {
  printf 'Production API failed the in-container HTTPS and PostgreSQL TLS health smoke.\n' >&2
  docker logs "$API_NAME" >&2 || true
  exit 1
}

printf 'Desarrollo Seguro production image smoke passed with isolated PostgreSQL and verified TLS; no host ports were published.\n'
