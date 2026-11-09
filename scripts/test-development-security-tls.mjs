import assert from "node:assert/strict";
import {
  chmodSync,
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
} from "node:fs";
import { X509Certificate } from "node:crypto";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";

const DEVELOPMENT_SECURITY_TLS_GENERATOR = resolve(
  "scripts/generate-development-security-tls.sh",
);
const TEMP_DIRECTORY = mkdtempSync(join(tmpdir(), "development-security-tls-"));
const CA_DIRECTORY = join(TEMP_DIRECTORY, "offline-ca");
const OUTPUT_DIRECTORY = join(TEMP_DIRECTORY, "runtime-secrets");
const CERTIFICATES = [
  {
    hostname: "development-security-api",
    certificate: "development_security_api_tls.crt",
    privateKey: "development_security_api_tls.key",
  },
  {
    hostname: "development-security-database",
    certificate: "development_security_database_tls.crt",
    privateKey: "development_security_database_tls.key",
  },
];

function run(command, args, expectedStatus = 0) {
  const result = spawnSync(command, args, { encoding: "utf8" });
  assert.equal(
    result.status,
    expectedStatus,
    `${command} ${args.join(" ")} failed: ${result.stderr}`,
  );
  return result.stdout.trim();
}

try {
  chmodSync(TEMP_DIRECTORY, 0o700);
  run("mkdir", ["-m", "700", CA_DIRECTORY, OUTPUT_DIRECTORY]);
  const caKeyPath = join(CA_DIRECTORY, "internal_tls_ca.key");
  const caCertificatePath = join(CA_DIRECTORY, "internal_tls_ca.crt");
  run("openssl", [
    "req",
    "-x509",
    "-newkey",
    "rsa:3072",
    "-nodes",
    "-sha256",
    "-days",
    "10",
    "-keyout",
    caKeyPath,
    "-out",
    caCertificatePath,
    "-subj",
    "/CN=Development Security test CA",
    "-addext",
    "basicConstraints=critical,CA:TRUE,pathlen:0",
    "-addext",
    "keyUsage=critical,keyCertSign,cRLSign",
  ]);
  run("bash", [
    DEVELOPMENT_SECURITY_TLS_GENERATOR,
    CA_DIRECTORY,
    OUTPUT_DIRECTORY,
  ]);

  const privateOutputNames = [];
  for (const { hostname, certificate, privateKey } of CERTIFICATES) {
    const certificatePath = join(OUTPUT_DIRECTORY, certificate);
    const privateKeyPath = join(OUTPUT_DIRECTORY, privateKey);
    const parsedCertificate = new X509Certificate(
      readFileSync(certificatePath),
    );

    assert.equal(parsedCertificate.checkHost(hostname), hostname);
    const certificateText = run("openssl", [
      "x509",
      "-in",
      certificatePath,
      "-noout",
      "-text",
    ]);
    assert.match(
      certificateText,
      /X509v3 Basic Constraints: critical\s+CA:FALSE/u,
    );
    assert.match(
      certificateText,
      /X509v3 Key Usage: critical\s+Digital Signature, Key Encipherment/u,
    );
    assert.match(
      certificateText,
      /X509v3 Extended Key Usage:\s+TLS Web Server Authentication/u,
    );
    assert.match(
      certificateText,
      new RegExp(`X509v3 Subject Alternative Name:\\s+DNS:${hostname}`, "u"),
    );
    assert.equal(
      run("openssl", ["verify", "-CAfile", caCertificatePath, certificatePath]),
      `${certificatePath}: OK`,
    );
    assert.equal(
      run("openssl", ["x509", "-in", certificatePath, "-pubkey", "-noout"]),
      run("openssl", ["pkey", "-in", privateKeyPath, "-pubout"]),
      `${certificate} must match its private key`,
    );
    assert.equal(statSync(privateKeyPath).mode & 0o777, 0o600);
    assert.equal(statSync(certificatePath).mode & 0o777, 0o644);
    privateOutputNames.push(privateKey);
  }

  const apiKeyBeforeSecondGeneration = readFileSync(
    join(OUTPUT_DIRECTORY, CERTIFICATES[0].privateKey),
  );
  const secondRun = spawnSync(
    "bash",
    [DEVELOPMENT_SECURITY_TLS_GENERATOR, CA_DIRECTORY, OUTPUT_DIRECTORY],
    { encoding: "utf8" },
  );
  assert.notEqual(
    secondRun.status,
    0,
    "existing leaf keys must never be overwritten",
  );
  assert.match(
    secondRun.stderr,
    /Refusing to overwrite existing Development Security TLS material/u,
  );
  assert.deepEqual(
    readFileSync(join(OUTPUT_DIRECTORY, CERTIFICATES[0].privateKey)),
    apiKeyBeforeSecondGeneration,
  );

  for (const privateKey of privateOutputNames) {
    assert.equal(
      statSync(join(OUTPUT_DIRECTORY, privateKey)).mode & 0o777,
      0o600,
    );
  }

  const mismatchedCaDirectory = join(TEMP_DIRECTORY, "mismatched-ca");
  const mismatchedOutputDirectory = join(TEMP_DIRECTORY, "mismatched-output");
  mkdirSync(mismatchedCaDirectory, { mode: 0o700 });
  mkdirSync(mismatchedOutputDirectory, { mode: 0o700 });
  copyFileSync(
    caCertificatePath,
    join(mismatchedCaDirectory, "internal_tls_ca.crt"),
  );
  copyFileSync(
    join(OUTPUT_DIRECTORY, CERTIFICATES[0].privateKey),
    join(mismatchedCaDirectory, "internal_tls_ca.key"),
  );
  const mismatchedCaRun = spawnSync(
    "bash",
    [
      DEVELOPMENT_SECURITY_TLS_GENERATOR,
      mismatchedCaDirectory,
      mismatchedOutputDirectory,
    ],
    { encoding: "utf8" },
  );
  assert.notEqual(
    mismatchedCaRun.status,
    0,
    "a mismatched CA key must be rejected",
  );
  assert.deepEqual(
    readdirSync(mismatchedOutputDirectory),
    [],
    "failed signing must not leave partial certificates or temporary files",
  );

  console.log("Development Security TLS certificate checks passed");
} finally {
  rmSync(TEMP_DIRECTORY, { recursive: true, force: true });
}
