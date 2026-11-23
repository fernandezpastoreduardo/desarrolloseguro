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
  requestPinnedPublicPolicyDocument,
  requestPinnedHttps,
  type HttpsRequestFactory,
  type PinnedHttpsResult,
  type PinnedPublicPolicyDocumentResult,
} from "./pinned-https-transport.js";
import type { PublicPolicyLink } from "./public-policy-link-extractor.js";
import { PUBLIC_POLICY_LANGUAGE_CATALOG } from "./data/public-policy-language-catalog.js";
import {
  PinnedTransportError,
  safeTransportErrorCode,
} from "./pinned-transport-error.js";
import type {
  TransportV1Evidence,
  TransportV1ObservationSource,
  TransportV1ProbeResult,
} from "./transport-v1-executor.js";

const ROOT_PATHS = ["/"] as const;
const MAX_POLICY_DOCUMENTS = 30;
const MAX_POLICY_REQUESTS = 45;
const MAX_POLICY_BYTES = 3_500_000;
const MAX_CONCURRENT_POLICY_REQUESTS = 4;
const TLS_VERSION_PROBES = [
  { tlsVersion: "TLSv1", evidenceKey: "tls10Accepted", errorKey: "tls10ProbeError" },
  { tlsVersion: "TLSv1.1", evidenceKey: "tls11Accepted", errorKey: "tls11ProbeError" },
  { tlsVersion: "TLSv1.2", evidenceKey: "tls12Accepted", errorKey: "tls12ProbeError" },
  { tlsVersion: "TLSv1.3", evidenceKey: "tls13Accepted", errorKey: "tls13ProbeError" },
] as const;

export type TransportV1NetworkObserverDependencies = {
  dnsResolver?: PublicDnsResolver;
  lookupFactory?: (hostname: string, port: number) => LookupFunction;
  httpRequestFactory?: HttpRequestFactory;
  httpsRequestFactory?: HttpsRequestFactory;
  httpsCa?: string;
  inspectPage?: boolean;
  probeTlsVersions?: boolean;
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
      const negotiated = await collectProbe(
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
      if (!dependencies.probeTlsVersions || signal.aborted) return negotiated;

      const versionResults: TransportV1ProbeResult[] = [];
      for (const probe of TLS_VERSION_PROBES) {
        if (signal.aborted) break;
        versionResults.push(await collectProbe(
          () => requestPinnedHttps(
            {
              hostname,
              path: "/",
              method: "HEAD",
              allowedPaths: ROOT_PATHS,
              signal,
              tlsVersion: probe.tlsVersion,
              allowUntrustedCertificate: true,
              timeoutMs: 2_000,
            },
            {
              lookupFactory,
              requestFactory: dependencies.httpsRequestFactory,
            },
          ),
          (result) => ({
            evidence: result.tlsProtocol === probe.tlsVersion
              ? { [probe.evidenceKey]: true }
              : {},
            requestsCount: result.requestsCount,
            bytesCount: result.bytesCount,
          }),
        ));
      }
      const versionEvidence: TransportV1Evidence = {};
      let requestsCount = negotiated.requestsCount;
      let bytesCount = negotiated.bytesCount;
      for (const [index, result] of versionResults.entries()) {
        requestsCount += result.requestsCount;
        bytesCount += result.bytesCount;
        const evidenceKey = TLS_VERSION_PROBES[index].evidenceKey;
        if (typeof result.evidence[evidenceKey] === "boolean") {
          versionEvidence[evidenceKey] = result.evidence[evidenceKey];
        } else if (result.errorCode === "tls_handshake_failed") {
          versionEvidence[evidenceKey] = false;
        } else if (result.errorCode) {
          versionEvidence[TLS_VERSION_PROBES[index].errorKey] = result.errorCode;
        }
      }
      return {
        evidence: { ...negotiated.evidence, ...versionEvidence },
        requestsCount,
        bytesCount,
        ...(negotiated.errorCode ? { errorCode: negotiated.errorCode } : {}),
      };

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
            ...(result.grumphyaRedirectEvidence ? {
              requestedHostname: result.grumphyaRedirectEvidence.requestedHostname,
              finalHostname: result.grumphyaRedirectEvidence.finalHostname,
              ...(result.grumphyaRedirectEvidence.redirectStatusCode !== null
                ? { redirectStatusCode: result.grumphyaRedirectEvidence.redirectStatusCode }
                : {}),
              ...(result.grumphyaRedirectEvidence.redirectFromHostname
                ? { redirectFromHostname: result.grumphyaRedirectEvidence.redirectFromHostname }
                : {}),
              ...(result.grumphyaRedirectEvidence.redirectToHostname
                ? { redirectToHostname: result.grumphyaRedirectEvidence.redirectToHostname }
                : {}),
              ...(result.grumphyaRedirectEvidence.canonicalHostname
                ? { canonicalHostname: result.grumphyaRedirectEvidence.canonicalHostname }
                : {}),
            } : {}),
          },
          requestsCount: result.requestsCount,
          bytesCount: result.bytesCount,
        }),
      );
    },
    async observeHeaders(hostname, signal) {
      return collectProbe(
        async () => {
          const result = await requestPinnedHttps(
            {
              hostname,
              allowGrumphyaAliasRedirects: isGrumphyaHostname(hostname),
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
          );
          if (!dependencies.inspectPage || !result.publicPolicyLinks) {
            return { result, policyAudit: null as PublicPolicyAudit | null };
          }
          const policyAudit = await auditPublicPolicyLinks(
            hostname,
            result.publicPolicyLinks,
            signal,
            {
              lookupFactory,
              requestFactory: dependencies.httpsRequestFactory,
              ca: dependencies.httpsCa,
            },
          );
          return { result, policyAudit };
        },
        ({ result, policyAudit }) => ({
          evidence: {
            finalScheme: "https",
            ...(result.tlsAuthorized ? (result.securityHeaders ?? {}) : {}),
            ...(result.tlsAuthorized && result.passivePageSignals
              ? toPassivePageEvidence(result.passivePageSignals)
              : {}),
            ...(policyAudit ? toPublicPolicyEvidence(policyAudit) : {}),
          } satisfies TransportV1Evidence,
          requestsCount: result.requestsCount + (policyAudit?.requestsCount ?? 0),
          bytesCount: result.bytesCount + (policyAudit?.bytesCount ?? 0),
        }),
      );
    },
  };
}

