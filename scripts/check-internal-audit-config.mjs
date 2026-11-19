import { readFileSync, statSync } from "node:fs";
import { createPrivateKey, createPublicKey } from "node:crypto";
import { isIP } from "node:net";

const enabled = process.env.AUDIT_ENABLED === "true";
const EXPECTED_ISSUER = "desarrolloseguro-audit";
const EXPECTED_AUDIENCE = "grumphya-audit";
if (!enabled) {
  console.log("internal_audit_disabled");
  process.exit(0);
}

const required = [
  "AUDIT_JWT_PRIVATE_KEY_FILE",
  "AUDIT_JWT_ISSUER",
  "AUDIT_JWT_AUDIENCE",
  "AUDIT_TECHNICAL_AUTH_KID",
  "AUDIT_RELEASE_ATTESTATION_PUBLIC_KEY_FILE",
  "AUDIT_RELEASE_ATTESTATION_KID",
  "AUDIT_ALLOWED_NETWORKS",
  "AUDIT_TECHNICAL_AUTH_ALLOWED_KIDS",
];
const missing = required.filter((name) => !process.env[name]);
if (missing.length > 0) {
  console.error(`internal_audit_config_missing=${missing.join(",")}`);
  process.exit(1);
}

if (
  process.env.AUDIT_JWT_ISSUER !== EXPECTED_ISSUER ||
  process.env.AUDIT_JWT_AUDIENCE !== EXPECTED_AUDIENCE
) {
  console.error("internal_audit_config_claims_invalid");
  process.exit(1);
}

for (const name of ["AUDIT_JWT_PRIVATE_KEY_FILE", "AUDIT_RELEASE_ATTESTATION_PUBLIC_KEY_FILE"]) {
  const file = process.env[name];
  try {
    const stats = statSync(file);
    const pem = readFileSync(file, "utf8").trim();
    if (!stats.isFile() || (stats.mode & 0o077) !== 0 || pem.length === 0) {
      throw new Error("invalid_file");
    }
    const expectsPrivateKey = name === "AUDIT_JWT_PRIVATE_KEY_FILE";
    if (
      expectsPrivateKey
        ? !pem.includes("PRIVATE KEY") || pem.includes("PUBLIC KEY")
        : !pem.includes("PUBLIC KEY") || pem.includes("PRIVATE KEY")
    ) {
      throw new Error("invalid_pem_kind");
    }
    const key = name === "AUDIT_JWT_PRIVATE_KEY_FILE"
      ? createPrivateKey(pem)
      : createPublicKey(pem);
    if (key.asymmetricKeyType !== "ed25519") {
      throw new Error("invalid_key_type");
    }
  } catch {
    console.error(`internal_audit_config_file_invalid=${name}`);
    process.exit(1);
  }
}

const networks = process.env.AUDIT_ALLOWED_NETWORKS.split(",").map((value) => value.trim()).filter(Boolean);
if (
  networks.length === 0 ||
  networks.some((network) => {
    const [address, prefix] = network.split("/");
    const prefixLength = Number(prefix);
    const addressFamily = isIP(address);
    return (
      network === "0.0.0.0/0" ||
      network === "::/0" ||
      addressFamily === 0 ||
      !Number.isInteger(prefixLength) ||
      prefixLength !== (addressFamily === 4 ? 32 : 128)
    );
  })
) {
  console.error("internal_audit_config_networks_invalid");
  process.exit(1);
}

const kids = process.env.AUDIT_TECHNICAL_AUTH_ALLOWED_KIDS.split(",").map((value) => value.trim()).filter(Boolean);
if (
  kids.length === 0 ||
  kids.some((kid) => !/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/u.test(kid)) ||
  !kids.includes(process.env.AUDIT_TECHNICAL_AUTH_KID)
) {
  console.error("internal_audit_config_kids_invalid");
  process.exit(1);
}

if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/u.test(process.env.AUDIT_RELEASE_ATTESTATION_KID)) {
  console.error("internal_audit_config_attestation_kid_invalid");
  process.exit(1);
}

console.log("internal_audit_config_ready");
