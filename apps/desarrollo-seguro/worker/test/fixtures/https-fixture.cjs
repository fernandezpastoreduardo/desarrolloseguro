const { execFileSync } = require("node:child_process");
const { mkdtempSync, readFileSync, rmSync } = require("node:fs");
const { tmpdir } = require("node:os");
const { join } = require("node:path");

const fixtureHostname = "scan-fixture.example.net";
const openSslExecutable = "/usr/bin/openssl";

/** Creates test-only TLS material in a private temporary directory. */
function createEphemeralHttpsFixture() {
  const directory = mkdtempSync(join(tmpdir(), "development-security-https-fixture-"));
  const certificatePath = join(directory, "fixture.crt");
  const privateKeyPath = join(directory, "fixture.key");

  try {
    execFileSync(openSslExecutable, [
      "req",
      "-x509",
      "-newkey",
      "rsa:2048",
      "-nodes",
      "-days",
      "1",
      "-subj",
      `/CN=${fixtureHostname}`,
      "-addext",
      `subjectAltName=DNS:${fixtureHostname}`,
      "-keyout",
      privateKeyPath,
      "-out",
      certificatePath,
    ], { stdio: "ignore" });

    return {
      certificate: readFileSync(certificatePath, "utf8"),
      privateKey: readFileSync(privateKeyPath, "utf8"),
    };
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

module.exports = { createEphemeralHttpsFixture };
