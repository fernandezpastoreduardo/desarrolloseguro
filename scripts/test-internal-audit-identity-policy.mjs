import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const script = readFileSync("scripts/provision-internal-audit-identity.sh", "utf8");
assert.match(script, /EUID[^\n]+-ne 0/u, "production provisioning must require root");
assert.match(script, /openssl genpkey -algorithm Ed25519/u);
assert.match(script, /openssl pkey -in "[$]PRIVATE_TEMP" -pubout/u);
assert.match(script, /chmod 0400 "[$]PRIVATE_TEMP"/u);
assert.match(script, /chmod 0444 "[$]PUBLIC_TEMP"/u);
assert.match(script, /chown root:root "[$]PRIVATE_TEMP" "[$]PUBLIC_TEMP"/u);
assert.match(script, /internal_audit_identity_exists/u, "existing identities must not be overwritten");
assert.match(script, /enabled=false/u, "the command must never enable the worker");
assert.match(script, /FINGERPRINT=.*openssl pkey -pubin/u);
assert.doesNotMatch(script, /AUDIT_ENABLED=true/u);
console.log("Internal audit identity provisioning policy passed");
