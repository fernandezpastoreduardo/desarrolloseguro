#!/usr/bin/env bash
set -euo pipefail

if ! command -v docker >/dev/null 2>&1; then
  printf 'docker_required\n' >&2
  exit 2
fi
if [[ "$(docker info --format '{{.OSType}}')" != "linux" ]]; then
  printf 'linux_container_runtime_required\n' >&2
  exit 2
fi

pnpm --filter @desarrolloseguro/worker build

image_tag="development-security-executor-sandbox-check:$(date +%s)-$$"
broker_image_tag="development-security-egress-broker-sandbox-check:$(date +%s)-$$"
broker_container="development-security-egress-broker-check-$$"
broker_volume="development-security-egress-check-$$"
broker_attach_pid=""
broker_log="$(mktemp)"
cleanup() {
  if [[ -n "$broker_attach_pid" ]]; then
    kill "$broker_attach_pid" >/dev/null 2>&1 || true
  fi
  docker rm --force "$broker_container" >/dev/null 2>&1 || true
  docker volume rm "$broker_volume" >/dev/null 2>&1 || true
  docker image rm "$image_tag" >/dev/null 2>&1 || true
  docker image rm "$broker_image_tag" >/dev/null 2>&1 || true
  rm -f "$broker_log"
}
trap cleanup EXIT

docker build --target development-security-executor --tag "$image_tag" .
docker build --target development-security-egress-broker --tag "$broker_image_tag" .
DS_RUNTIME_EXECUTOR_IMAGE="$image_tag" \
  DS_RUNTIME_BROKER_IMAGE="$broker_image_tag" \
  node apps/desarrollo-seguro/worker/scripts/runtime-coordinator-docker-smoke.mjs
docker run --rm \
  --network none \
  --read-only \
  --user 1000:1000 \
  --cap-drop ALL \
  --security-opt no-new-privileges \
  --pids-limit 64 \
  --memory 256m \
  --cpus 0.5 \
  --tmpfs /tmp:rw,noexec,nosuid,size=16m,uid=1000,gid=1000 \
  --entrypoint node \
  "$image_tag" \
  /workspace/scripts/executor-sandbox-probe.mjs

executor_response="$(printf '%s' '{"protocolVersion":1,"requestId":"11111111-1111-4111-8111-111111111111","hostname":"example.org","profileVersion":"controls-v1"}' \
  | docker run --rm --interactive \
    --network none \
    --read-only \
    --user 1000:1000 \
    --cap-drop ALL \
    --security-opt no-new-privileges \
    --pids-limit 64 \
    --memory 256m \
    --cpus 0.5 \
    --tmpfs /tmp:rw,noexec,nosuid,size=16m,uid=1000,gid=1000 \
    "$image_tag" || true)"
if [[ "$executor_response" != *'"errorCode":"request_invalid"'* ]]; then
  printf 'Executor probe returned: %s\n' "$executor_response" >&2
  printf 'executor_entrypoint_probe_failed\n' >&2
  exit 1
fi
printf 'Executor child entrypoint loaded and rejected invalid protocol input before network access.\n'

executor_response="$(printf '%s' '{"protocolVersion":1,"requestId":"11111111-1111-4111-8111-111111111111","hostname":"example.org","profileVersion":"transport-v1"}' \
  | docker run --rm --interactive \
    --network none \
    --read-only \
    --user 1000:1000 \
    --cap-drop ALL \
    --security-opt no-new-privileges \
    --pids-limit 64 \
    --memory 256m \
    --cpus 0.5 \
    --tmpfs /tmp:rw,noexec,nosuid,size=16m,uid=1000,gid=1000 \
    "$image_tag" || true)"
if [[ "$executor_response" != *'"verdict":"inconclusive"'* || "$executor_response" != *'"status":"unknown"'* ]]; then
  printf 'Executor missing-broker probe returned: %s\n' "$executor_response" >&2
  printf 'executor_missing_broker_probe_failed\n' >&2
  exit 1
fi
printf 'Executor child fails closed when the fixed Unix broker socket is not mounted.\n'

