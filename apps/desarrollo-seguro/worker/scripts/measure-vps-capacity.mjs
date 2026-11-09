import { execFile as execFileCallback } from "node:child_process";
import { promisify } from "node:util";
import { readFile, statfs, writeFile } from "node:fs/promises";
import os from "node:os";
import { pathToFileURL, URL } from "node:url";
import process from "node:process";
import { setTimeout as delay } from "node:timers/promises";
import { performance } from "node:perf_hooks";

const execFile = promisify(execFileCallback);
const DEFAULT_DURATION_SECONDS = 300;
const DEFAULT_INTERVAL_SECONDS = 10;
const MIN_DURATION_SECONDS = 60;
const MAX_DURATION_SECONDS = 3600;
const MIN_INTERVAL_SECONDS = 5;
const MAX_INTERVAL_SECONDS = 60;
const MAX_SAMPLE_COUNT = 121;
const MAX_DOCKER_STATS_BYTES = 32_768;
const MAX_DOCKER_CONTAINER_COUNT = 64;
const HEALTH_TIMEOUT_MS = 5_000;
const EXAMPLE_HEALTH_URL = "https://example.com/api/health";
const ARGUMENT_PREFIX = "--";
const ALLOWED_LABELS = new Set(["baseline", "controlled-scan"]);
const ERROR_CODES = {
  ARGUMENTS_INVALID: "capacity_arguments_invalid",
  HEALTH_URL_INVALID: "capacity_health_url_invalid",
  MEMORY_DATA_INVALID: "capacity_memory_data_invalid",
  LOAD_DATA_INVALID: "capacity_load_data_invalid",
  DOCKER_STATS_INVALID: "capacity_docker_stats_invalid",
  SAMPLES_REQUIRED: "capacity_samples_required",
  SAMPLES_INVALID: "capacity_samples_invalid",
  DOCKER_STATS_UNAVAILABLE: "capacity_docker_stats_unavailable",
  LINUX_HOST_REQUIRED: "capacity_linux_host_required",
  DISK_DATA_INVALID: "capacity_disk_data_invalid",
};

const HELP_TEXT = `Medición de capacidad Desarrollo Seguro (solo lectura)

Uso:
  node measure-vps-capacity.mjs [opciones]

Opciones:
  --label=baseline|controlled-scan   Etiqueta de la ventana medida (por defecto: baseline)
  --duration-seconds=N               Duración entre 60 y 3600 (por defecto: 300)
  --interval-seconds=N               Intervalo entre 5 y 60 (por defecto: 10)
  --health-url=${EXAMPLE_HEALTH_URL}  GET opcional al endpoint de salud configurado
  --output=RUTA                       Crear un JSON nuevo con permisos de propietario
  --help                              Mostrar esta ayuda

No inicia contenedores, no cambia configuración y no solicita scans. Ejecutar solo en el VPS
cuando se autorice medirlo. Repetir con --label=controlled-scan únicamente durante una
prueba controlada que ya haya superado los gates de seguridad.
`;

