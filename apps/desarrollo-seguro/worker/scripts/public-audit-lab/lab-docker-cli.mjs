#!/usr/bin/env node
import { spawn } from "node:child_process";
import { isIPv4 } from "node:net";
import process from "node:process";
import { isAbsolute } from "node:path";
import { pathToFileURL } from "node:url";

export const LAB_RESOURCE_LABEL = "com.desarrolloseguro.public-audit-lab.run";
export const LAB_CERTIFICATE_PATH = "/run/public-audit-lab/fixture.pem";
export const LAB_BROKER_IMAGE_REPOSITORY = "desarrolloseguro-public-audit-lab-broker";
export const LAB_PRIVACY_EGRESS_IMAGE_REPOSITORY = "desarrolloseguro-public-audit-lab-privacy-egress";
export const LAB_DOCKER_REAL_BINARY = "/usr/bin/docker";

const RUN_ID_PATTERN = /^[a-z0-9](?:[a-z0-9-]{0,46}[a-z0-9])?$/u;
const CREATE_OPTIONS_WITH_VALUE = new Set(["--driver", "--opt", "--scope", "--config-from", "--ipam-driver", "--ipam-opt", "--subnet", "--ip-range", "--gateway", "--aux-address"]);
const CREATE_BOOLEAN_OPTIONS = new Set(["--internal", "--attachable", "--ipv6", "--ingress", "--config-only"]);
const RUN_BOOLEAN_OPTIONS = new Set(["--rm", "--interactive", "--detach", "--read-only", "--tty"]);
const RUN_SHORT_OPTIONS_WITH_VALUE = new Set(["-a", "-e", "-l", "-v", "-p", "-u", "-w"]);
const RUN_SHORT_BOOLEAN_OPTIONS = new Set(["-i", "-d", "-t"]);
const DOCKER_GLOBAL_OPTIONS_WITH_VALUE = new Set([
  "--config", "--context", "--host", "--log-level", "--tlscacert", "--tlscert", "--tlskey", "-H",
]);
const DOCKER_GLOBAL_BOOLEAN_OPTIONS = new Set(["--debug", "--tls", "--tlsverify", "-D"]);
const RUN_OPTIONS_WITH_VALUE = new Set([
  "--add-host", "--annotation", "--attach", "--blkio-weight", "--cap-add", "--cap-drop",
  "--cgroup-parent", "--cgroupns", "--cidfile", "--cpu-period", "--cpu-quota", "--cpu-rt-period",
  "--cpu-rt-runtime", "--cpu-shares", "--cpus", "--cpuset-cpus", "--cpuset-mems", "--device",
  "--device-cgroup-rule", "--device-read-bps", "--device-read-iops", "--device-write-bps",
  "--device-write-iops", "--dns", "--dns-opt", "--dns-option", "--dns-search", "--domainname",
  "--entrypoint", "--env", "--env-file", "--expose", "--gpus", "--group-add", "--health-cmd",
  "--health-interval", "--health-retries", "--health-start-period", "--health-timeout", "--hostname",
  "--ip", "--ip6", "--ipc", "--isolation", "--kernel-memory", "--label", "--link", "--link-local-ip",
  "--log-driver", "--log-opt", "--mac-address", "--memory", "--memory-reservation", "--memory-swap",
  "--memory-swappiness", "--mount", "--name", "--network", "--network-alias", "--oom-score-adj",
  "--pid", "--pids-limit", "--platform", "--publish", "--restart", "--runtime", "--security-opt",
  "--shm-size", "--stop-signal", "--stop-timeout", "--storage-opt", "--sysctl", "--tmpfs", "--ulimit",
  "--user", "--userns", "--uts", "--volume", "--volumes-from", "--workdir",
]);

