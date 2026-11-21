import { isAbsolute } from "node:path";

const SOCKET_PATH = "DS_RUNTIME_COORDINATOR_SOCKET";
const SOCKET_UID = "DS_RUNTIME_COORDINATOR_UID";
const SOCKET_GID = "DS_RUNTIME_COORDINATOR_GID";
const EXECUTOR_IMAGE = "DS_RUNTIME_EXECUTOR_IMAGE";
const BROKER_IMAGE = "DS_RUNTIME_BROKER_IMAGE";
const PRIVACY_BROWSER_IMAGE = "DS_RUNTIME_PRIVACY_BROWSER_IMAGE";
const PRIVACY_EGRESS_IMAGE = "DS_RUNTIME_PRIVACY_EGRESS_IMAGE";
const DOCKER_BINARY = "DS_RUNTIME_DOCKER_BINARY";
const DOCKER_SOCKET = "DS_RUNTIME_DOCKER_SOCKET";
const EGRESS_NETWORK = "DS_RUNTIME_EGRESS_NETWORK";
const DEFAULT_DOCKER_BINARY = "/usr/bin/docker";
const DEFAULT_DOCKER_SOCKET = "/var/run/docker.sock";
const DEFAULT_EGRESS_NETWORK = "none";
const IMAGE_REFERENCE = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$/u;
const NETWORK_REFERENCE = /^(?:none|[A-Za-z0-9][A-Za-z0-9_.-]{0,127})$/u;

export type RuntimeCoordinatorConfiguration = {
  socketPath: string;
  socketUid: number;
  socketGid: number;
  executorImage: string;
  brokerImage: string;
  privacyBrowserImage: string;
  privacyEgressImage: string;
  dockerBinary: string;
  dockerSocketPath: string;
  egressNetwork: string;
};

export function resolveRuntimeCoordinatorConfiguration(
  environment: NodeJS.ProcessEnv,
): RuntimeCoordinatorConfiguration {
  const socketPath = environment[SOCKET_PATH];
  const socketUid = parseNonNegativeInteger(environment[SOCKET_UID]);
  const socketGid = parseNonNegativeInteger(environment[SOCKET_GID]);
  const executorImage = environment[EXECUTOR_IMAGE];
  const brokerImage = environment[BROKER_IMAGE];
  const privacyBrowserImage = environment[PRIVACY_BROWSER_IMAGE];
  const privacyEgressImage = environment[PRIVACY_EGRESS_IMAGE];
  const dockerBinary = environment[DOCKER_BINARY] ?? DEFAULT_DOCKER_BINARY;
  const dockerSocketPath = environment[DOCKER_SOCKET] ?? DEFAULT_DOCKER_SOCKET;
  const egressNetwork = environment[EGRESS_NETWORK] ?? DEFAULT_EGRESS_NETWORK;

  if (
    !socketPath ||
    !isAbsolute(socketPath) ||
    socketUid === null ||
    socketGid === null ||
    !executorImage ||
    !IMAGE_REFERENCE.test(executorImage) ||
    !brokerImage ||
    !IMAGE_REFERENCE.test(brokerImage) ||
    !privacyBrowserImage ||
    !IMAGE_REFERENCE.test(privacyBrowserImage) ||
    !privacyEgressImage ||
    !IMAGE_REFERENCE.test(privacyEgressImage) ||
    !isAbsolute(dockerBinary) ||
    !isAbsolute(dockerSocketPath) ||
    !NETWORK_REFERENCE.test(egressNetwork)
  ) {
    throw new Error("runtime_coordinator_configuration_invalid");
  }

  return {
    socketPath,
    socketUid,
    socketGid,
    executorImage,
    brokerImage,
    privacyBrowserImage,
    privacyEgressImage,
    dockerBinary,
    dockerSocketPath,
    egressNetwork,
  };
}

function parseNonNegativeInteger(value: string | undefined): number | null {
  if (!value || !/^(0|[1-9]\d*)$/u.test(value)) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : null;
}
