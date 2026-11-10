import { randomUUID } from "node:crypto";
import {
  evaluateVerdict,
  sanitizeScanObservations,
} from "@desarrolloseguro/core";
import type { ClaimedScanJob, ScanCheck, ScanRunInput } from "@desarrolloseguro/persistence";
import { createTransportV1EgressBroker } from "./transport-v1-egress-broker.js";

const PROFILE_VERSION = "transport-v1";
const FIXTURE_SCANNER_VERSION = "transport-v1-fixture-adapter-1";
const NETWORK_SCANNER_VERSION = "transport-v1-network-adapter-1";
const MAX_CONCURRENT_NETWORK_PROBES = 2;
const CHECKS = [
  { controlId: "DS-DNS-01", method: "DNS", severity: "high" },
  { controlId: "DS-TLS-01", method: "TLS", severity: "high" },
  { controlId: "DS-HTTP-01", method: "HEAD", severity: "medium" },
  { controlId: "DS-HTTP-01", method: "GET", severity: "medium" },
  { controlId: "DS-HDR-01", method: "GET", severity: "medium" },
] as const;

export type TransportV1Evidence = Record<string, boolean | number | string>;

export type TransportV1ProbeResult = {
  evidence: TransportV1Evidence;
  requestsCount: number;
  bytesCount: number;
};

export type TransportV1ScanJob = Pick<
  ClaimedScanJob,
  "hostname" | "profileVersion"
>;

/**
 * Observation boundary for the reduced profile. Implementations must return
 * only derived evidence, never response bodies, raw headers, or IPs.
 */
export interface TransportV1ObservationSource {
  readonly sourceKind: "network";
  observeDns(hostname: string, signal: AbortSignal): Promise<TransportV1ProbeResult>;
  observeTls(hostname: string, signal: AbortSignal): Promise<TransportV1ProbeResult>;
  observeHttp(
    hostname: string,
    method: "HEAD" | "GET",
    signal: AbortSignal,
  ): Promise<TransportV1ProbeResult>;
  observeHeaders(hostname: string, signal: AbortSignal): Promise<TransportV1ProbeResult>;
}

export interface TransportV1FixtureObservationSource {
  readonly sourceKind: "fixture";
  observeDns(hostname: string, signal: AbortSignal): Promise<TransportV1Evidence>;
  observeTls(hostname: string, signal: AbortSignal): Promise<TransportV1Evidence>;
  observeHttp(
    hostname: string,
    method: "HEAD" | "GET",
    signal: AbortSignal,
  ): Promise<TransportV1Evidence>;
  observeHeaders(hostname: string, signal: AbortSignal): Promise<TransportV1Evidence>;
}