/** Validates the test-only shim configuration before it invokes any Docker command. */
export function resolveLabDockerShimConfiguration(environment) {
  const runId = environment.DS_LAB_RUN_ID;
  if (typeof runId !== "string" || !RUN_ID_PATTERN.test(runId)) {
    throw new Error("lab_docker_run_id_invalid");
  }

  const normalizedRunId = runId.toLowerCase();
  const expectedBrokerImage = `${LAB_BROKER_IMAGE_REPOSITORY}:${normalizedRunId}`;
  const expectedPrivacyImage = `${LAB_PRIVACY_EGRESS_IMAGE_REPOSITORY}:${normalizedRunId}`;
  if (environment.DS_LAB_BROKER_IMAGE !== expectedBrokerImage ||
      environment.DS_LAB_PRIVACY_EGRESS_IMAGE !== expectedPrivacyImage) {
    throw new Error("lab_docker_image_scope_invalid");
  }

  const realDockerBinary = environment.DS_LAB_DOCKER_REAL_BIN ?? LAB_DOCKER_REAL_BINARY;
  if (typeof realDockerBinary !== "string" || !isAbsolute(realDockerBinary) || realDockerBinary.includes("\0") ||
      realDockerBinary === process.argv[1]) {
    throw new Error("lab_docker_binary_invalid");
  }

  const hostname = `scan-${normalizedRunId}.example.net`;
  const fixtureAlias = `public-audit-fixture-${normalizedRunId}`;
  const fixtureAddress = readPrivateFixtureAddress(environment.DS_LAB_FIXTURE_ADDRESS);
  return Object.freeze({
    runId: normalizedRunId,
    realDockerBinary,
    brokerImage: expectedBrokerImage,
    privacyEgressImage: expectedPrivacyImage,
    hostname,
    fixtureAlias,
    fixtureAddress,
    certificatePath: LAB_CERTIFICATE_PATH,
    resourceLabel: LAB_RESOURCE_LABEL,
  });
}

/** Rewrites only Docker resource-creation calls made by the real coordinator. */
export function rewriteLabDockerArguments(args, configuration) {
  if (!Array.isArray(args) || args.some((argument) => typeof argument !== "string")) {
    throw new Error("lab_docker_arguments_invalid");
  }
  const commandIndex = findDockerCommandIndex(args);
  if (commandIndex === null) return [...args];
  const dockerOptions = args.slice(0, commandIndex);
  const command = args.slice(commandIndex);
  let rewrittenCommand = command;
  if (command[0] === "run") {
    rewrittenCommand = rewriteRunArguments(command, configuration);
  } else if (command[0] === "volume" && command[1] === "create") {
    rewrittenCommand = addResourceLabel(command, 2, configuration);
  } else if (command[0] === "network" && command[1] === "create") {
    rewrittenCommand = addResourceLabel(command, 2, configuration);
  }
  return [...dockerOptions, ...rewrittenCommand];
}

function findDockerCommandIndex(args) {
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (!argument.startsWith("-")) return index;
    const equalsIndex = argument.indexOf("=");
    const option = equalsIndex >= 0 ? argument.slice(0, equalsIndex) : argument;
    if (DOCKER_GLOBAL_OPTIONS_WITH_VALUE.has(option)) {
      if (equalsIndex < 0) {
        index += 1;
        if (index >= args.length) throw new Error("lab_docker_global_option_value_missing");
      }
      continue;
    }
    if (DOCKER_GLOBAL_BOOLEAN_OPTIONS.has(option) && equalsIndex < 0) continue;
    throw new Error("lab_docker_global_option_unsupported");
  }
  return null;
}