export function parseArguments(args) {
  const values = new Map();
  for (const arg of args) {
    if (arg === "--help") {
      if (values.has("help")) throw new Error(ERROR_CODES.ARGUMENTS_INVALID);
      values.set("help", true);
      continue;
    }
    if (!arg.startsWith(ARGUMENT_PREFIX)) {
      throw new Error(ERROR_CODES.ARGUMENTS_INVALID);
    }
    const separatorIndex = arg.indexOf("=");
    if (separatorIndex < 3) throw new Error(ERROR_CODES.ARGUMENTS_INVALID);
    const name = arg.slice(2, separatorIndex);
    const value = arg.slice(separatorIndex + 1);
    if (values.has(name) || value.length === 0) {
      throw new Error(ERROR_CODES.ARGUMENTS_INVALID);
    }
    values.set(name, value);
  }

  const allowedNames = new Set([
    "duration-seconds",
    "interval-seconds",
    "label",
    "health-url",
    "output",
  ]);
  if (
    [...values.keys()].some(
      (name) => name !== "help" && !allowedNames.has(name),
    )
  ) {
    throw new Error(ERROR_CODES.ARGUMENTS_INVALID);
  }
  if (values.has("help") && values.size > 1) {
    throw new Error(ERROR_CODES.ARGUMENTS_INVALID);
  }

  const durationSeconds = parseIntegerOption(
    values.get("duration-seconds"),
    DEFAULT_DURATION_SECONDS,
    MIN_DURATION_SECONDS,
    MAX_DURATION_SECONDS,
  );
  const intervalSeconds = parseIntegerOption(
    values.get("interval-seconds"),
    DEFAULT_INTERVAL_SECONDS,
    MIN_INTERVAL_SECONDS,
    MAX_INTERVAL_SECONDS,
  );
  const label = values.get("label") ?? "baseline";
  if (
    !ALLOWED_LABELS.has(label) ||
    intervalSeconds > durationSeconds ||
    Math.floor(durationSeconds / intervalSeconds) + 1 > MAX_SAMPLE_COUNT
  ) {
    throw new Error(ERROR_CODES.ARGUMENTS_INVALID);
  }

  const rawHealthUrl = values.get("health-url");
  const healthUrl = rawHealthUrl ? validateHealthUrl(rawHealthUrl) : null;
  const outputPath = values.get("output") ?? null;
  if (outputPath !== null && !outputPath.startsWith("/")) {
    throw new Error(ERROR_CODES.ARGUMENTS_INVALID);
  }

  return {
    durationSeconds,
    intervalSeconds,
    label,
    healthUrl,
    outputPath,
    help: values.has("help"),
  };
}

function parseIntegerOption(rawValue, fallback, minimum, maximum) {
  if (rawValue === undefined) return fallback;
  if (!/^\d+$/u.test(rawValue)) throw new Error(ERROR_CODES.ARGUMENTS_INVALID);
  const parsed = Number(rawValue);
  if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new Error(ERROR_CODES.ARGUMENTS_INVALID);
  }
  return parsed;
}

export function validateHealthUrl(rawUrl) {
  if (typeof rawUrl !== "string")
    throw new Error(ERROR_CODES.HEALTH_URL_INVALID);
  let parsedUrl;
  try {
    parsedUrl = new URL(rawUrl);
  } catch {
    throw new Error(ERROR_CODES.HEALTH_URL_INVALID);
  }
  if (
    parsedUrl.href !== EXAMPLE_HEALTH_URL ||
    parsedUrl.protocol !== "https:" ||
    parsedUrl.username !== "" ||
    parsedUrl.password !== "" ||
    parsedUrl.search !== "" ||
    parsedUrl.hash !== ""
  ) {
    throw new Error(ERROR_CODES.HEALTH_URL_INVALID);
  }
  return parsedUrl.href;
}

export function parseLinuxMemory(contents) {
  if (typeof contents !== "string") {
    throw new Error(ERROR_CODES.MEMORY_DATA_INVALID);
  }
  const memoryValues = new Map();
  for (const line of contents.split("\n")) {
    const match =
      /^(MemTotal|MemAvailable|SwapTotal|SwapFree):\s+(\d+)\s+kB$/u.exec(
        line.trim(),
      );
    if (match?.[1] && match[2]) {
      if (memoryValues.has(match[1])) {
        throw new Error(ERROR_CODES.MEMORY_DATA_INVALID);
      }
      memoryValues.set(match[1], Number(match[2]));
    }
  }
  const totalKibibytes = memoryValues.get("MemTotal");
  const availableKibibytes = memoryValues.get("MemAvailable");
  const swapTotalKibibytes = memoryValues.get("SwapTotal");
  const swapFreeKibibytes = memoryValues.get("SwapFree");
  if (
    !Number.isSafeInteger(totalKibibytes) ||
    !Number.isSafeInteger(availableKibibytes) ||
    !Number.isSafeInteger(swapTotalKibibytes) ||
    !Number.isSafeInteger(swapFreeKibibytes) ||
    totalKibibytes <= 0 ||
    availableKibibytes < 0 ||
    availableKibibytes > totalKibibytes ||
    swapTotalKibibytes < 0 ||
    swapFreeKibibytes < 0 ||
    swapFreeKibibytes > swapTotalKibibytes
  ) {
    throw new Error(ERROR_CODES.MEMORY_DATA_INVALID);
  }
  const totalBytes = totalKibibytes * 1024;
  const availableBytes = availableKibibytes * 1024;
  const swapTotalBytes = swapTotalKibibytes * 1024;
  const swapAvailableBytes = swapFreeKibibytes * 1024;
  if (
    ![totalBytes, availableBytes, swapTotalBytes, swapAvailableBytes].every(
      Number.isSafeInteger,
    )
  ) {
    throw new Error(ERROR_CODES.MEMORY_DATA_INVALID);
  }
  return {
    totalBytes,
    availableBytes,
    swapTotalBytes,
    swapAvailableBytes,
  };
}

