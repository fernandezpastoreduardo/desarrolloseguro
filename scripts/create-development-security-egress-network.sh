#!/usr/bin/env bash
set -euo pipefail

readonly NETWORK_NAME="development-security-egress"
readonly BRIDGE_NAME="br-ds-egress"

mode="${1:-verify}"
if [[ "$#" -gt 1 || ( "$mode" != create && "$mode" != verify && "$mode" != remove ) ]]; then
  printf 'usage: %s [create|verify|remove]\n' "$0" >&2
  exit 2
fi

if ! command -v docker >/dev/null 2>&1; then
  printf 'docker_required\n' >&2
  exit 2
fi

network_exists() {
  docker network inspect "$NETWORK_NAME" >/dev/null 2>&1
}

verify_network() {
  local metadata
  metadata="$(docker network inspect "$NETWORK_NAME" --format '{{.Driver}}|{{.Internal}}|{{.EnableIPv6}}|{{index .Options "com.docker.network.bridge.name"}}|{{index .Labels "io.desarrolloseguro.role"}}')"
  if [[ "$metadata" != "bridge|false|false|$BRIDGE_NAME|egress" ]]; then
    printf 'development_security_egress_network_invalid\n' >&2
    exit 1
  fi
}

case "$mode" in
  create)
    if ! network_exists; then
      docker network create \
        --driver bridge \
        --opt "com.docker.network.bridge.name=$BRIDGE_NAME" \
        --ipv6=false \
        --label io.desarrolloseguro.role=egress \
        "$NETWORK_NAME" >/dev/null
    fi
    verify_network
    printf 'development_security_egress_network_ready\n'
    ;;
  verify)
    if ! network_exists; then
      printf 'development_security_egress_network_missing\n' >&2
      exit 1
    fi
    verify_network
    printf 'development_security_egress_network_ready\n'
    ;;
  remove)
    if network_exists; then
      verify_network
      local local_attached
      local_attached="$(docker network inspect "$NETWORK_NAME" --format '{{len .Containers}}')"
      if [[ "$local_attached" != "0" ]]; then
        printf 'development_security_egress_network_in_use\n' >&2
        exit 1
      fi
      docker network rm "$NETWORK_NAME" >/dev/null
    fi
    printf 'development_security_egress_network_removed\n'
    ;;
esac
