import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PRIVACY_BROWSER_BUDGET } from "@desarrolloseguro/core";
import {
  createLabPrivacyEgress,
  resolveLabPrivacyEgressConfiguration,
} from "./lab-privacy-egress-entrypoint.mjs";

const { createEphemeralHttpsFixture } = createRequire(import.meta.url)(
  "../../test/fixtures/https-fixture.cjs",
);
const RUN_ID = "fixture";
const HOSTNAME = `scan-${RUN_ID}.example.net`;
const FIXTURE_ALIAS = `public-audit-fixture-${RUN_ID}`;

let certificate;
let temporaryDirectory;
let certificatePath;

beforeAll(async () => {
  certificate = createEphemeralHttpsFixture();
  temporaryDirectory = await mkdtemp(join(tmpdir(), "ds-lab-privacy-egress-test-"));
  certificatePath = join(temporaryDirectory, "fixture-ca.pem");
  await writeFile(certificatePath, certificate.certificate, { mode: 0o600 });
});

afterAll(async () => {
  if (temporaryDirectory) await rm(temporaryDirectory, { recursive: true, force: true });
});

function validEnvironment(overrides = {}) {
  return {
    DS_LAB_RUN_ID: RUN_ID,
    DS_LAB_HOSTNAME: HOSTNAME,
    DS_LAB_FIXTURE_ALIAS: FIXTURE_ALIAS,
    DS_LAB_FIXTURE_ADDRESS: "172.28.0.4",
    DS_LAB_FIXTURE_CA_FILE: certificatePath,
    DS_LAB_PRIVACY_PROXY_PORT: "3128",
    DS_LAB_FIXTURE_HTTPS_PORT: "8443",
    DS_LAB_FIXTURE_HTTP_PORT: "8080",
    DS_LAB_PRIVACY_MAX_RECEIVED_BYTES: "1048576",
    ...overrides,
  };
}

describe("public audit lab privacy egress entrypoint", () => {
  it("creates the real bounded proxy with one run-scoped fixture destination", async () => {
    const { configuration, adapters, proxy } = await createLabPrivacyEgress(validEnvironment());

    expect(configuration).toMatchObject({
      runId: RUN_ID,
      hostname: HOSTNAME,
      fixtureAlias: FIXTURE_ALIAS,
      fixtureAddress: "172.28.0.4",
      proxyPort: 3128,
      httpsPort: 8443,
      httpPort: 8080,
      maxReceivedBytes: 1_048_576,
    });
    expect(await adapters.lookup(HOSTNAME)).toEqual([
      { address: adapters.syntheticAddress, family: 4 },
    ]);
    expect(proxy.stats()).toMatchObject({ openedConnections: 0, receivedBytes: 0, budgetExceeded: false });
    await proxy.close();
  });

  it("rejects run ids, hostnames, aliases, and CA files outside this lab run", async () => {
    await expect(resolveLabPrivacyEgressConfiguration(validEnvironment({
      DS_LAB_RUN_ID: "bad.run",
    }))).rejects.toThrow("lab_run_id_invalid");
    await expect(resolveLabPrivacyEgressConfiguration(validEnvironment({
      DS_LAB_HOSTNAME: "talentoypersonas.com",
    }))).rejects.toThrow("lab_hostname_mismatch");
    await expect(resolveLabPrivacyEgressConfiguration(validEnvironment({
      DS_LAB_FIXTURE_ALIAS: "some-other-container",
    }))).rejects.toThrow("lab_fixture_alias_mismatch");
    await expect(resolveLabPrivacyEgressConfiguration(validEnvironment({
      DS_LAB_FIXTURE_CA_FILE: "relative/fixture.pem",
    }))).rejects.toThrow("lab_fixture_certificate_path_invalid");
    await expect(resolveLabPrivacyEgressConfiguration(validEnvironment({
      DS_LAB_FIXTURE_CA_FILE: join(temporaryDirectory, "missing.pem"),
    }))).rejects.toThrow("lab_fixture_certificate_path_invalid");
  });

  it("rejects invalid or conflicting listener and fixture ports", async () => {
    await expect(resolveLabPrivacyEgressConfiguration(validEnvironment({
      DS_LAB_PRIVACY_PROXY_PORT: "0",
    }))).rejects.toThrow("lab_port_invalid");
    await expect(resolveLabPrivacyEgressConfiguration(validEnvironment({
      DS_LAB_FIXTURE_HTTPS_PORT: "3128",
    }))).rejects.toThrow("lab_ports_conflict");
    await expect(resolveLabPrivacyEgressConfiguration(validEnvironment({
      DS_LAB_FIXTURE_HTTP_PORT: "not-a-port",
    }))).rejects.toThrow("lab_port_invalid");
  });

  it("accepts only a private Docker fixture address", async () => {
    await expect(resolveLabPrivacyEgressConfiguration(validEnvironment({
      DS_LAB_FIXTURE_ADDRESS: "203.0.113.9",
    }))).rejects.toThrow("lab_fixture_address_invalid");
  });

  it("caps bytes to the production privacy budget and rejects invalid values", async () => {
    await expect(resolveLabPrivacyEgressConfiguration(validEnvironment({
      DS_LAB_PRIVACY_MAX_RECEIVED_BYTES: "0",
    }))).rejects.toThrow("lab_byte_limit_invalid");
    await expect(resolveLabPrivacyEgressConfiguration(validEnvironment({
      DS_LAB_PRIVACY_MAX_RECEIVED_BYTES: String(PRIVACY_BROWSER_BUDGET.receivedBytes + 1),
    }))).rejects.toThrow("lab_byte_limit_invalid");
  });

  it("fails closed for foreign hostnames, proxy ports, and destinations", async () => {
    const { adapters, proxy } = await createLabPrivacyEgress(validEnvironment());
    try {
      await expect(adapters.lookup("other.example.net")).rejects.toThrow("lab_egress_hostname_blocked");
      expect(() => adapters.connectPinned(adapters.syntheticAddress, 22))
        .toThrow("lab_egress_destination_blocked");
      expect(() => adapters.connectPinned("127.0.0.1", 443))
        .toThrow("lab_egress_destination_blocked");
      expect(() => adapters.httpsRequestFactory({
        hostname: "other.example.net",
        port: 443,
        protocol: "https:",
        path: "/",
      }, () => undefined)).toThrow("lab_egress_request_blocked");
      expect(() => adapters.httpsRequestFactory({
        hostname: HOSTNAME,
        port: 8443,
        protocol: "https:",
        path: "/",
      }, () => undefined)).toThrow("lab_egress_request_blocked");
    } finally {
      await proxy.close();
    }
  });
});
