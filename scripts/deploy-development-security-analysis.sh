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

docker compose --project-name "$PROJECT_NAME" --file "$COMPOSE_FILE" config --quiet
docker build --tag desarrolloseguro-executor:local --target development-security-executor .
docker build --tag desarrolloseguro-egress-broker:local --target development-security-egress-broker .
docker compose --project-name "$PROJECT_NAME" --file "$COMPOSE_FILE" \
  build development-security-api development-security-runtime-coordinator development-security-worker development-security-web
docker compose --project-name "$PROJECT_NAME" --file "$COMPOSE_FILE" \
  up --detach --no-deps --wait \
  development-security-api development-security-runtime-coordinator development-security-worker development-security-web

docker compose --project-name "$PROJECT_NAME" --file "$COMPOSE_FILE" \
  ps development-security-api development-security-runtime-coordinator development-security-worker development-security-web
