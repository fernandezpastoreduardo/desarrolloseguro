import { Readable } from "node:stream";
import { describe, expect, it } from "vitest";
import {
  LAB_FIXTURE_HOST,
  MAX_LAB_STARTUP_REQUEST_BYTES,
  parseLabEgressConfiguration,
  readBoundedRuntimeRequest,
} from "./lab-egress-broker.mjs";

const runId = "12345678-1234-1234-1234-123456789abc";
const hostname = `scan-${runId}.example.net`;
const fixtureHost = `${LAB_FIXTURE_HOST}-${runId}`;
const environment = {
  DS_LAB_RUN_ID: runId,
  DS_LAB_FIXTURE_HOST: fixtureHost,
  DS_LAB_HTTPS_PORT: "8443",
  DS_LAB_HTTP_PORT: "8080",
  DS_LAB_CA_FILE: "/run/public-audit-lab/fixture-ca.pem",
};
const request = {
  protocolVersion: 1,
  hostname,
  profileVersion: "domain-v5",
  targetPath: "/careers?source=lab&run=123",
};

describe("public audit lab egress broker startup", () => {
  it("binds the per-run hostname and preserves the domain-v5 query path", () => {
    const configuration = parseLabEgressConfiguration(environment, request);

    expect(configuration).toMatchObject({
      runId,
      hostname,
      fixtureHost,
      httpsPort: 8443,
      httpPort: 8080,
      profileVersion: "domain-v5",
      targetPath: "/careers?source=lab&run=123",
      certificatePath: "/run/public-audit-lab/fixture-ca.pem",
      brokerSocket: "/run/development-security-egress/broker.sock",
    });
    expect(configuration.targetPath).not.toContain("#");
  });

  it("rejects a runtime hostname that does not match this run id", () => {
    expect(() => parseLabEgressConfiguration(environment, {
      ...request,
      hostname: "scan-another-run.example.net",
    })).toThrow("lab_egress_hostname_mismatch");
  });

  it("rejects malformed run ids, fixture aliases, ports, CA paths and profiles", () => {
    expect(() => parseLabEgressConfiguration({ ...environment, DS_LAB_RUN_ID: "../other" }, request))
      .toThrow("lab_egress_run_id_invalid");
    expect(() => parseLabEgressConfiguration({ ...environment, DS_LAB_FIXTURE_HOST: "127.0.0.1" }, request))
      .toThrow("lab_fixture_alias_invalid");
    expect(() => parseLabEgressConfiguration({ ...environment, DS_LAB_HTTPS_PORT: "0" }, request))
      .toThrow("lab_egress_port_invalid");
    expect(() => parseLabEgressConfiguration({ ...environment, DS_LAB_HTTP_PORT: "65536" }, request))
      .toThrow("lab_egress_port_invalid");
    expect(() => parseLabEgressConfiguration({ ...environment, DS_LAB_CA_FILE: "fixture-ca.pem" }, request))
      .toThrow("lab_fixture_ca_not_mounted");
    expect(() => parseLabEgressConfiguration({ ...environment, DS_LAB_CA_FILE: "/tmp/fixture-ca.pem" }, request))
      .toThrow("lab_fixture_ca_not_mounted");
    expect(() => parseLabEgressConfiguration({ ...environment, DS_LAB_HTTP_PORT: "8443" }, request))
      .toThrow("lab_egress_port_invalid");
    expect(() => parseLabEgressConfiguration(environment, { ...request, profileVersion: "domain-v4" }))
      .toThrow("lab_egress_request_invalid");
  });

  it("bounds and parses the runtime startup JSON by encoded byte length", async () => {
    const payload = JSON.stringify(request);
    expect(await readBoundedRuntimeRequest(Readable.from([payload]))).toEqual(request);
    await expect(readBoundedRuntimeRequest(
      Readable.from(["x".repeat(MAX_LAB_STARTUP_REQUEST_BYTES + 1)]),
    )).rejects.toThrow("lab_egress_request_invalid");
  });
});
