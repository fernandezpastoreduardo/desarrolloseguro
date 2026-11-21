import { describe, expect, it, vi } from "vitest";
import type { RuntimeCoordinatorRunner } from "./runtime-coordinator-server.js";
import { startRuntimeCoordinator } from "./runtime-coordinator-entrypoint.js";

const ENVIRONMENT: NodeJS.ProcessEnv = {
  DS_RUNTIME_COORDINATOR_SOCKET: "/run/desarrollo-seguro/coordinator.sock",
  DS_RUNTIME_COORDINATOR_UID: "1101",
  DS_RUNTIME_COORDINATOR_GID: "1101",
  DS_RUNTIME_EXECUTOR_IMAGE: "development-security-executor:local",
  DS_RUNTIME_BROKER_IMAGE: "development-security-egress-broker:local",
  DS_RUNTIME_PRIVACY_BROWSER_IMAGE: "development-security-privacy-browser:local",
  DS_RUNTIME_PRIVACY_EGRESS_IMAGE: "development-security-privacy-egress:local",
};

describe("startRuntimeCoordinator", () => {
  it("connects the configured Docker runner to the protected Unix socket server", async () => {
    const runner: RuntimeCoordinatorRunner = {
      execute: vi.fn(async () => {
        throw new Error("unused_test_runner");
      }),
    };
    const createRunner = vi.fn(() => runner);
    const close = vi.fn(async () => undefined);
    const listen = vi.fn(async () => ({ close }));

    await expect(
      startRuntimeCoordinator(ENVIRONMENT, { createRunner, listen }),
    ).resolves.toEqual({ close });

    expect(createRunner).toHaveBeenCalledWith({
      socketPath: "/run/desarrollo-seguro/coordinator.sock",
      socketUid: 1101,
      socketGid: 1101,
      executorImage: "development-security-executor:local",
      brokerImage: "development-security-egress-broker:local",
      privacyBrowserImage: "development-security-privacy-browser:local",
      privacyEgressImage: "development-security-privacy-egress:local",
      dockerBinary: "/usr/bin/docker",
      dockerSocketPath: "/var/run/docker.sock",
      egressNetwork: "none",
    });
    expect(listen).toHaveBeenCalledExactlyOnceWith(
      {
        socketPath: "/run/desarrollo-seguro/coordinator.sock",
        socketUid: 1101,
        socketGid: 1101,
      },
      runner,
    );
  });

  it("rejects invalid runtime configuration before opening the socket", async () => {
    const listen = vi.fn();

    await expect(
      startRuntimeCoordinator({ ...ENVIRONMENT, DS_RUNTIME_COORDINATOR_UID: "invalid" }, {
        listen: listen as never,
      }),
    ).rejects.toThrow("runtime_coordinator_configuration_invalid");
    expect(listen).not.toHaveBeenCalled();
  });
});