function rewriteRunArguments(args, configuration) {
  const imageIndex = findRunImageIndex(args);
  const image = args[imageIndex];
  const imageIsBroker = image === configuration.brokerImage;
  const imageIsPrivacyProxy = image === configuration.privacyEgressImage;
  const rewritten = [...args];
  const reservedLabel = `${configuration.resourceLabel}=`;
  const existingLabel = args.slice(1, imageIndex).find((argument, index, prefix) =>
    (argument === "--label" || argument === "-l") && prefix[index + 1]?.startsWith(reservedLabel) ||
    argument.startsWith(`--label=${reservedLabel}`),
  );
  if (existingLabel) throw new Error("lab_docker_reserved_label_supplied");

  const injected = [];
  if (imageIsBroker || imageIsPrivacyProxy) {
    assertNoLabEnvironmentOverrides(args.slice(1, imageIndex));
    injected.push(...labEnvironmentArguments(configuration, imageIsBroker ? "broker" : "privacy"));
  }
  injected.push("--label", `${configuration.resourceLabel}=${configuration.runId}`);
  rewritten.splice(imageIndex, 0, ...injected);
  return rewritten;
}

function assertNoLabEnvironmentOverrides(options) {
  for (let index = 0; index < options.length; index += 1) {
    const argument = options[index];
    if (argument === "--env-file" || argument.startsWith("--env-file=")) {
      throw new Error("lab_docker_lab_image_env_file_forbidden");
    }
    if (argument === "--env" || argument === "-e") {
      const value = options[index + 1];
      if (typeof value !== "string") throw new Error("lab_docker_run_option_value_missing");
      if (value.startsWith("DS_LAB_")) throw new Error("lab_docker_lab_environment_override_forbidden");
      index += 1;
      continue;
    }
    if ((argument.startsWith("--env=") || argument.startsWith("-e")) &&
        argument.slice(argument.startsWith("--env=") ? "--env=".length : 2).startsWith("DS_LAB_")) {
      throw new Error("lab_docker_lab_environment_override_forbidden");
    }
  }
}

function findRunImageIndex(args) {
  for (let index = 1; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === "--") {
      throw new Error("lab_docker_run_image_missing");
    }
    if (!argument.startsWith("-")) return index;
    const equalsIndex = argument.indexOf("=");
    const option = equalsIndex >= 0 ? argument.slice(0, equalsIndex) : argument;
    if (RUN_OPTIONS_WITH_VALUE.has(option)) {
      if (equalsIndex < 0) {
        index += 1;
        if (index >= args.length) throw new Error("lab_docker_run_option_value_missing");
      }
    } else if (RUN_BOOLEAN_OPTIONS.has(option)) {
      continue;
    } else if (RUN_SHORT_OPTIONS_WITH_VALUE.has(option)) {
      index += 1;
      if (index >= args.length) throw new Error("lab_docker_run_option_value_missing");
    } else if (RUN_SHORT_BOOLEAN_OPTIONS.has(option)) {
      continue;
    } else if (/^-[idt]+$/u.test(option)) {
      continue;
    } else {
      throw new Error("lab_docker_run_option_unsupported");
    }
  }
  throw new Error("lab_docker_run_image_missing");
}

function addResourceLabel(args, firstOptionIndex, configuration) {
  const resourceNameIndex = findCreateResourceNameIndex(args, firstOptionIndex);
  const reservedLabelPrefix = `${configuration.resourceLabel}=`;
  const labelIndex = args.findIndex((argument, index) =>
    index >= firstOptionIndex && ((argument === "--label" || argument === "-l") && args[index + 1]?.startsWith(reservedLabelPrefix) ||
      argument.startsWith(`--label=${reservedLabelPrefix}`)),
  );
  if (labelIndex >= 0) throw new Error("lab_docker_reserved_label_supplied");
  const rewritten = [...args];
  rewritten.splice(resourceNameIndex, 0, "--label", `${configuration.resourceLabel}=${configuration.runId}`);
  return rewritten;
}

