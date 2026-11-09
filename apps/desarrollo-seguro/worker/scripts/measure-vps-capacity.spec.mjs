import { describe, expect, it, vi } from "vitest";
import {
  parseArguments,
  parseDockerStats,
  parseLinuxLoadAverage,
  parseLinuxMemory,
  probeHealth,
  summarizeHealth,
  summarizeSamples,
  validateHealthUrl,
} from "./measure-vps-capacity.mjs";

const VALID_HEALTH_URL = "https://example.com/api/health";
const DOCKER_STATS_ROW = {
  Name: "api-1",
  CPUPerc: "2.50%",
  MemPerc: "10.25%",
  PIDs: "12",
};

describe("VPS capacity measurement helpers", () => {
  it("uses conservative defaults and an explicit baseline label", () => {
    expect(parseArguments([])).toEqual({
      durationSeconds: 300,
      intervalSeconds: 10,
      label: "baseline",
      healthUrl: null,
      outputPath: null,
      help: false,
    });
  });

  it("accepts a controlled-scan label and the configured health endpoint", () => {
    expect(
      parseArguments([
        "--duration-seconds=120",
        "--interval-seconds=5",
        "--label=controlled-scan",
        `--health-url=${VALID_HEALTH_URL}`,
        "--output=/tmp/capacity.json",
      ]),
    ).toEqual({
      durationSeconds: 120,
      intervalSeconds: 5,
      label: "controlled-scan",
      healthUrl: VALID_HEALTH_URL,
      outputPath: "/tmp/capacity.json",
      help: false,
    });
  });

  it("accepts the maximum bounded sample count", () => {
    expect(
      parseArguments(["--duration-seconds=600", "--interval-seconds=5"]),
    ).toEqual(
      expect.objectContaining({
        durationSeconds: 600,
        intervalSeconds: 5,
      }),
    );
  });

  it.each([
    ["too short", ["--duration-seconds=30"]],
    ["interval below the minimum", ["--interval-seconds=1"]],
    [
      "interval longer than duration",
      ["--duration-seconds=60", "--interval-seconds=61"],
    ],
    ["too many samples", ["--duration-seconds=3600", "--interval-seconds=5"]],
    ["unknown label", ["--label=production-scan"]],
    ["unknown option", ["--shell=echo-pwned"]],
    ["duplicate option", ["--label=baseline", "--label=controlled-scan"]],
  ])("rejects %s", (_caseName, args) => {
    expect(() => parseArguments(args)).toThrow("capacity_arguments_invalid");
  });

  it.each([
    "http://example.com/api/health",
    "https://example.test/api/health",
    "https://example.com/api/health?secret=1",
    "https://user@example.com/api/health",
    "https://example.com:8443/api/health",
    "https://example.com/other",
  ])("rejects unsafe health URL %s", (healthUrl) => {
    expect(() => validateHealthUrl(healthUrl)).toThrow(
      "capacity_health_url_invalid",
    );
  });

  it("probes only the fixed health URL and never follows redirects", async () => {
    const body = { cancel: vi.fn().mockResolvedValue(undefined) };
    const fetchImplementation = vi.fn().mockResolvedValue({
      status: 302,
      body,
    });

    const result = await probeHealth(VALID_HEALTH_URL, fetchImplementation);

    expect(fetchImplementation).toHaveBeenCalledWith(
      VALID_HEALTH_URL,
      expect.objectContaining({ method: "GET", redirect: "manual" }),
    );
    expect(body.cancel).toHaveBeenCalledOnce();
    expect(result).toEqual(
      expect.objectContaining({
        ok: false,
        statusCode: 302,
        failureCode: "http_non_200",
      }),
    );
  });

  it("rejects an unsafe health URL before invoking the fetch implementation", async () => {
    const fetchImplementation = vi.fn();

    await expect(
      probeHealth("https://127.0.0.1/api/health", fetchImplementation),
    ).rejects.toThrow("capacity_health_url_invalid");
    expect(fetchImplementation).not.toHaveBeenCalled();
  });

  it("summarizes health successes, errors and nearest-rank success latency p95", () => {
    expect(
      summarizeHealth([
        { health: { ok: true, statusCode: 200, latencyMs: 10 } },
        { health: { ok: false, statusCode: 503, latencyMs: 2_000 } },
        { health: null },
        { health: { ok: true, statusCode: 200, latencyMs: 20 } },
        { health: { ok: true, statusCode: 200, latencyMs: 30 } },
      ]),
    ).toEqual({
      requestCount: 4,
      successCount: 3,
      errorCount: 1,
      latencyP95Ms: 30,
    });
  });

  it("returns null latency p95 when all configured health probes fail", () => {
    expect(
      summarizeHealth([
        { health: { ok: false, statusCode: 503, latencyMs: 2_000 } },
        { health: { ok: false, statusCode: null, latencyMs: 1_000 } },
      ]),
    ).toEqual({
      requestCount: 2,
      successCount: 0,
      errorCount: 2,
      latencyP95Ms: null,
    });
  });

  it("returns null when health probing is disabled for every sample", () => {
    expect(summarizeHealth([{ health: null }, { health: null }])).toBeNull();
  });

  it("parses available, total memory and swap from procfs", () => {
    expect(
      parseLinuxMemory(
        "MemTotal:       8192000 kB\nMemAvailable:   2048000 kB\nSwapTotal:      1024000 kB\nSwapFree:        512000 kB\n",
      ),
    ).toEqual({
      totalBytes: 8_388_608_000,
      availableBytes: 2_097_152_000,
      swapTotalBytes: 1_048_576_000,
      swapAvailableBytes: 524_288_000,
    });
  });

  it("rejects incomplete procfs memory data", () => {
    expect(() => parseLinuxMemory("MemTotal: 10 kB\n")).toThrow(
      "capacity_memory_data_invalid",
    );
  });

  it("rejects swap-free memory greater than total swap", () => {
    expect(() =>
      parseLinuxMemory(
        "MemTotal: 100 kB\nMemAvailable: 50 kB\nSwapTotal: 10 kB\nSwapFree: 11 kB\n",
      ),
    ).toThrow("capacity_memory_data_invalid");
  });

  it.each([
    [
      "byte conversion overflow",
      "MemTotal: 9007199254740991 kB\nMemAvailable: 1 kB\nSwapTotal: 0 kB\nSwapFree: 0 kB\n",
    ],
    [
      "duplicate total entry",
      "MemTotal: 100 kB\nMemTotal: 200 kB\nMemAvailable: 50 kB\nSwapTotal: 0 kB\nSwapFree: 0 kB\n",
    ],
  ])("rejects procfs memory with %s", (_caseName, contents) => {
    expect(() => parseLinuxMemory(contents)).toThrow(
      "capacity_memory_data_invalid",
    );
  });

  it("rejects invalid load-average data", () => {
    expect(() => parseLinuxLoadAverage("1.2 NaN 0.8 1/10 42")).toThrow(
      "capacity_load_data_invalid",
    );
  });

  it("parses Docker stats while discarding unrelated fields", () => {
    expect(parseDockerStats(JSON.stringify(DOCKER_STATS_ROW))).toEqual([
      {
        name: "api-1",
        cpuPercent: 2.5,
        memoryPercent: 10.25,
        processCount: 12,
      },
    ]);
  });

  it("rejects malformed or non-finite Docker stats", () => {
    expect(() => parseDockerStats("not-json")).toThrow(
      "capacity_docker_stats_invalid",
    );
    expect(() =>
      parseDockerStats(
        JSON.stringify({ ...DOCKER_STATS_ROW, CPUPerc: "NaN%" }),
      ),
    ).toThrow("capacity_docker_stats_invalid");
  });

  it("rejects impossible Docker memory percentages but permits multi-core CPU percentages", () => {
    const statsWithHighCpu = {
      ...DOCKER_STATS_ROW,
      CPUPerc: "250.00%",
    };
    expect(
      parseDockerStats(JSON.stringify(statsWithHighCpu))[0]?.cpuPercent,
    ).toBe(250);

    expect(() =>
      parseDockerStats(
        JSON.stringify({ ...DOCKER_STATS_ROW, MemPerc: "100.01%" }),
      ),
    ).toThrow("capacity_docker_stats_invalid");
  });

  it("summarizes host and container samples with nearest-rank p95", () => {
    const summary = summarizeSamples([
      {
        loadAverage1m: 1,
        memoryTotalBytes: 500,
        memoryAvailableBytes: 400,
        swapTotalBytes: 300,
        swapAvailableBytes: 250,
        diskTotalBytes: 4_000,
        diskAvailableBytes: 2_000,
        containers: [
          {
            name: "api-1",
            cpuPercent: 1,
            memoryPercent: 10,
            processCount: 10,
          },
        ],
      },
      {
        loadAverage1m: 4,
        memoryTotalBytes: 500,
        memoryAvailableBytes: 300,
        swapTotalBytes: 300,
        swapAvailableBytes: 100,
        diskTotalBytes: 4_000,
        diskAvailableBytes: 1_900,
        containers: [
          {
            name: "api-1",
            cpuPercent: 3,
            memoryPercent: 12,
            processCount: 11,
          },
        ],
      },
      {
        loadAverage1m: 2,
        memoryTotalBytes: 500,
        memoryAvailableBytes: 350,
        swapTotalBytes: 300,
        swapAvailableBytes: 150,
        diskTotalBytes: 4_000,
        diskAvailableBytes: 1_800,
        containers: [],
      },
    ]);

    expect(summary).toEqual({
      sampleCount: 3,
      loadAverage1mP95: 4,
      memoryAvailableMinimumBytes: 300,
      swapUsedMaximumBytes: 200,
      diskAvailableMinimumBytes: 1_800,
      containers: [
        {
          name: "api-1",
          cpuPercentP95: 3,
          memoryPercentP95: 12,
          processCountMaximum: 11,
        },
      ],
    });
  });

  it("rejects an empty sample set", () => {
    expect(() => summarizeSamples([])).toThrow("capacity_samples_required");
  });

  it("rejects malformed samples instead of producing incomplete summaries", () => {
    expect(() =>
      summarizeSamples([
        {
          loadAverage1m: Number.NaN,
          memoryTotalBytes: 10,
          memoryAvailableBytes: -1,
          swapTotalBytes: 0,
          swapAvailableBytes: 0,
          diskTotalBytes: 1_000,
          diskAvailableBytes: 500,
          containers: [],
        },
      ]),
    ).toThrow("capacity_samples_invalid");
  });
});