export function parseLinuxLoadAverage(contents) {
  if (typeof contents !== "string") {
    throw new Error(ERROR_CODES.LOAD_DATA_INVALID);
  }
  const values = contents.trim().split(/\s+/u).slice(0, 3).map(Number);
  if (
    values.length !== 3 ||
    values.some((value) => !Number.isFinite(value) || value < 0)
  ) {
    throw new Error(ERROR_CODES.LOAD_DATA_INVALID);
  }
  return values;
}

export function parseDockerStats(contents) {
  if (typeof contents !== "string") {
    throw new Error(ERROR_CODES.DOCKER_STATS_INVALID);
  }
  if (contents.trim() === "") return [];

  try {
    const rows = contents
      .trim()
      .split("\n")
      .map((line) => parseDockerStatsRow(JSON.parse(line)));
    if (rows.length > MAX_DOCKER_CONTAINER_COUNT) {
      throw new Error(ERROR_CODES.DOCKER_STATS_INVALID);
    }
    return rows;
  } catch {
    throw new Error(ERROR_CODES.DOCKER_STATS_INVALID);
  }
}

function parseDockerStatsRow(row) {
  if (!isPlainRecord(row)) throw new Error(ERROR_CODES.DOCKER_STATS_INVALID);
  const name = row.Name;
  const cpuPercent = parsePercent(row.CPUPerc);
  const memoryPercent = parsePercent(row.MemPerc);
  const processCount = Number(row.PIDs);
  if (
    typeof name !== "string" ||
    name.length === 0 ||
    name.length > 128 ||
    memoryPercent > 100 ||
    !Number.isSafeInteger(processCount) ||
    processCount < 0
  ) {
    throw new Error(ERROR_CODES.DOCKER_STATS_INVALID);
  }
  return { name, cpuPercent, memoryPercent, processCount };
}

function parsePercent(value) {
  if (typeof value !== "string" || !/^\d+(?:\.\d+)?%$/u.test(value)) {
    throw new Error(ERROR_CODES.DOCKER_STATS_INVALID);
  }
  const parsed = Number(value.slice(0, -1));
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new Error(ERROR_CODES.DOCKER_STATS_INVALID);
  }
  return parsed;
}

export function summarizeSamples(samples) {
  if (!Array.isArray(samples) || samples.length === 0) {
    throw new Error(ERROR_CODES.SAMPLES_REQUIRED);
  }
  const containersByName = new Map();
  for (const sample of samples) {
    if (!isValidSample(sample)) {
      throw new Error(ERROR_CODES.SAMPLES_INVALID);
    }
    for (const container of sample.containers) {
      const prior = containersByName.get(container.name) ?? {
        cpuPercent: [],
        memoryPercent: [],
        processCount: [],
      };
      prior.cpuPercent.push(container.cpuPercent);
      prior.memoryPercent.push(container.memoryPercent);
      prior.processCount.push(container.processCount);
      containersByName.set(container.name, prior);
    }
  }

  return {
    sampleCount: samples.length,
    loadAverage1mP95: percentile95(
      samples.map((sample) => sample.loadAverage1m),
    ),
    memoryAvailableMinimumBytes: Math.min(
      ...samples.map((sample) => sample.memoryAvailableBytes),
    ),
    swapUsedMaximumBytes: Math.max(
      ...samples.map(
        (sample) => sample.swapTotalBytes - sample.swapAvailableBytes,
      ),
    ),
    diskAvailableMinimumBytes: Math.min(
      ...samples.map((sample) => sample.diskAvailableBytes),
    ),
    containers: [...containersByName.entries()]
      .sort(([firstName], [secondName]) => firstName.localeCompare(secondName))
      .map(([name, values]) => ({
        name,
        cpuPercentP95: percentile95(values.cpuPercent),
        memoryPercentP95: percentile95(values.memoryPercent),
        processCountMaximum: Math.max(...values.processCount),
      })),
  };
}

