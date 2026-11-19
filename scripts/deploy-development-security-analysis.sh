#!/usr/bin/env bash
set -euo pipefail

readonly PROJECT_NAME="desarrollo-seguro"
readonly COMPOSE_FILE="compose.production.yaml"

if [[ "${EUID:-$(id -u)}" -ne 0 ]]; then
  printf 'development_security_deploy_requires_root\n' >&2
  exit 2
fi

scripts/create-development-security-egress-network.sh verify
scripts/configure-development-security-egress-firewall.sh verify

export DEVELOPMENT_SECURITY_RUNTIME_IMAGE="desarrolloseguro-runtime:local"
export DEVELOPMENT_SECURITY_WORKER_IMAGE="desarrolloseguro-worker:local"
export DEVELOPMENT_SECURITY_WEB_IMAGE="desarrolloseguro-web:local"
export DEVELOPMENT_SECURITY_SECRETS_DIR="/opt/desarrollo-seguro/secrets"
# The normal production deploy never starts the private audit. Do not
# inherit a profile or an enable flag from an operator shell or CI environment.
export COMPOSE_PROFILES=""
export DEVELOPMENT_SECURITY_AUDIT_ENABLED="false"

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
docker compose --project-name "$PROJECT_NAME" --file "$COMPOSE_FILE" \
  build development-security-api development-security-runtime-coordinator development-security-worker development-security-web
# Apply the DS schema with its dedicated migrator against the existing DS database.
docker compose --project-name "$PROJECT_NAME" --file "$COMPOSE_FILE" \
  run --rm --no-deps development-security-migrate
docker compose --project-name "$PROJECT_NAME" --file "$COMPOSE_FILE" \
  up --detach --no-deps --wait development-security-runtime-coordinator
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
