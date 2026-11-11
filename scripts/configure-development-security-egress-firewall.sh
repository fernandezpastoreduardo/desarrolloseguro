#!/usr/bin/env bash
set -euo pipefail

readonly BRIDGE_NAME="br-ds-egress"
readonly CHAIN_NAME="DS_DEVSEC_EGRESS"
readonly NETWORK_NAME="development-security-egress"
readonly PRIVATE_CIDRS=(
  0.0.0.0/8
  10.0.0.0/8
  100.64.0.0/10
  127.0.0.0/8
  169.254.0.0/16
  172.16.0.0/12
  192.0.0.0/24
  192.0.2.0/24
  192.88.99.0/24
  192.168.0.0/16
  198.18.0.0/15
  198.51.100.0/24
  203.0.113.0/24
  224.0.0.0/4
  240.0.0.0/4
  255.255.255.255/32
)

mode="${1:-verify}"
if [[ "$#" -gt 1 || ( "$mode" != apply && "$mode" != verify && "$mode" != remove ) ]]; then
  printf 'usage: %s [apply|verify|remove]\n' "$0" >&2
  exit 2
fi

for tool in docker iptables ip6tables; do
  if ! command -v "$tool" >/dev/null 2>&1; then
    printf 'development_security_egress_firewall_tool_missing\n' >&2
    exit 2
  fi
done

verify_network() {
  local metadata
  metadata="$(docker network inspect "$NETWORK_NAME" --format '{{.Driver}}|{{.Internal}}|{{.EnableIPv6}}|{{index .Options "com.docker.network.bridge.name"}}|{{index .Labels "io.desarrolloseguro.role"}}' 2>/dev/null || true)"
  if [[ "$metadata" != "bridge|false|false|$BRIDGE_NAME|egress" ]]; then
    printf 'development_security_egress_network_invalid\n' >&2
    exit 1
  fi
}

ensure_rule() {
  local binary="$1"
  shift
  if ! "$binary" -C "$@" >/dev/null 2>&1; then
    "$binary" -I "$@"
  fi
}

delete_rule() {
  local binary="$1"
  shift
  while "$binary" -C "$@" >/dev/null 2>&1; do
    "$binary" -D "$@"
  done
}

apply_ipv4_rules() {
  iptables -N "$CHAIN_NAME" 2>/dev/null || true
  iptables -F "$CHAIN_NAME"
  for cidr in "${PRIVATE_CIDRS[@]}"; do
    iptables -A "$CHAIN_NAME" -d "$cidr" -j DROP
  done
  iptables -A "$CHAIN_NAME" -p tcp -m multiport --dports 80,443 -j RETURN
  iptables -A "$CHAIN_NAME" -j DROP
  ensure_rule iptables DOCKER-USER -i "$BRIDGE_NAME" -j "$CHAIN_NAME"
  ensure_rule iptables INPUT -i "$BRIDGE_NAME" -j DROP
}

apply_ipv6_rules() {
  ensure_rule ip6tables INPUT -i "$BRIDGE_NAME" -j DROP
  ensure_rule ip6tables FORWARD -i "$BRIDGE_NAME" -j DROP
  ensure_rule ip6tables FORWARD -o "$BRIDGE_NAME" -j DROP
}

verify_ipv4_rules() {
  iptables -C DOCKER-USER -i "$BRIDGE_NAME" -j "$CHAIN_NAME"
  iptables -C INPUT -i "$BRIDGE_NAME" -j DROP
  iptables -C "$CHAIN_NAME" -p tcp -m multiport --dports 80,443 -j RETURN
  iptables -C "$CHAIN_NAME" -j DROP
  for cidr in "${PRIVATE_CIDRS[@]}"; do
    iptables -C "$CHAIN_NAME" -d "$cidr" -j DROP
  done
}

verify_ipv6_rules() {
  ip6tables -C INPUT -i "$BRIDGE_NAME" -j DROP
  ip6tables -C FORWARD -i "$BRIDGE_NAME" -j DROP
  ip6tables -C FORWARD -o "$BRIDGE_NAME" -j DROP
}

case "$mode" in
  apply)
    verify_network
    apply_ipv4_rules
    apply_ipv6_rules
    verify_ipv4_rules
    verify_ipv6_rules
    printf 'development_security_egress_firewall_ready\n'
    ;;
  verify)
    verify_network
    verify_ipv4_rules
    verify_ipv6_rules
    printf 'development_security_egress_firewall_ready\n'
    ;;
  remove)
    delete_rule iptables DOCKER-USER -i "$BRIDGE_NAME" -j "$CHAIN_NAME"
    delete_rule iptables INPUT -i "$BRIDGE_NAME" -j DROP
    if iptables -S "$CHAIN_NAME" >/dev/null 2>&1; then
      iptables -F "$CHAIN_NAME"
      iptables -X "$CHAIN_NAME"
    fi
    delete_rule ip6tables INPUT -i "$BRIDGE_NAME" -j DROP
    delete_rule ip6tables FORWARD -i "$BRIDGE_NAME" -j DROP
    delete_rule ip6tables FORWARD -o "$BRIDGE_NAME" -j DROP
    printf 'development_security_egress_firewall_removed\n'
    ;;
esac
