import { describe, expect, it, vi } from "vitest";
import {
  LAB_BROKER_IMAGE_REPOSITORY,
  LAB_CERTIFICATE_PATH,
  LAB_DOCKER_REAL_BINARY,
  LAB_PRIVACY_EGRESS_IMAGE_REPOSITORY,
  LAB_RESOURCE_LABEL,
  resolveLabDockerShimConfiguration,
  rewriteLabDockerArguments,
  runLabDockerCli,
} from "./lab-docker-cli.mjs";

const RUN_ID = "7f2e9120-29dc-4c55-8568-9d3773b9";

function environment(overrides = {}) {
  return {
    DS_LAB_RUN_ID: RUN_ID,
    DS_LAB_BROKER_IMAGE: `${LAB_BROKER_IMAGE_REPOSITORY}:${RUN_ID}`,
    DS_LAB_PRIVACY_EGRESS_IMAGE: `${LAB_PRIVACY_EGRESS_IMAGE_REPOSITORY}:${RUN_ID}`,
    DS_LAB_DOCKER_REAL_BIN: LAB_DOCKER_REAL_BINARY,
    ...overrides,
  };
}

function config(overrides = {}) {
  return resolveLabDockerShimConfiguration(environment(overrides));
}

describe("public audit lab Docker CLI shim", () => {
  it("requires a strict run id and images tagged for that exact run", () => {
    expect(config()).toMatchObject({
      runId: RUN_ID,
      brokerImage: `${LAB_BROKER_IMAGE_REPOSITORY}:${RUN_ID}`,
      privacyEgressImage: `${LAB_PRIVACY_EGRESS_IMAGE_REPOSITORY}:${RUN_ID}`,
      hostname: `scan-${RUN_ID}.example.net`,
      fixtureAlias: `public-audit-fixture-${RUN_ID}`,
      certificatePath: LAB_CERTIFICATE_PATH,
    });
    expect(() => config({ DS_LAB_RUN_ID: "../main" })).toThrow("lab_docker_run_id_invalid");
    expect(() => config({ DS_LAB_RUN_ID: "UPPERCASE" })).toThrow("lab_docker_run_id_invalid");
    expect(() => config({ DS_LAB_BROKER_IMAGE: "desarrolloseguro-egress-broker:local" }))
      .toThrow("lab_docker_image_scope_invalid");
    expect(() => config({ DS_LAB_PRIVACY_EGRESS_IMAGE: "desarrolloseguro-privacy-egress:local" }))
      .toThrow("lab_docker_image_scope_invalid");
  });

  it("passes inspection, cleanup and unrelated Docker commands through unchanged", () => {
    const configuration = config();
    for (const args of [
      ["info", "--format", "{{.ServerVersion}}"],
      ["--host", "unix:///var/run/docker.sock", "info", "--format", "{{.ServerVersion}}"],
      ["ps", "--all", "--quiet"],
      ["rm", "--force", "unrelated-container"],
      ["network", "connect", "existing-network", "existing-container"],
      ["volume", "rm", "existing-volume"],
    ]) {
      expect(rewriteLabDockerArguments(args, configuration)).toEqual(args);
    }
  });

  it("adds the run label to run, volume create and network create without changing existing options", () => {
    const configuration = config();
    expect(rewriteLabDockerArguments([
      "volume", "create", "--label", "io.desarrolloseguro.role=ephemeral-runtime", "run-volume",
    ], configuration)).toEqual([
      "volume", "create", "--label", "io.desarrolloseguro.role=ephemeral-runtime",
      "--label", `${LAB_RESOURCE_LABEL}=${RUN_ID}`, "run-volume",
    ]);
    expect(rewriteLabDockerArguments([
      "network", "create", "--internal", "--label=io.desarrolloseguro.role=ephemeral-privacy", "run-network",
    ], configuration)).toEqual([
      "network", "create", "--internal", "--label=io.desarrolloseguro.role=ephemeral-privacy",
      "--label", `${LAB_RESOURCE_LABEL}=${RUN_ID}`, "run-network",
    ]);
    expect(rewriteLabDockerArguments([
      "--host", "unix:///var/run/docker.sock", "run", "--interactive", "--name", "development-security-executor-job",
      "--network", "none", "--read-only", "--mount", "type=volume,source=runtime,target=/run/runtime",
      "desarrolloseguro-executor:local", "--input",
    ], configuration)).toEqual([
      "--host", "unix:///var/run/docker.sock", "run", "--interactive", "--name", "development-security-executor-job",
      "--network", "none", "--read-only", "--mount", "type=volume,source=runtime,target=/run/runtime",
      "--label", `${LAB_RESOURCE_LABEL}=${RUN_ID}`,
      "desarrolloseguro-executor:local", "--input",
    ]);
  });

  it("injects only fixed run-scoped environment into the exact broker image", () => {
    const configuration = config();
    const args = rewriteLabDockerArguments([
      "--host", "unix:///var/run/docker.sock", "run", "--interactive", "--name", "development-security-broker-job",
      "--network", "lab-egress", "--mount", "type=volume,source=runtime,target=/run/development-security-egress",
      configuration.brokerImage,
    ], configuration);
    expect(args).toEqual(expect.arrayContaining([
      "--env", `DS_LAB_RUN_ID=${RUN_ID}`,
      "--env", `DS_LAB_HOSTNAME=scan-${RUN_ID}.example.net`,
      "--env", `DS_LAB_FIXTURE_ALIAS=public-audit-fixture-${RUN_ID}`,
      "--env", `DS_LAB_FIXTURE_HOST=public-audit-fixture-${RUN_ID}`,
      "--env", `DS_LAB_CA_FILE=${LAB_CERTIFICATE_PATH}`,
      "--env", "DS_LAB_HTTPS_PORT=8443",
      "--env", "DS_LAB_HTTP_PORT=8080",
      "--label", `${LAB_RESOURCE_LABEL}=${RUN_ID}`,
    ]));
    expect(args).not.toContain("--mount=type=bind");
    expect(args.slice(0, 2)).toEqual(["--host", "unix:///var/run/docker.sock"]);
    expect(args.at(-1)).toBe(configuration.brokerImage);
  });

  it("injects only fixed run-scoped environment into the exact privacy proxy image", () => {
    const configuration = config();
    const args = rewriteLabDockerArguments([
      "run", "--detach", "--name", "development-security-privacy-proxy-job",
      "--network", "lab-egress", "--read-only", configuration.privacyEgressImage,
    ], configuration);
    expect(args).toEqual(expect.arrayContaining([
      "--env", `DS_LAB_RUN_ID=${RUN_ID}`,
      "--env", `DS_LAB_HOSTNAME=scan-${RUN_ID}.example.net`,
      "--env", `DS_LAB_FIXTURE_ALIAS=public-audit-fixture-${RUN_ID}`,
      "--env", `DS_LAB_FIXTURE_CA_FILE=${LAB_CERTIFICATE_PATH}`,
      "--env", "DS_LAB_PRIVACY_PROXY_PORT=3128",
      "--env", "DS_LAB_FIXTURE_HTTPS_PORT=8443",
      "--env", "DS_LAB_FIXTURE_HTTP_PORT=8080",
      "--label", `${LAB_RESOURCE_LABEL}=${RUN_ID}`,
    ]));
    expect(args.at(-1)).toBe(configuration.privacyEgressImage);
  });

  it("does not inject lab environment into non-lab or similarly named images", () => {
    const configuration = config();
    for (const image of [
      "desarrolloseguro-egress-broker:local",
      `${LAB_BROKER_IMAGE_REPOSITORY}:${RUN_ID}-other`,
      `${LAB_PRIVACY_EGRESS_IMAGE_REPOSITORY}:other-run`,
    ]) {
      const args = rewriteLabDockerArguments(["run", "--rm", image], configuration);
      expect(args).not.toContain("--env");
      expect(args).toContain("--label");
    }
  });

  it("fails closed on ambiguous image options, env files and reserved label overrides", () => {
    const configuration = config();
    expect(() => rewriteLabDockerArguments(["run", "--mystery", "value", "image:tag"], configuration))
      .toThrow("lab_docker_run_option_unsupported");
    expect(() => rewriteLabDockerArguments(["run", "--env-file", "secrets.env", configuration.brokerImage], configuration))
      .toThrow("lab_docker_lab_image_env_file_forbidden");
    expect(() => rewriteLabDockerArguments([
      "run", "--env", "DS_LAB_RUN_ID=other", configuration.brokerImage,
    ], configuration)).toThrow("lab_docker_lab_environment_override_forbidden");
    expect(() => rewriteLabDockerArguments([
      "run", "--env=DS_LAB_FIXTURE_ALIAS=other", configuration.privacyEgressImage,
    ], configuration)).toThrow("lab_docker_lab_environment_override_forbidden");
    expect(() => rewriteLabDockerArguments([
      "run", "--label", `${LAB_RESOURCE_LABEL}=another-run`, "image:tag",
    ], configuration)).toThrow("lab_docker_reserved_label_supplied");
    expect(() => rewriteLabDockerArguments([
      "network", "create", "--internal", "--label", `${LAB_RESOURCE_LABEL}=another-run`, "network",
    ], configuration)).toThrow("lab_docker_reserved_label_supplied");
  });

  it("rejects incomplete creation commands before Docker is invoked", () => {
    const configuration = config();
    expect(() => rewriteLabDockerArguments(["run", "--name"], configuration))
      .toThrow("lab_docker_run_option_value_missing");
    expect(() => rewriteLabDockerArguments(["volume", "create", "--label"], configuration))
      .toThrow("lab_docker_create_option_value_missing");
    expect(() => rewriteLabDockerArguments(["network", "create", "--internal"], configuration))
      .toThrow("lab_docker_create_name_missing");
  });

  it("executes the selected Docker binary with rewritten arguments and inherited streams", () => {
    const configuration = config();
    const child = { once: vi.fn() };
    const spawnChild = vi.fn(() => child);
    runLabDockerCli(["--host", "unix:///var/run/docker.sock", "network", "create", "--internal", "lab-network"], environment(), spawnChild);
    expect(spawnChild).toHaveBeenCalledWith(LAB_DOCKER_REAL_BINARY, [
      "--host", "unix:///var/run/docker.sock", "network", "create", "--internal", "--label", `${LAB_RESOURCE_LABEL}=${RUN_ID}`, "lab-network",
    ], { stdio: "inherit" });
    expect(child.once).toHaveBeenCalledTimes(2);
    expect(configuration.realDockerBinary).toBe(LAB_DOCKER_REAL_BINARY);
  });
});
