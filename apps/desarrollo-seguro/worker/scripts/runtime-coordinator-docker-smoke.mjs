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
  const result = await runner.execute({
    protocolVersion: 1,
    requestId: randomUUID(),
    hostname: "example.org",
    profileVersion: "transport-v1",
  }, signal);
  if (
    result.verdict !== "inconclusive" ||
    result.checks.length !== 5 ||
    result.checks.some((check) => check.status !== "unknown")
  ) {
    const statuses = result.checks.map((check) => check.status).join(",");
    throw new Error(`runtime_smoke_unexpected_result:${result.verdict}:${statuses}`);
  }
  process.stdout.write(
    "Docker runtime lifecycle passed; network-disabled observations remained inconclusive.\n",
  );
} catch (error) {
  const safeFailureCode = getSafeFailureCode(error);
  process.stderr.write(`${safeFailureCode}\n`);
  process.exitCode = 1;
}

function getSafeFailureCode(error) {
  if (!(error instanceof Error)) return "docker_runner_failed";
  const allowedCodes = new Set([
    "executor_failed",
    "executor_response_invalid",
    "request_aborted",
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
