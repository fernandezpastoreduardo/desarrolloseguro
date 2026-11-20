#!/usr/bin/env bash
set -euo pipefail

node scripts/test-development-security-production-smoke-policy.mjs
node scripts/test-development-security-deploy-workflow-policy.mjs
node --test scripts/smoke-public-domain-scan.spec.mjs
node scripts/test-development-security-compose-policy.mjs
node scripts/test-development-security-egress-policy.mjs
node scripts/test-development-security-egress-probe-policy.mjs
node scripts/test-development-security-tls.mjs
node scripts/test-sonarqube-local-policy.mjs
