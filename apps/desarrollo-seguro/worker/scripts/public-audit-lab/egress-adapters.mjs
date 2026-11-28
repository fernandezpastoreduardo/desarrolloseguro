import { lookup as defaultLookup } from "node:dns";
import { request as httpRequest } from "node:http";
import { connect as tcpConnect } from "node:net";
import { request as httpsRequest } from "node:https";

const SYNTHETIC_ADDRESS = "93.184.216.34";
const SYNTHETIC_HOST_PATTERN = /^scan-[a-z0-9-]{1,48}\.example\.net$/u;

/**
 * Test-only egress adapters. Every resolver and connector is pinned to one
 * per-run hostname and an internal fixture service. Never import this module
 * from an application entrypoint or a production image.
 */
export function createLabEgressAdapters({
  hostname,
  fixtureHost = "public-audit-fixture",
  httpsPort = 8443,
  httpPort = 8080,
  certificatePem,
}) {
  assertSyntheticHostname(hostname);
  assertSafeFixtureHost(fixtureHost);
  assertPort(httpsPort);
  assertPort(httpPort);
  if (typeof certificatePem !== "string" || certificatePem.length < 32) {
    throw new Error("lab_fixture_certificate_required");
  }

  const resolveExactHostname = async (requestedHostname) => {
    if (normalizeHostname(requestedHostname) !== hostname) {
      throw new Error("lab_egress_hostname_blocked");
    }
    return [{ address: SYNTHETIC_ADDRESS, family: 4 }];
  };

  const createRequestFactory = (scheme) => (options, callback) => {
    const expectedPort = scheme === "https:" ? 443 : 80;
    const fixturePort = scheme === "https:" ? httpsPort : httpPort;
    if (
      normalizeHostname(options.hostname) !== hostname ||
      Number(options.port ?? expectedPort) !== expectedPort ||
      options.protocol !== scheme ||
      typeof options.path !== "string" ||
      !options.path.startsWith("/") ||
      options.path.includes("#")
    ) {
      throw new Error("lab_egress_request_blocked");
    }

    const headers = { ...options.headers, host: hostname };
    const fixtureOptions = {
      ...options,
      hostname: fixtureHost,
      host: fixtureHost,
      port: fixturePort,
      path: options.path,
      headers,
      lookup: defaultLookup,
      ...(scheme === "https:" ? {
        servername: hostname,
        ca: certificatePem,
      } : {}),
    };
    return scheme === "https:"
      ? httpsRequest(fixtureOptions, callback)
      : httpRequest(fixtureOptions, callback);
  };

  const connectPinned = (address, port) => {
    if (address !== SYNTHETIC_ADDRESS || (port !== 80 && port !== 443)) {
      throw new Error("lab_egress_destination_blocked");
    }
    return tcpConnect({
      host: fixtureHost,
      port: port === 443 ? httpsPort : httpPort,
    });
  };

  return Object.freeze({
    hostname,
    syntheticAddress: SYNTHETIC_ADDRESS,
    dnsResolver: resolveExactHostname,
    lookup: resolveExactHostname,
    httpsRequestFactory: createRequestFactory("https:"),
    httpRequestFactory: createRequestFactory("http:"),
    connectPinned,
  });
}

function assertSyntheticHostname(hostname) {
  if (typeof hostname !== "string" || !SYNTHETIC_HOST_PATTERN.test(hostname)) {
    throw new Error("lab_egress_hostname_invalid");
  }
}

function assertSafeFixtureHost(hostname) {
  if (typeof hostname !== "string" || !/^public-audit-fixture(?:-[a-z0-9-]{1,48})?$/u.test(hostname)) {
    throw new Error("lab_fixture_host_invalid");
  }
}

function assertPort(port) {
  if (!Number.isSafeInteger(port) || port < 1 || port > 65_535) {
    throw new Error("lab_fixture_port_invalid");
  }
}

function normalizeHostname(hostname) {
  if (typeof hostname !== "string") return "";
  return hostname.toLowerCase().replace(/\.$/u, "");
}
