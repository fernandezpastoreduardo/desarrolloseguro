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

image_tag="development-security-executor-sandbox-check:$(date +%s)-$$"
cleanup() {
  docker image rm "$image_tag" >/dev/null 2>&1 || true
}
trap cleanup EXIT

docker build --target development-security-executor --tag "$image_tag" .
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
