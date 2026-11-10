import { chmodSync, existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createPrivateKey, createPublicKey, X509Certificate } from "node:crypto";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const { createEphemeralHttpsFixture } = createRequire(import.meta.url)(
  "../test/fixtures/https-fixture.cjs",
) as { createEphemeralHttpsFixture: () => { certificate: string; privateKey: string } };

const FIXTURE_HOSTNAME = "scan-fixture.example.net";
const STATIC_PRIVATE_KEY_PATH = fileURLToPath(
  new URL("../test/fixtures/https-fixture.key", import.meta.url),
);

describe("ephemeral HTTPS test fixture", () => {
  it("creates a matching certificate and key outside the repository", () => {
    const { certificate, privateKey } = createEphemeralHttpsFixture();
    const parsedCertificate = new X509Certificate(certificate);
    const derivedPublicKey = createPublicKey(createPrivateKey(privateKey));

    expect(parsedCertificate.checkHost(FIXTURE_HOSTNAME)).toBe(FIXTURE_HOSTNAME);
    expect(derivedPublicKey.export({ type: "spki", format: "der" })).toEqual(
      parsedCertificate.publicKey.export({ type: "spki", format: "der" }),
    );
    expect(existsSync(STATIC_PRIVATE_KEY_PATH)).toBe(false);
  });

  it("does not resolve OpenSSL from a caller-controlled PATH", () => {
    const fakeBin = mkdtempSync(join(tmpdir(), "development-security-fake-bin-"));
    const fakeOpenSsl = join(fakeBin, "openssl");
    const originalPath = process.env.PATH;
    writeFileSync(fakeOpenSsl, "#!/bin/sh\nexit 99\n");
    chmodSync(fakeOpenSsl, 0o755);

    try {
      process.env.PATH = fakeBin;
      const fixture = createEphemeralHttpsFixture();
      expect(new X509Certificate(fixture.certificate).checkHost(FIXTURE_HOSTNAME))
        .toBe(FIXTURE_HOSTNAME);
    } finally {
      if (originalPath === undefined) delete process.env.PATH;
      else process.env.PATH = originalPath;
      rmSync(fakeBin, { recursive: true, force: true });
    }
  });
});