function percentile95(values) {
  if (values.length === 0 || values.some((value) => !Number.isFinite(value))) {
    throw new Error(ERROR_CODES.SAMPLES_INVALID);
  }
  const sorted = [...values].sort((first, second) => first - second);
  const nearestRankIndex = Math.ceil(0.95 * sorted.length) - 1;
  return sorted[nearestRankIndex];
}

function isValidSample(sample) {
  return (
    isPlainRecord(sample) &&
    Number.isFinite(sample.loadAverage1m) &&
    sample.loadAverage1m >= 0 &&
    Number.isSafeInteger(sample.memoryTotalBytes) &&
    sample.memoryTotalBytes > 0 &&
    Number.isSafeInteger(sample.memoryAvailableBytes) &&
    sample.memoryAvailableBytes >= 0 &&
    sample.memoryAvailableBytes <= sample.memoryTotalBytes &&
    Number.isSafeInteger(sample.swapTotalBytes) &&
    sample.swapTotalBytes >= 0 &&
    Number.isSafeInteger(sample.swapAvailableBytes) &&
    sample.swapAvailableBytes >= 0 &&
    sample.swapAvailableBytes <= sample.swapTotalBytes &&
    Number.isSafeInteger(sample.diskTotalBytes) &&
    sample.diskTotalBytes > 0 &&
    Number.isSafeInteger(sample.diskAvailableBytes) &&
    sample.diskAvailableBytes >= 0 &&
    sample.diskAvailableBytes <= sample.diskTotalBytes &&
    Array.isArray(sample.containers) &&
    sample.containers.every(
      (container) =>
        isPlainRecord(container) &&
        typeof container.name === "string" &&
        Number.isFinite(container.cpuPercent) &&
        container.cpuPercent >= 0 &&
        Number.isFinite(container.memoryPercent) &&
        container.memoryPercent >= 0 &&
        container.memoryPercent <= 100 &&
        Number.isSafeInteger(container.processCount) &&
        container.processCount >= 0,
    )
  );
}

function isPlainRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function readDockerStats() {
  try {
    const { stdout } = await execFile(
      "docker",
      ["stats", "--no-stream", "--format", "{{json .}}"],
      { timeout: 5_000, maxBuffer: MAX_DOCKER_STATS_BYTES },
    );
    return parseDockerStats(stdout);
  } catch {
    throw new Error(ERROR_CODES.DOCKER_STATS_UNAVAILABLE);
  }
}

export async function probeHealth(
  healthUrl,
  fetchImplementation = globalThis.fetch,
) {
  if (healthUrl === null) return null;
  const safeHealthUrl = validateHealthUrl(healthUrl);
  if (typeof fetchImplementation !== "function") {
    throw new Error("capacity_health_probe_unavailable");
  }
  const startedAt = performance.now();
  try {
    const response = await fetchImplementation(safeHealthUrl, {
      method: "GET",
      signal: globalThis.AbortSignal.timeout(HEALTH_TIMEOUT_MS),
      redirect: "manual",
    });
    const result = {
      ok: response.status === 200,
      statusCode: response.status,
      latencyMs: performance.now() - startedAt,
      failureCode: response.status === 200 ? null : "http_non_200",
    };
    await response.body?.cancel();
    return result;
  } catch (error) {
    return {
      ok: false,
      statusCode: null,
      latencyMs: performance.now() - startedAt,
      failureCode: error?.name === "TimeoutError" ? "timeout" : "network_error",
    };
  }
}

