import { chmodSync, mkdtempSync, writeFileSync } from "node:fs";
import { generateKeyPairSync } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import assert from "node:assert/strict";

const script = join(process.cwd(), "scripts/check-internal-audit-config.mjs");
const tempRoot = mkdtempSync(join(tmpdir(), "ds-audit-config-"));
const privateKey = join(tempRoot, "jwt.pem");
const publicKey = join(tempRoot, "attestation.pem");
const jwtKeys = generateKeyPairSync("ed25519");
const attestationKeys = generateKeyPairSync("ed25519");
writeFileSync(privateKey, jwtKeys.privateKey.export({ type: "pkcs8", format: "pem" }));
writeFileSync(publicKey, attestationKeys.publicKey.export({ type: "spki", format: "pem" }));
chmodSync(privateKey, 0o400);
chmodSync(publicKey, 0o400);

const baseEnv = {
  ...process.env,
  AUDIT_ENABLED: "true",
  AUDIT_JWT_PRIVATE_KEY_FILE: privateKey,
  AUDIT_JWT_ISSUER: "desarrolloseguro-audit",
  AUDIT_JWT_AUDIENCE: "grumphya-audit",
  AUDIT_TECHNICAL_AUTH_KID: "ds-auditor-2026",
  AUDIT_RELEASE_ATTESTATION_PUBLIC_KEY_FILE: publicKey,
  AUDIT_ALLOWED_NETWORKS: "172.29.0.0/24",
  AUDIT_TECHNICAL_AUTH_ALLOWED_KIDS: "ds-auditor-2026",
};

const ready = spawnSync(process.execPath, [script], { env: baseEnv, encoding: "utf8" });
assert.equal(ready.status, 0);
assert.match(ready.stdout, /internal_audit_config_ready/u);

const disabled = spawnSync(process.execPath, [script], {
  env: { ...baseEnv, AUDIT_ENABLED: "false" },
  encoding: "utf8",
});
assert.equal(disabled.status, 0);
assert.match(disabled.stdout, /internal_audit_disabled/u);

const broadNetwork = spawnSync(process.execPath, [script], {
  env: { ...baseEnv, AUDIT_ALLOWED_NETWORKS: "0.0.0.0/0" },
  encoding: "utf8",
});
assert.equal(broadNetwork.status, 1);
assert.match(broadNetwork.stderr, /internal_audit_config_networks_invalid/u);

const wrongClaims = spawnSync(process.execPath, [script], {
  env: { ...baseEnv, AUDIT_JWT_AUDIENCE: "other-service" },
  encoding: "utf8",
});
assert.equal(wrongClaims.status, 1);
assert.match(wrongClaims.stderr, /internal_audit_config_claims_invalid/u);

const malformedKey = spawnSync(process.execPath, [script], {
  env: { ...baseEnv, AUDIT_JWT_PRIVATE_KEY_FILE: publicKey },
  encoding: "utf8",
});
assert.equal(malformedKey.status, 1);
assert.match(malformedKey.stderr, /internal_audit_config_file_invalid=AUDIT_JWT_PRIVATE_KEY_FILE/u);

console.log("internal audit config tests passed");
