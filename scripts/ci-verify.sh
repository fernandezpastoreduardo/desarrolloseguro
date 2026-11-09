#!/usr/bin/env bash
set -euo pipefail

MODE=${1:-}
if [[ "$MODE" != quality && "$MODE" != postgres && "$MODE" != audit ]]; then
  echo "Usage: pnpm ci:verify <quality|postgres|audit>" >&2
  exit 2
fi

case "$MODE" in
  quality)
    pnpm migrations:check
    bash scripts/ci-preflight.sh
    pnpm quality:check
    ;;
  postgres)
    pnpm test:postgres
    ;;
  audit)
    pnpm audit --audit-level moderate
    pnpm audit --prod --audit-level high
    ;;
esac