async function collectSample(healthUrl) {
  if (process.platform !== "linux") {
    throw new Error(ERROR_CODES.LINUX_HOST_REQUIRED);
  }
  const [memoryContents, loadContents, filesystem, containers, health] =
    await Promise.all([
      readFile("/proc/meminfo", "utf8"),
      readFile("/proc/loadavg", "utf8"),
      statfs("/"),
      readDockerStats(),
      probeHealth(healthUrl),
    ]);
  const memory = parseLinuxMemory(memoryContents);
  const filesystemBlockSize = Number(filesystem.bsize);
  const diskTotalBytes = filesystemBlockSize * Number(filesystem.blocks);
  const diskAvailableBytes = filesystemBlockSize * Number(filesystem.bavail);
  if (
    !Number.isSafeInteger(diskTotalBytes) ||
    !Number.isSafeInteger(diskAvailableBytes) ||
    filesystemBlockSize <= 0 ||
    diskAvailableBytes < 0 ||
    diskAvailableBytes > diskTotalBytes
  ) {
    throw new Error(ERROR_CODES.DISK_DATA_INVALID);
  }

  const [loadAverage1m, loadAverage5m, loadAverage15m] =
    parseLinuxLoadAverage(loadContents);
  return {
    observedAt: new Date().toISOString(),
    loadAverage1m,
    loadAverage5m,
    loadAverage15m,
    memoryTotalBytes: memory.totalBytes,
    memoryAvailableBytes: memory.availableBytes,
    swapTotalBytes: memory.swapTotalBytes,
    swapAvailableBytes: memory.swapAvailableBytes,
    diskTotalBytes,
    diskAvailableBytes,
    containers,
    health,
  };
}

export function summarizeHealth(samples) {
  const healthSamples = samples
    .map((sample) => sample.health)
    .filter((health) => health !== null);
  if (healthSamples.length === 0) return null;
  const successfulSamples = healthSamples.filter((health) => health.ok);
  return {
    requestCount: healthSamples.length,
    successCount: successfulSamples.length,
    errorCount: healthSamples.length - successfulSamples.length,
    latencyP95Ms:
      successfulSamples.length > 0
        ? percentile95(successfulSamples.map((health) => health.latencyMs))
        : null,
  };
}

async function runMeasurement(options) {
  const startedAt = new Date();
  const startedAtMs = performance.now();
  const durationMs = options.durationSeconds * 1000;
  const intervalMs = options.intervalSeconds * 1000;
  const samples = [];
  for (let sampleIndex = 0; ; sampleIndex += 1) {
    samples.push(await collectSample(options.healthUrl));
    const nextSampleAtMs = startedAtMs + (sampleIndex + 1) * intervalMs;
    if (nextSampleAtMs > startedAtMs + durationMs) break;
    const delayMs = Math.max(0, nextSampleAtMs - performance.now());
    if (delayMs > 0) await delay(delayMs);
  }
  const completedAt = new Date();
  return {
    schemaVersion: "ds-vps-capacity-v1",
    label: options.label,
    startedAt: startedAt.toISOString(),
    completedAt: completedAt.toISOString(),
    host: {
      platform: process.platform,
      architecture: process.arch,
      cpuCount: os.cpus().length,
      memoryTotalBytes: os.totalmem(),
      swapTotalBytes: samples[0]?.swapTotalBytes ?? 0,
    },
    configuration: {
      durationSeconds: options.durationSeconds,
      intervalSeconds: options.intervalSeconds,
      healthProbeEnabled: options.healthUrl !== null,
    },
    summary: {
      ...summarizeSamples(samples),
      health: summarizeHealth(samples),
    },
    samples,
  };
}

async function main(args) {
  let options;
  try {
    options = parseArguments(args);
  } catch (error) {
    process.stderr.write(`${error.message}\nUse --help for valid options.\n`);
    process.exitCode = 2;
    return;
  }
  if (options.help) {
    process.stdout.write(HELP_TEXT);
    return;
  }

  try {
    const result = await runMeasurement(options);
    const serializedResult = `${JSON.stringify(result, null, 2)}\n`;
    if (options.outputPath === null) {
      process.stdout.write(serializedResult);
    } else {
      await writeFile(options.outputPath, serializedResult, {
        encoding: "utf8",
        flag: "wx",
        mode: 0o600,
      });
      process.stdout.write(`Measurement saved to ${options.outputPath}\n`);
    }
  } catch (error) {
    process.stderr.write(`${error.message ?? "capacity_measurement_failed"}\n`);
    process.exitCode = 1;
  }
}

const isDirectExecution =
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(process.argv[1]).href;
if (isDirectExecution) await main(process.argv.slice(2));