type PublicPolicyAudit = {
  privacyPolicyLinksFound: number;
  policyLinksFound: number;
  sitePrivacyPolicyFetched: boolean;
  policyPagesFetched: number;
  policyPagesDenied: number;
  policyPagesMissing: number;
  policyRecipientsMentioned: boolean;
  policyPurposesMentioned: boolean;
  policyTextBlocked: boolean;
  policyProbeFailed: boolean;
    policyLanguageCatalogVersion: typeof PUBLIC_POLICY_LANGUAGE_CATALOG.version;
  requestsCount: number;
  bytesCount: number;
};

type PolicyRequestDependencies = {
  lookupFactory: (hostname: string, port: number) => LookupFunction;
  requestFactory: HttpsRequestFactory | undefined;
  ca: string | undefined;
};

async function auditPublicPolicyLinks(
  auditedHostname: string,
  initialLinks: readonly PublicPolicyLink[],
  signal: AbortSignal,
  dependencies: PolicyRequestDependencies,
): Promise<PublicPolicyAudit> {
  const queue = [...initialLinks];
  const queuedKeys = new Set(queue.map(policyLinkKey));
  const fetchedKeys = new Set<string>();
  const result: PublicPolicyAudit = {
    privacyPolicyLinksFound: 0,
    policyLinksFound: 0,
    sitePrivacyPolicyFetched: false,
    policyPagesFetched: 0,
    policyPagesDenied: 0,
    policyPagesMissing: 0,
    policyRecipientsMentioned: false,
    policyPurposesMentioned: false,
    policyTextBlocked: false,
    policyProbeFailed: false,
    policyLanguageCatalogVersion: PUBLIC_POLICY_LANGUAGE_CATALOG.version,
    requestsCount: 0,
    bytesCount: 0,
  };
  for (const link of queue) {
    if (isPrivacyPolicyLink(link)) result.privacyPolicyLinksFound += 1;
  }
  result.policyLinksFound = queue.length;

  let nextIndex = 0;
  while (nextIndex < queue.length && fetchedKeys.size < MAX_POLICY_DOCUMENTS && !signal.aborted) {
    if (result.requestsCount >= MAX_POLICY_REQUESTS || result.bytesCount >= MAX_POLICY_BYTES) {
      result.policyProbeFailed = true;
      break;
    }
    const batch = queue.slice(nextIndex, nextIndex + MAX_CONCURRENT_POLICY_REQUESTS);
    nextIndex += batch.length;
    const observations = await Promise.all(batch.map(async (link) => {
      const key = policyLinkKey(link);
      if (fetchedKeys.has(key)) return { link, observation: null, requestsCount: 0, bytesCount: 0 };
      fetchedKeys.add(key);
      try {
        const observation = await requestPinnedPublicPolicyDocument(
          { hostname: link.hostname, path: link.path, signal },
          {
            ca: dependencies.ca,
            lookupFactory: dependencies.lookupFactory,
            requestFactory: dependencies.requestFactory,
          },
        );
        return { link, observation, requestsCount: observation.requestsCount, bytesCount: observation.bytesCount };
      } catch (error) {
        return {
          link,
          observation: null,
          requestsCount: error instanceof PinnedTransportError ? error.requestsCount : 0,
          bytesCount: error instanceof PinnedTransportError ? error.bytesCount : 0,
        };
      }
    }));

    for (const item of observations) {
      result.requestsCount += item.requestsCount;
      result.bytesCount += item.bytesCount;
      if (!item.observation) {
        result.policyProbeFailed = true;
        continue;
      }
      applyPolicyDocumentObservation(result, auditedHostname, item.link, item.observation);
      for (const discovered of item.observation.discoveredPolicyLinks) {
        const key = policyLinkKey(discovered);
        if (queuedKeys.has(key) || queue.length >= MAX_POLICY_DOCUMENTS) continue;
        queuedKeys.add(key);
        queue.push(discovered);
        result.policyLinksFound += 1;
        if (isPrivacyPolicyLink(discovered)) result.privacyPolicyLinksFound += 1;
      }
    }
  }

  if (signal.aborted || (nextIndex < queue.length && fetchedKeys.size >= MAX_POLICY_DOCUMENTS)) {
    result.policyProbeFailed = true;
  }
  return result;
}

