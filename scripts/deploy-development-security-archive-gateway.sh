#!/usr/bin/env bash
set -euo pipefail

readonly ROOT_DEPLOY_SCRIPT="/usr/local/sbin/development-security-deploy-archive-root"
readonly PROJECT_ROOT="/opt/desarrollo-seguro"
readonly MAX_ARCHIVE_BYTES=50000000

if [[ "${EUID:-$(id -u)}" -ne 0 ]]; then
  if [[ "${SSH_ORIGINAL_COMMAND:-}" =~ ^deploy\ ([a-f0-9]{40})$ ]]; then
    exec /usr/bin/sudo --non-interactive "$ROOT_DEPLOY_SCRIPT" "${BASH_REMATCH[1]}"
  fi
  printf 'development_security_deploy_command_rejected\n' >&2
  exit 64
fi

if [[ $# -ne 1 || ! "$1" =~ ^[a-f0-9]{40}$ ]]; then
  printf 'development_security_deploy_revision_rejected\n' >&2
  exit 64
fi
readonly revision="$1"
umask 077
archive="$(mktemp "$PROJECT_ROOT/.deploy-archive.XXXXXX")"
trap 'rm -f -- "$archive"' EXIT

cat > "$archive"
archive_size="$(stat --format=%s "$archive")"
if (( archive_size < 1 || archive_size > MAX_ARCHIVE_BYTES )); then
  printf 'development_security_deploy_archive_size_rejected\n' >&2
  exit 65
fi

while IFS= read -r member; do
  case "$member" in
    ""|/*|../*|*/../*|*/..)
      printf 'development_security_deploy_archive_path_rejected\n' >&2
      exit 65
      ;;
  esac
done < <(tar --list --file "$archive")
if tar --verbose --list --file "$archive" | awk 'substr($0, 1, 1) ~ /[lh]/ { found = 1 } END { exit !found }'; then
  printf 'development_security_deploy_archive_link_rejected\n' >&2
  exit 65
fi

release_dir="$(mktemp --directory "$PROJECT_ROOT/releases/gha-${revision}.XXXXXX")"
tar --extract --file "$archive" --directory "$release_dir" --no-same-owner --no-same-permissions
for required_file in compose.production.yaml Dockerfile scripts/deploy-development-security-analysis.sh; do
  if [[ ! -f "$release_dir/$required_file" ]]; then
    printf 'development_security_deploy_archive_incomplete\n' >&2
    exit 65
  fi
done

cd "$release_dir"
./scripts/deploy-development-security-analysis.sh
