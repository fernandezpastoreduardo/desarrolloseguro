#!/usr/bin/env bash
set -euo pipefail

readonly DEFAULT_HOSTNAME="grumphya.com"
readonly DEFAULT_URL="https://grumphya.com/"
readonly hostname="${1:-$DEFAULT_HOSTNAME}"
readonly url="${2:-$DEFAULT_URL}"

if [[ "$hostname" != "$DEFAULT_HOSTNAME" || "$url" != "$DEFAULT_URL" ]]; then
  printf 'egress_probe_target_invalid\n' >&2
  exit 2
fi
if ! command -v curl >/dev/null 2>&1; then
  printf 'egress_probe_curl_missing\n' >&2
  exit 2
fi

set +e
probe_output="$(curl --silent --show-error --output /dev/null \
  --connect-timeout 5 --max-time 15 --retry 0 \
  --write-out 'egress_probe stage=http code=http_response status=%{http_code} remote=%{remote_ip}\n' \
  "$url" 2>/dev/null)"
curl_status=$?
set -e

if (( curl_status == 0 )); then
  printf '%s' "$probe_output"
  exit 0
fi

case "$curl_status" in
  6) printf 'egress_probe stage=dns code=dns_resolution_failed\n' ;;
  7) printf 'egress_probe stage=tcp code=tcp_connection_failed\n' ;;
  28) printf 'egress_probe stage=transport code=timeout\n' ;;
  35|51|60) printf 'egress_probe stage=tls code=tls_negotiation_failed\n' ;;
  *) printf 'egress_probe stage=transport code=http_client_failed\n' ;;
esac
exit 1
