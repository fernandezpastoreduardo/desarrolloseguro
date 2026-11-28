import { readFile } from "node:fs/promises";
import process from "node:process";
import { createHttpsFixture } from "./https-fixture.mjs";

async function main() {
  let stage = "configuration";
  try {
    const runId = requiredEnvironment("DS_LAB_RUN_ID");
    const keyPath = requiredEnvironment("DS_LAB_TLS_KEY_FILE");
    const certificatePath = requiredEnvironment("DS_LAB_TLS_CERT_FILE");
    stage = "read_certificate";
    const privateKeyPem = await readFile(keyPath);
    const certificatePem = await readFile(certificatePath, "utf8");
    stage = "listen";
    const fixture = await createHttpsFixture({
      runId,
      listenHost: "0.0.0.0",
      httpsPort: readPort(process.env.DS_LAB_HTTPS_PORT, 8443),
      httpPort: readPort(process.env.DS_LAB_HTTP_PORT, 8080),
      privateKeyPem,
      certificatePem,
    });

    process.stdout.write(`${JSON.stringify({
      event: "public_audit_lab_fixture_ready",
      hostname: fixture.hostname,
      httpsPort: fixture.httpsPort,
      httpPort: fixture.httpPort,
    })}\n`);

    let closing = false;
    const close = async () => {
      if (closing) return;
      closing = true;
      try {
        await fixture.close();
        process.stdout.write("public_audit_lab_fixture_closed\n");
        process.exitCode = 0;
      } catch {
        process.stderr.write("public_audit_lab_fixture_close_failed\n");
        process.exitCode = 1;
      }
    };
    process.once("SIGTERM", () => { void close(); });
    process.once("SIGINT", () => { void close(); });
  } catch (error) {
    const knownCodes = new Set(["EACCES", "EADDRINUSE", "ENOENT", "ERR_OSSL_PEM_NO_START_LINE"]);
    const code = knownCodes.has(error?.code) ? error.code : "OTHER";
    process.stderr.write(`${JSON.stringify({
      event: "public_audit_lab_fixture_start_failed",
      stage,
      code,
    })}\n`);
    process.exitCode = 1;
  }
}

function requiredEnvironment(name) {
  const value = process.env[name];
  if (typeof value !== "string" || value.length === 0 || value.includes("\n")) {
    throw new Error("public_audit_lab_configuration_invalid");
  }
  return value;
}

function readPort(value, fallback) {
  if (value === undefined) return fallback;
  const port = Number(value);
  if (!Number.isSafeInteger(port) || port < 1 || port > 65_535) {
    throw new Error("public_audit_lab_configuration_invalid");
  }
  return port;
}

void main();