function applyPolicyDocumentObservation(
  result: PublicPolicyAudit,
  auditedHostname: string,
  link: PublicPolicyLink,
  observation: PinnedPublicPolicyDocumentResult,
): void {
  const statusCode = observation.statusCode;
  const sitePrivacyPolicy = areSameAuditSite(auditedHostname, link.hostname) &&
    (link.kind === "privacy" || link.kind === "cookies");
  if (statusCode === 403 || statusCode === 429) {
    result.policyPagesDenied += 1;
    result.policyTextBlocked = true;
    return;
  }
  if (statusCode >= 400 && statusCode < 500) {
    result.policyPagesMissing += 1;
    return;
  }
  if (statusCode < 200 || statusCode >= 300 || !observation.inspectedText) {
    result.policyProbeFailed = true;
    return;
  }
  result.policyPagesFetched += 1;
  if (sitePrivacyPolicy) result.sitePrivacyPolicyFetched = true;
  if (sitePrivacyPolicy) {
    result.policyRecipientsMentioned ||= observation.recipientsMentioned;
    result.policyPurposesMentioned ||= observation.purposesMentioned;
  }
  result.policyTextBlocked ||= observation.textBlocked;
}

function toPublicPolicyEvidence(audit: PublicPolicyAudit): TransportV1Evidence {
  return {
    privacyPolicyLinksFound: audit.privacyPolicyLinksFound,
    policyLinksFound: audit.policyLinksFound,
    sitePrivacyPolicyFetched: audit.sitePrivacyPolicyFetched,
    policyPagesFetched: audit.policyPagesFetched,
    policyPagesDenied: audit.policyPagesDenied,
    policyPagesMissing: audit.policyPagesMissing,
    policyRecipientsMentioned: audit.policyRecipientsMentioned,
    policyPurposesMentioned: audit.policyPurposesMentioned,
    policyTextBlocked: audit.policyTextBlocked,
    policyProbeFailed: audit.policyProbeFailed,
    policyLanguageCatalogVersion: audit.policyLanguageCatalogVersion,
  };
}

function isPrivacyPolicyLink(link: PublicPolicyLink): boolean {
  return link.kind === "privacy" || link.kind === "cookies";
}

function areSameAuditSite(first: string, second: string): boolean {
  return withoutWww(first) === withoutWww(second);
}

function withoutWww(hostname: string): string {
  return hostname.startsWith("www.") ? hostname.slice(4) : hostname;
}

function policyLinkKey(link: PublicPolicyLink): string {
  return `${link.hostname}${link.path}`;
}

function isGrumphyaHostname(hostname: string): boolean {
  return hostname === "grumphya.com" || hostname === "www.grumphya.com";
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
  tlsProtocol: "TLSv1" | "TLSv1.1" | "TLSv1.2" | "TLSv1.3" | undefined,
): TransportV1Evidence {
  if (!tlsAuthorized || !tlsProtocol) return {};
  return {
    ...(tlsProtocol === "TLSv1.2" || tlsProtocol === "TLSv1.3"
      ? { protocol: tlsProtocol }
      : {}),
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
      errorCode: safeTransportErrorCode(error, "transport_failed"),
    };
  }
}
