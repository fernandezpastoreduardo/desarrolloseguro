#!/usr/bin/env bash
set -euo pipefail

readonly PROJECT_NAME="desarrollo-seguro"
readonly COMPOSE_FILE="compose.production.yaml"
readonly RELEASE_REVISION="${1:-}"

if [[ ! "$RELEASE_REVISION" =~ ^[a-f0-9]{40,64}$ ]]; then
  printf 'development_security_release_revision_required\n' >&2
  exit 2
fi

if [[ "${EUID:-$(id -u)}" -ne 0 ]]; then
  printf 'development_security_deploy_requires_root\n' >&2
  exit 2
fi

scripts/create-development-security-egress-network.sh verify
scripts/configure-development-security-egress-firewall.sh verify

export DEVELOPMENT_SECURITY_RUNTIME_IMAGE="desarrolloseguro-runtime:local"
export DEVELOPMENT_SECURITY_WORKER_IMAGE="desarrolloseguro-worker:local"
export DEVELOPMENT_SECURITY_WEB_IMAGE="desarrolloseguro-web:local"
export DEVELOPMENT_SECURITY_DATABASE_IMAGE="desarrolloseguro-postgres:local"
export DEVELOPMENT_SECURITY_SECRETS_DIR="/opt/desarrollo-seguro/secrets"
# The normal deploy starts only the fixed backend-inventory reader. Keep the
# full private-audit profile off; the processor auditor gets its own enable flag.
export COMPOSE_PROFILES=""
export DEVELOPMENT_SECURITY_AUDIT_ENABLED="false"
export DEVELOPMENT_SECURITY_RELEASE_REVISION="$RELEASE_REVISION"
export DEVELOPMENT_SECURITY_PROCESSOR_TRANSPARENCY_ENABLED="true"
readonly PROCESSOR_AUDIT_SECRETS_DIR="/opt/desarrollo-seguro/audit-secrets"
for audit_key in audit_jwt_private.pem release_attestation_public.pem; do
  if [[ ! -f "$DEVELOPMENT_SECURITY_SECRETS_DIR/$audit_key" || -L "$DEVELOPMENT_SECURITY_SECRETS_DIR/$audit_key" ]]; then
    printf 'development_security_processor_audit_credential_missing\n' >&2
    exit 2
  fi
done
install -d -o root -g root -m 0700 "$PROCESSOR_AUDIT_SECRETS_DIR"
install -o root -g root -m 0400 \
  "$DEVELOPMENT_SECURITY_SECRETS_DIR/audit_jwt_private.pem" \
  "$PROCESSOR_AUDIT_SECRETS_DIR/audit_jwt_private.pem"
install -o root -g root -m 0400 \
  "$DEVELOPMENT_SECURITY_SECRETS_DIR/release_attestation_public.pem" \
  "$PROCESSOR_AUDIT_SECRETS_DIR/release_attestation_public.pem"
export DEVELOPMENT_SECURITY_AUDIT_SECRETS_DIR="$PROCESSOR_AUDIT_SECRETS_DIR"
export AUDIT_ALLOWED_NETWORKS="${AUDIT_ALLOWED_NETWORKS:-172.30.0.1/32}"

install -d -o root -g root -m 0700 "$DEVELOPMENT_SECURITY_SECRETS_DIR"
readonly BADGE_ISSUER_SECRET="$DEVELOPMENT_SECURITY_SECRETS_DIR/development_security_badge_issuer_token"
if [[ ! -s "$BADGE_ISSUER_SECRET" ]]; then
  readonly BADGE_ISSUER_SECRET_TEMP="$BADGE_ISSUER_SECRET.tmp"
  umask 077
  openssl rand -hex 32 > "$BADGE_ISSUER_SECRET_TEMP"
  chmod 0400 "$BADGE_ISSUER_SECRET_TEMP"
  mv "$BADGE_ISSUER_SECRET_TEMP" "$BADGE_ISSUER_SECRET"
fi

docker compose --project-name "$PROJECT_NAME" --file "$COMPOSE_FILE" config --quiet
docker build --tag desarrolloseguro-executor:local --target development-security-executor .
docker build --tag desarrolloseguro-egress-broker:local --target development-security-egress-broker .
docker build --tag desarrolloseguro-privacy-browser:local --target development-security-privacy-browser .
docker build --tag desarrolloseguro-privacy-egress:local --target development-security-privacy-egress .
docker compose --project-name "$PROJECT_NAME" --file "$COMPOSE_FILE" \
  build development-security-api development-security-runtime-coordinator development-security-worker development-security-web
# Apply the DS schema with its dedicated migrator against the existing DS database.
docker compose --project-name "$PROJECT_NAME" --file "$COMPOSE_FILE" \
  run --rm --no-deps development-security-migrate
docker compose --project-name "$PROJECT_NAME" --file "$COMPOSE_FILE" \
  up --detach --no-deps --wait development-security-runtime-coordinator
# The worker uses --no-deps below, so start and verify its isolated inventory
# auditor explicitly before replacing the worker that consumes its socket.
docker compose --project-name "$PROJECT_NAME" --file "$COMPOSE_FILE" \
  up --detach --no-deps --wait development-security-processor-auditor
docker compose --project-name "$PROJECT_NAME" --file "$COMPOSE_FILE" \
  up --detach --no-deps --wait \
  development-security-api development-security-worker \
  development-security-retention-scheduler \
  development-security-certification-scheduler development-security-web

docker compose --project-name "$PROJECT_NAME" --file "$COMPOSE_FILE" \
  ps development-security-api development-security-runtime-coordinator \
  development-security-worker development-security-retention-scheduler \
  development-security-certification-scheduler development-security-web

# Scheduler logs are bounded JSONL categories only; keep their first-cycle
# evidence visible to the deploy log without exposing database or target data.
docker compose --project-name "$PROJECT_NAME" --file "$COMPOSE_FILE" \
  logs --no-color --tail=20 \
  development-security-retention-scheduler \
  development-security-certification-scheduler

# A controlled restart proves both loops recover without touching the database,
# API, worker, web or any other application on the VPS.
docker compose --project-name "$PROJECT_NAME" --file "$COMPOSE_FILE" \
  restart --no-deps \
  development-security-retention-scheduler \
  development-security-certification-scheduler
docker compose --project-name "$PROJECT_NAME" --file "$COMPOSE_FILE" \
  up --detach --no-deps --wait \
  development-security-retention-scheduler \
  development-security-certification-scheduler
docker compose --project-name "$PROJECT_NAME" --file "$COMPOSE_FILE" \
  logs --no-color --tail=20 \
  development-security-retention-scheduler \
  development-security-certification-scheduler
