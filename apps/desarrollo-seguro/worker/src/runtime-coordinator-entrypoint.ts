import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import type { RuntimeCoordinatorRunner } from "./runtime-coordinator-server.js";
import { listenRuntimeCoordinator } from "./runtime-coordinator-server.js";
import {
  createDockerRuntimeCoordinatorRunner,
  createDockerRuntimeSessionFactory,
} from "./docker-runtime-coordinator-runner.js";
import {
  resolveRuntimeCoordinatorConfiguration,
  type RuntimeCoordinatorConfiguration,
} from "./runtime-coordinator-configuration.js";

type RuntimeCoordinatorServer = Awaited<ReturnType<typeof listenRuntimeCoordinator>>;

type RuntimeCoordinatorStartupDependencies = {
  listen?: typeof listenRuntimeCoordinator;
  createRunner?: (configuration: RuntimeCoordinatorConfiguration) => RuntimeCoordinatorRunner;
};

export async function startRuntimeCoordinator(
  environment: NodeJS.ProcessEnv,
  dependencies: RuntimeCoordinatorStartupDependencies = {},
): Promise<RuntimeCoordinatorServer> {
  const configuration = resolveRuntimeCoordinatorConfiguration(environment);
  const runner = dependencies.createRunner?.(configuration) ??
    createDockerRuntimeCoordinatorRunner(
      createDockerRuntimeSessionFactory({
        executorImage: configuration.executorImage,
        brokerImage: configuration.brokerImage,
        dockerBinary: configuration.dockerBinary,
        dockerSocketPath: configuration.dockerSocketPath,
        brokerNetwork: configuration.egressNetwork,
      }),
    );
  const listen = dependencies.listen ?? listenRuntimeCoordinator;
  return listen(
    {
      socketPath: configuration.socketPath,
      socketUid: configuration.socketUid,
      socketGid: configuration.socketGid,
    },
    runner,
  );
}

async function main(): Promise<void> {
  const server = await startRuntimeCoordinator(process.env);
  let closing = false;
  const close = () => {
    if (closing) return;
    closing = true;
    void server.close().then(
      () => {
        process.exitCode = 0;
      },
      () => {
        process.stderr.write("runtime_coordinator_shutdown_failed\n");
        process.exitCode = 1;
      },
    );
  };
  process.once("SIGINT", close);
  process.once("SIGTERM", close);
  await new Promise<void>((resolveWait) => {
    process.once("beforeExit", resolveWait);
  });
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  main().catch(() => {
    process.stderr.write("runtime_coordinator_startup_failed\n");
    process.exitCode = 1;
  });
}
