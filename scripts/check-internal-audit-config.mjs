import { readFileSync, statSync } from "node:fs";
import { isIP } from "node:net";

const enabled = process.env.AUDIT_ENABLED === "true";
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
  "AUDIT_ALLOWED_NETWORKS",
  "AUDIT_TECHNICAL_AUTH_ALLOWED_KIDS",
];
const missing = required.filter((name) => !process.env[name]);
if (missing.length > 0) {
  console.error(`internal_audit_config_missing=${missing.join(",")}`);
  process.exit(1);
}

for (const name of ["AUDIT_JWT_PRIVATE_KEY_FILE", "AUDIT_RELEASE_ATTESTATION_PUBLIC_KEY_FILE"]) {
  const file = process.env[name];
  try {
    const stats = statSync(file);
    if (!stats.isFile() || (stats.mode & 0o077) !== 0 || readFileSync(file, "utf8").trim().length === 0) {
      throw new Error("invalid_file");
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
      prefixLength < 1 ||
      prefixLength > (addressFamily === 4 ? 32 : 128)
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

console.log("internal_audit_config_ready");
