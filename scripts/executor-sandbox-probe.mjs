import { lstat, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { networkInterfaces, tmpdir } from "node:os";
import { join } from "node:path";

const failures = [];
const status = await readFile("/proc/self/status", "utf8");
const mountInfo = await readFile("/proc/self/mountinfo", "utf8");
const ipv4Routes = await readFile("/proc/net/route", "utf8");
const ipv6Routes = await readFile("/proc/net/ipv6_route", "utf8");
const cgroupControllers = await readFile("/sys/fs/cgroup/cgroup.controllers", "utf8");
const processLimit = (await readFile("/sys/fs/cgroup/pids.max", "utf8")).trim();
const memoryLimit = (await readFile("/sys/fs/cgroup/memory.max", "utf8")).trim();
const cpuLimit = (await readFile("/sys/fs/cgroup/cpu.max", "utf8")).trim();
const noNewPrivileges = /^NoNewPrivs:\s*(\d+)$/mu.exec(status)?.[1];
const rootMount = mountInfo
  .split("\n")
  .map((line) => line.split(" - ", 1)[0]?.split(" "))
  .find((fields) => fields?.[4] === "/");
const temporaryMount = mountInfo
  .split("\n")
  .map((line) => line.split(" - "))
  .find(([mount]) => mount?.split(" ")[4] === "/tmp");
const interfaces = Object.keys(networkInterfaces());

if (typeof process.getuid !== "function" || process.getuid() === 0) {
  failures.push("process_not_unprivileged");
}
if (hasCapabilities(status)) failures.push("capabilities_not_dropped");
if (noNewPrivileges !== "1") failures.push("no_new_privileges_missing");
if (!rootMount?.[5]?.split(",").includes("ro")) failures.push("root_mount_not_read_only");
if (!isRestrictedTmpfs(temporaryMount)) failures.push("temporary_mount_not_restricted");
if (cgroupControllers.trim() === "") failures.push("cgroup_v2_unavailable");
if (!isWithinLimit(processLimit, 64)) failures.push("process_limit_not_applied");
if (!isWithinLimit(memoryLimit, 256 * 1024 * 1024)) failures.push("memory_limit_not_applied");
if (!isWithinCpuLimit(cpuLimit, 0.5)) failures.push("cpu_limit_not_applied");
if (interfaces.some((name) => name !== "lo")) failures.push("network_interface_present");
if (hasDefaultIpv4Route(ipv4Routes) || hasDefaultIpv6Route(ipv6Routes)) {
  failures.push("default_network_route_present");
}
if (Object.keys(process.env).some((name) => /SECRET|TOKEN|PASSWORD|DATABASE|CREDENTIAL|AWS|^DS_/iu.test(name))) {
  failures.push("sensitive_environment_variable_present");
}

try {
  await lstat("/var/run/docker.sock");
  failures.push("docker_socket_present");
} catch (error) {
  if (error?.code !== "ENOENT") failures.push("docker_socket_unavailable");
}

try {
  await writeFile("/etc/development-security-sandbox-probe", "unexpected");
  failures.push("root_filesystem_writable");
} catch {
  // The image root must remain read-only.
}

const temporaryDirectory = await mkdtemp(join(tmpdir(), "ds-sandbox-probe-"));
await rm(temporaryDirectory, { recursive: true, force: true });

if (failures.length > 0) {
  process.stderr.write(`${failures.join("\n")}\n`);
  process.exitCode = 1;
} else {
  process.stdout.write(
    "Executor sandbox checks passed: non-root, no capabilities, no new privileges, loopback only with no default route, no Docker socket, read-only root, restricted tmpfs, cgroup v2 CPU/memory/process limits.\n",
  );
}

function isWithinLimit(rawValue, maximum) {
  const value = Number(rawValue);
  return Number.isSafeInteger(value) && value > 0 && value <= maximum;
}

function isWithinCpuLimit(rawValue, maximumCpus) {
  const [rawQuota, rawPeriod] = rawValue.split(" ");
  const quota = Number(rawQuota);
  const period = Number(rawPeriod);
  return (
    Number.isSafeInteger(quota) &&
    quota > 0 &&
    Number.isSafeInteger(period) &&
    period > 0 &&
    quota / period <= maximumCpus
  );
}

function hasCapabilities(contents) {
  const capabilityFields = ["CapInh", "CapPrm", "CapEff", "CapBnd", "CapAmb"];
  return capabilityFields.some((field) => {
    const value = new RegExp(`^${field}:\\s*([0-9a-f]+)$`, "mu").exec(contents)?.[1];
    return value === undefined || BigInt(`0x${value}`) !== 0n;
  });
}

function isRestrictedTmpfs(mount) {
  const [mountFields, filesystem] = mount ?? [];
  if (!mountFields || !filesystem) return false;
  const mountOptions = mountFields.split(" ")[5]?.split(",") ?? [];
  const [filesystemType] = filesystem.split(" ");
  return (
    filesystemType === "tmpfs" &&
    mountOptions.includes("rw") &&
    mountOptions.includes("noexec") &&
    mountOptions.includes("nosuid")
  );
}

function hasDefaultIpv4Route(contents) {
  return contents
    .trim()
    .split("\n")
    .slice(1)
    .some((line) => line.trim().split(/\s+/u)[1] === "00000000");
}

function hasDefaultIpv6Route(contents) {
  return contents
    .trim()
    .split("\n")
    .some((line) => {
      const fields = line.trim().split(/\s+/u);
      const destination = fields[0];
      const prefix = fields[1];
      const flags = Number.parseInt(fields[8] ?? "", 16);
      const interfaceName = fields[9];
      const defaultRoute = destination === "0".repeat(32) && prefix === "00";
      const kernelRejectRoute =
        Number.isSafeInteger(flags) &&
        (flags & 0x0200) !== 0 &&
        interfaceName === "lo";
      return defaultRoute && !kernelRejectRoute;
    });
}