function findCreateResourceNameIndex(args, firstOptionIndex) {
  for (let index = firstOptionIndex; index < args.length; index += 1) {
    const argument = args[index];
    const equalsIndex = argument.indexOf("=");
    const option = equalsIndex >= 0 ? argument.slice(0, equalsIndex) : argument;
    if (argument === "--label" || argument === "-l" || argument === "--driver" || argument === "--opt" ||
        argument === "--scope" || argument === "--config-from" || argument === "--ipam-driver" ||
        argument === "--ipam-opt" || argument === "--subnet" || argument === "--ip-range" ||
        argument === "--gateway" || argument === "--aux-address") {
      index += 1;
      if (index >= args.length) throw new Error("lab_docker_create_option_value_missing");
      continue;
    }
    if (equalsIndex >= 0 && (option === "--label" || CREATE_OPTIONS_WITH_VALUE.has(option))) continue;
    if (CREATE_BOOLEAN_OPTIONS.has(option) && equalsIndex < 0) continue;
    if (argument.startsWith("-")) throw new Error("lab_docker_create_option_unsupported");
    return index;
  }
  throw new Error("lab_docker_create_name_missing");
}

function labEnvironmentArguments(configuration, kind) {
  const common = [
    ["DS_LAB_RUN_ID", configuration.runId],
    ["DS_LAB_HOSTNAME", configuration.hostname],
    ["DS_LAB_FIXTURE_ALIAS", configuration.fixtureAlias],
    ["DS_LAB_FIXTURE_CA_FILE", configuration.certificatePath],
    ["DS_LAB_FIXTURE_HTTPS_PORT", "8443"],
    ["DS_LAB_FIXTURE_HTTP_PORT", "8080"],
    ...(configuration.fixtureAddress ? [["DS_LAB_FIXTURE_ADDRESS", configuration.fixtureAddress]] : []),
  ];
  const broker = [
    ["DS_LAB_FIXTURE_HOST", configuration.fixtureAlias],
    ["DS_LAB_CA_FILE", configuration.certificatePath],
    ["DS_LAB_HTTPS_PORT", "8443"],
    ["DS_LAB_HTTP_PORT", "8080"],
  ];
  const privacy = [["DS_LAB_PRIVACY_PROXY_PORT", "3128"]];
  return [...common, ...(kind === "broker" ? broker : privacy)]
    .flatMap(([name, value]) => ["--env", `${name}=${value}`]);
}

function readPrivateFixtureAddress(value) {
  if (value === undefined || value === "") return undefined;
  if (typeof value !== "string" || !isIPv4(value)) throw new Error("lab_docker_fixture_address_invalid");
  const [first, second] = value.split(".").map(Number);
  if (first !== 10 && !(first === 172 && second >= 16 && second <= 31) && !(first === 192 && second === 168)) {
    throw new Error("lab_docker_fixture_address_invalid");
  }
  return value;
}

/** Executes the real Docker CLI while preserving the runner's stdin/stdout/stderr contract. */
export function runLabDockerCli(args, environment = process.env, spawnChild = spawn) {
  const configuration = resolveLabDockerShimConfiguration(environment);
  const rewrittenArguments = rewriteLabDockerArguments(args, configuration);
  const child = spawnChild(configuration.realDockerBinary, rewrittenArguments, { stdio: "inherit" });
  let finished = false;
  const forwardSignals = new Map();
  for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"]) {
    const handler = () => child.kill(signal);
    forwardSignals.set(signal, handler);
    process.once(signal, handler);
  }
  child.once("error", () => {
    finished = true;
    removeForwardedSignals(forwardSignals);
    process.stderr.write("lab_docker_command_failed\n");
    process.exitCode = 127;
  });
  child.once("exit", (code) => {
    if (finished) return;
    finished = true;
    removeForwardedSignals(forwardSignals);
    process.exitCode = code ?? 1;
  });
}

function removeForwardedSignals(signalHandlers) {
  for (const [signal, handler] of signalHandlers) process.removeListener(signal, handler);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    runLabDockerCli(process.argv.slice(2));
  } catch (error) {
    const code = error instanceof Error && /^lab_docker_[a-z_]+$/u.test(error.message)
      ? error.message
      : "lab_docker_command_failed";
    process.stderr.write(`${code}\n`);
    process.exitCode = 64;
  }
}
