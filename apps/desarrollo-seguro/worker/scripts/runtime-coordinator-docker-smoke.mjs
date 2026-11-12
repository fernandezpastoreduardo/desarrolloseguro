import { randomUUID } from "node:crypto";
import process from "node:process";
import {
  createDockerRuntimeCoordinatorRunner,
  createDockerRuntimeSessionFactory,
} from "../dist/docker-runtime-coordinator-runner.js";

const executorImage = process.env.DS_RUNTIME_EXECUTOR_IMAGE;
const brokerImage = process.env.DS_RUNTIME_BROKER_IMAGE;
if (!executorImage || !brokerImage) {
  process.stderr.write("runtime_smoke_images_missing\n");
  process.exit(2);
}

const runner = createDockerRuntimeCoordinatorRunner(
  createDockerRuntimeSessionFactory({ executorImage, brokerImage }),
);
const signal = {
  aborted: false,
  addEventListener() {},
  removeEventListener() {},
};

try {
  try {
    await runner.execute({
      protocolVersion: 1,
      requestId: randomUUID(),
      hostname: "example.org",
      profileVersion: "transport-v1",
    }, signal);
    throw new Error("runtime_smoke_empty_observation_was_accepted");
  } catch (error) {
    if (!(error instanceof Error) || error.message !== "executor_failed") throw error;
  }
  process.stdout.write(
    "Docker runtime lifecycle passed; empty network-disabled observations were rejected.\n",
  );
} catch (error) {
  const safeFailureCode = getSafeFailureCode(error);
  process.stderr.write(`${safeFailureCode}\n`);
  process.exitCode = 1;
}

function getSafeFailureCode(error) {
  if (!(error instanceof Error)) return "docker_runner_failed";
  const causeCode = getSafeFailureCode(error.cause);
  if (causeCode !== "docker_runner_failed") return causeCode;
  const allowedCodes = new Set([
    "broker_failed",
    "coordinator_socket_untrusted",
    "coordinator_unavailable",
    "egress_failed",
    "executor_failed",
    "executor_response_invalid",
    "egress_broker_startup_failed",
    "egress_broker_startup_invalid",
    "egress_broker_socket_directory_invalid",
    "egress_broker_socket_invalid",
    "egress_broker_socket_listen_failed",
    "egress_broker_socket_setup_failed",
    "request_aborted",
    "runtime_volume_failed",
    "transport_failed",
    "runtime_broker_ready_failed",
    "runtime_broker_start_failed",
    "runtime_cleanup_failed",
    "runtime_coordinator_unavailable",
    "runtime_volume_create_failed",
    "runtime_volume_prepare_failed",
  ]);
  if (allowedCodes.has(error.message)) return error.message;
  if (error.message.startsWith("runtime_smoke_unexpected_result:")) return error.message;
  return "docker_runner_failed";
}
