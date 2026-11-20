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
    pnpm audit:preflight
    node scripts/check-internal-audit-config.spec.mjs
    node scripts/test-internal-audit-identity-policy.mjs
    node --test scripts/check-internal-audit-resources.spec.mjs
    node scripts/test-internal-audit-route-policy.mjs
    node --test scripts/check-certification-transition.spec.mjs
    node --test scripts/require-postgres-test-env.spec.mjs
    bash scripts/ci-preflight.sh
    pnpm quality:check
    pnpm sandbox:check
    ;;
  postgres)
    node scripts/require-postgres-test-env.mjs
    pnpm test:postgres
    ;;
  audit)
    node scripts/test-development-security-dependency-audit-policy.mjs
    # Production high/critical advisories block delivery. Development-only high advisories
    # remain visible in the log and block at critical while an upstream fix is unpatched.
    pnpm audit --audit-level critical
    pnpm audit --prod --audit-level high
    ;;
esac
