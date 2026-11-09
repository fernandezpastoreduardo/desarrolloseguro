#!/usr/bin/env bash
set -euo pipefail

node scripts/test-development-security-production-smoke-policy.mjs
node scripts/test-development-security-compose-policy.mjs
node scripts/test-development-security-tls.mjs