export class TransportV1FixtureExecutor {
  constructor(
    private readonly source: TransportV1FixtureObservationSource,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async execute(
    job: TransportV1ScanJob,
    signal: AbortSignal,
  ): Promise<
    Omit<ScanRunInput, "jobId" | "leaseToken" | "hostname" | "profileVersion">
  > {
    if (job.profileVersion !== PROFILE_VERSION) {
      throw new Error("unsupported_scan_profile");
    }

    const startedAt = this.now();
    const observations = await Promise.all([
      safelyObserve(() => this.source.observeDns(job.hostname, signal), signal),
      safelyObserve(() => this.source.observeTls(job.hostname, signal), signal),
      safelyObserve(
        () => this.source.observeHttp(job.hostname, "HEAD", signal),
        signal,
      ),
      safelyObserve(
        () => this.source.observeHttp(job.hostname, "GET", signal),
        signal,
      ),
      safelyObserve(
        () => this.source.observeHeaders(job.hostname, signal),
        signal,
      ),
    ]);
    const completedAt = this.now();
    const observedAt = completedAt;
    const candidateChecks: ScanCheck[] = CHECKS.map((definition, index) => ({
      ...definition,
      status: "pass",
      required: true,
      observedAt,
      targetPath: "/",
      summary: "",
      limitation: "",
      evidence: observations[index] ?? {},
    }));

    const sanitized = sanitizeScanObservations(
      job.hostname,
      PROFILE_VERSION,
      ["/"],
      candidateChecks,
    );

    return {
      scannerVersion: FIXTURE_SCANNER_VERSION,
      startedAt,
      completedAt,
      verdict: evaluateVerdict(sanitized.checks),
      scope: sanitized.scope,
      checks: sanitized.checks,
      metrics: {
        requestsCount: 0,
        bytesCount: 0,
        durationMs: Math.max(0, completedAt.getTime() - startedAt.getTime()),
        pagesCount: 0,
      },
    };
  }
}

export class TransportV1NetworkExecutor {
  constructor(
    private readonly source: TransportV1ObservationSource,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async execute(
    job: TransportV1ScanJob,
    signal: AbortSignal,
  ): Promise<
    Omit<ScanRunInput, "jobId" | "leaseToken" | "hostname" | "profileVersion">
  > {
    if (job.profileVersion !== PROFILE_VERSION) {
      throw new Error("unsupported_scan_profile");
    }

    const startedAt = this.now();
    const broker = createTransportV1EgressBroker(job.hostname, this.source);
    const operations = ["dns", "tls", "http-head", "http-get", "headers"] as const;
    const observations = operations.map((operation) => async () => {
      const requestId = randomUUID();
      const response = await broker(
        {
          protocolVersion: 1,
          requestId,
          hostname: job.hostname,
          operation,
        },
        signal,
      );
      if (
        response.protocolVersion !== 1 ||
        response.requestId !== requestId
      ) {
        throw new Error("egress_broker_response_invalid");
      }
      return response.result;
    });
    const probes = await observeNetworkProbes(
      observations,
      signal,
      MAX_CONCURRENT_NETWORK_PROBES,
    );
    const completedAt = this.now();
    const candidateChecks: ScanCheck[] = CHECKS.map((definition, index) => ({
      ...definition,
      status: "pass",
      required: true,
      observedAt: completedAt,
      targetPath: "/",
      summary: "",
      limitation: "",
      evidence: probes[index]?.evidence ?? {},
    }));
    const sanitized = sanitizeScanObservations(
      job.hostname,
      PROFILE_VERSION,
      ["/"],
      candidateChecks,
    );

    return {
      scannerVersion: NETWORK_SCANNER_VERSION,
      startedAt,
      completedAt,
      verdict: evaluateVerdict(sanitized.checks),
      scope: sanitized.scope,
      checks: sanitized.checks,
      metrics: {
        requestsCount: probes.reduce((sum, probe) => sum + (probe?.requestsCount ?? 0), 0),
        bytesCount: probes.reduce((sum, probe) => sum + (probe?.bytesCount ?? 0), 0),
        durationMs: Math.max(0, completedAt.getTime() - startedAt.getTime()),
        pagesCount: 0,
      },
    };
  }
}

async function safelyObserve(
  observe: () => Promise<TransportV1Evidence>,
  signal: AbortSignal,
): Promise<TransportV1Evidence | undefined> {
  if (signal.aborted) return undefined;
  try {
    const evidence = await observe();
    return signal.aborted ? undefined : evidence;
  } catch {
    return undefined;
  }
}

async function safelyObserveNetwork(
  observe: () => Promise<TransportV1ProbeResult>,
  signal: AbortSignal,
): Promise<TransportV1ProbeResult | undefined> {
  if (signal.aborted) return undefined;
  try {
    const result = await observe();
    return signal.aborted ? { ...result, evidence: {} } : result;
  } catch {
    return undefined;
  }
}

async function observeNetworkProbes(
  observations: readonly (() => Promise<TransportV1ProbeResult>)[],
  signal: AbortSignal,
  maxConcurrency: number,
): Promise<(TransportV1ProbeResult | undefined)[]> {
  const results: (TransportV1ProbeResult | undefined)[] = Array.from(
    { length: observations.length },
    () => undefined,
  );
  let nextIndex = 0;
  const workers = Array.from(
    { length: Math.min(maxConcurrency, observations.length) },
    async () => {
      while (nextIndex < observations.length) {
        const currentIndex = nextIndex;
        nextIndex += 1;
        const observe = observations[currentIndex];
        if (observe) {
          results[currentIndex] = await safelyObserveNetwork(observe, signal);
        }
      }
    },
  );
  await Promise.all(workers);
  return results;
}
