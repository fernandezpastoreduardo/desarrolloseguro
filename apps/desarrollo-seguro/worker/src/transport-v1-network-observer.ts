import type { LookupFunction } from "node:net";
import {
  observePublicDns,
  type PublicDnsResolver,
} from "./pinned-dns-lookup.js";
import {
  requestPinnedHttpUpgrade,
  type HttpRequestFactory,
} from "./pinned-http-upgrade.js";
import {
  requestPinnedHttps,
  type HttpsRequestFactory,
} from "./pinned-https-transport.js";
import { PinnedTransportError } from "./pinned-transport-error.js";
import type {
  TransportV1Evidence,
  TransportV1ObservationSource,
  TransportV1ProbeResult,
} from "./transport-v1-executor.js";

const ROOT_PATHS = ["/"] as const;

export type TransportV1NetworkObserverDependencies = {
  dnsResolver?: PublicDnsResolver;
  lookupFactory?: () => LookupFunction;
  httpRequestFactory?: HttpRequestFactory;
  httpsRequestFactory?: HttpsRequestFactory;
  httpsCa?: string;
};

/**
 * Collects the reduced profile's evidence using bounded, pinned transports.
 * It is not wired to a worker entrypoint and must run only after process and
 * egress isolation have been implemented and verified.
 */
export function createTransportV1NetworkObserver(
  dependencies: TransportV1NetworkObserverDependencies = {},
): TransportV1ObservationSource {
  return {
    sourceKind: "network",
    async observeDns(hostname, signal) {
      return collectProbe(
        async () => {
          assertNotAborted(signal);
          return observePublicDns(hostname, dependencies.dnsResolver);
        },
        (evidence) => ({
          evidence,
          requestsCount: 0,
          bytesCount: 0,
        }),
      );
    },
    async observeTls(hostname, signal) {
      return collectProbe(
        () =>
          requestPinnedHttps(
            {
              hostname,
              path: "/",
              method: "HEAD",
              allowedPaths: ROOT_PATHS,
              signal,
            },
            {
              ca: dependencies.httpsCa,
              lookupFactory: dependencies.lookupFactory,
              requestFactory: dependencies.httpsRequestFactory,
            },
          ),
        (result) => ({
          evidence: getTlsEvidence(result.tlsAuthorized, result.tlsProtocol),
          requestsCount: result.requestsCount,
          bytesCount: result.bytesCount,
        }),
      );
    },
    async observeHttp(hostname, method, signal) {
      return collectProbe(
        () =>
          requestPinnedHttpUpgrade(
            {
              hostname,
              path: "/",
              method,
              allowedPaths: ROOT_PATHS,
              signal,
            },
            {
              httpsCa: dependencies.httpsCa,
              lookupFactory: dependencies.lookupFactory,
              requestFactory: dependencies.httpRequestFactory,
              httpsRequestFactory: dependencies.httpsRequestFactory,
            },
          ),
        (result) => ({
          evidence: {
            statusCode: result.statusCode,
            redirectedToHttps: result.redirectedToHttps,
            finalScheme: result.finalScheme,
          },
          requestsCount: result.requestsCount,
          bytesCount: result.bytesCount,
        }),
      );
    },
    async observeHeaders(hostname, signal) {
      return collectProbe(
        () =>
          requestPinnedHttps(
            {
              hostname,
              path: "/",
              method: "GET",
              allowedPaths: ROOT_PATHS,
              signal,
            },
            {
              ca: dependencies.httpsCa,
              lookupFactory: dependencies.lookupFactory,
              requestFactory: dependencies.httpsRequestFactory,
            },
          ),
        (result) => ({
          evidence: {
            finalScheme: "https",
            ...(result.tlsAuthorized ? (result.securityHeaders ?? {}) : {}),
          } satisfies TransportV1Evidence,
          requestsCount: result.requestsCount,
          bytesCount: result.bytesCount,
        }),
      );
    },
  };
}

function assertNotAborted(signal: AbortSignal): void {
  if (signal.aborted) throw new Error("request_aborted");
}

function getTlsEvidence(
  tlsAuthorized: boolean,
  tlsProtocol: "TLSv1.2" | "TLSv1.3" | undefined,
): TransportV1Evidence {
  if (!tlsAuthorized || !tlsProtocol) return {};
  return {
    protocol: tlsProtocol,
    certificateValid: true,
    hostnameMatches: true,
  };
}

async function collectProbe<T>(
  operation: () => Promise<T>,
  project: (result: T) => TransportV1ProbeResult,
): Promise<TransportV1ProbeResult> {
  try {
    return project(await operation());
  } catch (error) {
    return {
      evidence: {},
      requestsCount: error instanceof PinnedTransportError ? error.requestsCount : 0,
      bytesCount: error instanceof PinnedTransportError ? error.bytesCount : 0,
    };
  }
}