broker_response="$(printf '%s' '{"protocolVersion":1,"hostname":"127.0.0.1","profileVersion":"transport-v1"}' \
  | docker run --rm --interactive \
    --network none \
    --read-only \
    --user 1000:1000 \
    --cap-drop ALL \
    --security-opt no-new-privileges \
    --pids-limit 64 \
    --memory 256m \
    --cpus 0.5 \
    --tmpfs /tmp:rw,noexec,nosuid,size=16m,uid=1000,gid=1000 \
    "$broker_image_tag" 2>&1 || true)"
if [[ "$broker_response" != *'egress_broker_startup_failed'* ]]; then
  printf 'Egress broker rejected-scope probe returned: %s\n' "$broker_response" >&2
  printf 'egress_broker_entrypoint_probe_failed\n' >&2
  exit 1
fi
printf 'Egress broker child entrypoint rejects invalid per-job scope before listening.\n'

docker volume create "$broker_volume" >/dev/null
docker run --rm \
  --network none \
  --user 0:0 \
  --mount "type=volume,source=$broker_volume,target=/run/development-security-egress" \
  --entrypoint /bin/sh \
  "$broker_image_tag" \
  -c 'chown 1000:1000 /run/development-security-egress && chmod 0700 /run/development-security-egress'
printf '%s' '{"protocolVersion":1,"hostname":"example.org","profileVersion":"transport-v1"}' \
  | docker run --rm --interactive \
  --name "$broker_container" \
  --network none \
  --read-only \
  --user 1000:1000 \
  --cap-drop ALL \
  --security-opt no-new-privileges \
  --pids-limit 64 \
  --memory 256m \
  --cpus 0.5 \
  --tmpfs /tmp:rw,noexec,nosuid,size=16m,uid=1000,gid=1000 \
  --mount "type=volume,source=$broker_volume,target=/run/development-security-egress" \
  "$broker_image_tag" >"$broker_log" 2>&1 &
broker_attach_pid=$!
for attempt in $(seq 1 50); do
  if grep -q '"state":"ready"' "$broker_log"; then
    break
  fi
  if ! kill -0 "$broker_attach_pid" 2>/dev/null; then
    cat "$broker_log" >&2
    printf 'egress_broker_container_start_failed\n' >&2
    exit 1
  fi
  sleep 0.1
done
if ! grep -q '"state":"ready"' "$broker_log"; then
  cat "$broker_log" >&2
  printf 'egress_broker_readiness_timeout\n' >&2
  exit 1
fi
socket_metadata="$(docker run --rm \
  --network none \
  --mount "type=volume,source=$broker_volume,target=/run/development-security-egress,readonly" \
  --entrypoint /bin/busybox \
  "$broker_image_tag" \
  stat -c '%a %u %g %F' /run/development-security-egress/broker.sock)"
if [[ "$socket_metadata" != '660 1000 1000 socket' ]]; then
  printf 'Unexpected broker socket metadata: %s\n' "$socket_metadata" >&2
  printf 'egress_broker_socket_permissions_invalid\n' >&2
  exit 1
fi
executor_response="$(printf '%s' '{"protocolVersion":1,"requestId":"11111111-1111-4111-8111-111111111111","hostname":"example.org","profileVersion":"transport-v1"}' \
  | docker run --rm --interactive \
    --network none \
    --read-only \
    --user 1000:1000 \
    --cap-drop ALL \
    --security-opt no-new-privileges \
    --pids-limit 64 \
    --memory 256m \
    --cpus 0.5 \
    --tmpfs /tmp:rw,noexec,nosuid,size=16m,uid=1000,gid=1000 \
    --mount "type=volume,source=$broker_volume,target=/run/development-security-egress,readonly" \
    "$image_tag" || true)"
if [[ "$executor_response" != *'"verdict":"inconclusive"'* || "$executor_response" != *'"status":"unknown"'* ]]; then
  printf 'Executor with isolated broker returned: %s\n' "$executor_response" >&2
  printf 'executor_broker_ipc_probe_failed\n' >&2
  exit 1
fi
printf 'Per-job broker and network-disabled executor share a private socket volume; its mode and ownership are 0660/1000:1000. The result stays inconclusive because the broker also has network disabled.\n'
