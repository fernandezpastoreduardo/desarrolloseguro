import { describe, expect, it } from "vitest";
import { resolveRuntimeCoordinatorConfiguration } from "./runtime-coordinator-configuration.js";

const BASE_ENVIRONMENT: NodeJS.ProcessEnv = {
  DS_RUNTIME_COORDINATOR_SOCKET: "/run/desarrollo-seguro/coordinator.sock",
  DS_RUNTIME_COORDINATOR_UID: "1101",
  DS_RUNTIME_COORDINATOR_GID: "1101",
  DS_RUNTIME_EXECUTOR_IMAGE: "development-security-executor:local",
  DS_RUNTIME_BROKER_IMAGE: "development-security-egress-broker:local",
};

describe("resolveRuntimeCoordinatorConfiguration", () => {
  it("requires explicit socket identity and runtime images", () => {
    expect(resolveRuntimeCoordinatorConfiguration(BASE_ENVIRONMENT)).toEqual({
      socketPath: "/run/desarrollo-seguro/coordinator.sock",
      socketUid: 1101,
      socketGid: 1101,
      executorImage: "development-security-executor:local",
      brokerImage: "development-security-egress-broker:local",
      dockerBinary: "/usr/bin/docker",
      dockerSocketPath: "/var/run/docker.sock",
      egressNetwork: "none",
    });
  });

  it.each([
    ["relative socket path", { DS_RUNTIME_COORDINATOR_SOCKET: "coordinator.sock" }],
    ["invalid socket owner", { DS_RUNTIME_COORDINATOR_UID: "11x" }],
    ["invalid socket group", { DS_RUNTIME_COORDINATOR_GID: "-1" }],
    ["missing executor image", { DS_RUNTIME_EXECUTOR_IMAGE: undefined }],
    ["unsafe executor image", { DS_RUNTIME_EXECUTOR_IMAGE: "--privileged" }],
    ["missing broker image", { DS_RUNTIME_BROKER_IMAGE: undefined }],
    ["relative Docker binary", { DS_RUNTIME_DOCKER_BINARY: "docker" }],
    ["relative Docker socket", { DS_RUNTIME_DOCKER_SOCKET: "docker.sock" }],
    ["unsafe egress network", { DS_RUNTIME_EGRESS_NETWORK: "none;unexpected" }],
  ])("rejects %s", (_label, overrides) => {
    expect(() =>
      resolveRuntimeCoordinatorConfiguration({ ...BASE_ENVIRONMENT, ...overrides }),
    ).toThrow("runtime_coordinator_configuration_invalid");
  });
});
