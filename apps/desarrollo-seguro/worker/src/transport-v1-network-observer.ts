import type { LookupFunction } from "node:net";
import {
  createEgressAuthorizedLookup,
  createEgressDestinationAuthorizer,
} from "./egress-destination-policy.js";
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
  type PinnedHttpsResult,
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
  lookupFactory?: (hostname: string, port: number) => LookupFunction;
  httpRequestFactory?: HttpRequestFactory;
  httpsRequestFactory?: HttpsRequestFactory;
  httpsCa?: string;
  inspectPage?: boolean;
};

/**
 * Collects reduced-profile evidence using bounded transports. The broker
 * entrypoint supplies this observer; outbound connections still require host
 * firewall policy and adversarial runtime verification before scans are enabled.
 */
export function createTransportV1NetworkObserver(
  dependencies: TransportV1NetworkObserverDependencies = {},
): TransportV1ObservationSource {
  const lookupFactory =
    dependencies.lookupFactory ??
    ((hostname: string, port: number) =>
      createEgressAuthorizedLookup(
        hostname,
        port,
        createEgressDestinationAuthorizer(hostname, dependencies.dnsResolver),
      ));
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
              lookupFactory,
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
              lookupFactory,
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
              inspectPage: dependencies.inspectPage === true,
            },
            {
              ca: dependencies.httpsCa,
              lookupFactory,
              requestFactory: dependencies.httpsRequestFactory,
            },
          ),
        (result) => ({
          evidence: {
            finalScheme: "https",
            ...(result.tlsAuthorized ? (result.securityHeaders ?? {}) : {}),
            ...(result.tlsAuthorized && result.passivePageSignals
              ? toPassivePageEvidence(result.passivePageSignals)
              : {}),
          } satisfies TransportV1Evidence,
          requestsCount: result.requestsCount,
          bytesCount: result.bytesCount,
        }),
      );
    },
  };
}

function toPassivePageEvidence(
  signals: NonNullable<PinnedHttpsResult["passivePageSignals"]>,
): TransportV1Evidence {
  return {
    inspected: signals.inspected,
    thirdPartyResourceReferences: signals.thirdPartyResourceReferences,
    knownTrackingResourceReferences: signals.knownTrackingResourceReferences,
    consentPromptDetected: signals.consentPromptDetected,
    cookieCount: signals.cookieCount,
    insecureCookieCount: signals.insecureCookieCount,
    catalogMatchCount: signals.catalogMatchCount,
    responseTimeMs: signals.responseTimeMs,
    responseBytes: signals.responseBytes,
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
