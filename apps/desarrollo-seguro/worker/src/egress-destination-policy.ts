import type { LookupAddress } from "node:dns";
import type { LookupFunction } from "node:net";
import { normalizeHostname } from "@desarrolloseguro/core";
import {
  resolvePinnedPublicAddresses,
  type PublicDnsResolver,
} from "./pinned-dns-lookup.js";

const ALLOWED_EGRESS_PORTS = new Set([80, 443]);
const DESTINATION_DENIED = "egress_destination_denied";

export type EgressDestination = {
  hostname: unknown;
  port: unknown;
};

export type EgressDestinationAuthorizer = (
  destination: unknown,
) => Promise<readonly LookupAddress[]>;

/** Uses the addresses returned by policy validation directly for one socket. */
export function createEgressAuthorizedLookup(
  jobHostnameInput: unknown,
  port: number,
  authorize: EgressDestinationAuthorizer,
): LookupFunction {
  const jobHostname = normalizeHostname(jobHostnameInput);
  return (inputHostname, options, callback) => {
    let hostname: string;
    try {
      hostname = normalizeHostname(inputHostname);
    } catch {
      failLookup(options.all, callback);
      return;
    }
    if (hostname !== jobHostname) {
      failLookup(options.all, callback);
      return;
    }
    void authorize({ hostname, port }).then(
      (addresses) => {
        const eligible = addresses.filter(({ family }) =>
          isRequestedFamily(family, options.family),
        );
        if (eligible.length === 0) {
          failLookup(options.all, callback);
          return;
        }
        if (options.all) {
          callback(null, [...eligible]);
          return;
        }
        const selected = eligible[0];
        if (!selected) {
          failLookup(options.all, callback);
          return;
        }
        callback(null, selected.address, selected.family);
      },
      () => failLookup(options.all, callback),
    );
  };
}

/**
 * Creates a per-job destination policy for a future egress broker.
 * The returned addresses must be used directly for the socket connection;
 * resolving the hostname again after authorization would reopen DNS rebinding.
 */
export function createEgressDestinationAuthorizer(
  jobHostnameInput: unknown,
  resolver?: PublicDnsResolver,
): EgressDestinationAuthorizer {
  const jobHostname = normalizeHostname(jobHostnameInput);

  return async (input) => {
    const destination = parseDestination(input);
    let hostname: string;
    try {
      hostname = normalizeHostname(destination.hostname);
    } catch {
      throw createDestinationDeniedError();
    }

    if (
      hostname !== jobHostname ||
      typeof destination.port !== "number" ||
      !ALLOWED_EGRESS_PORTS.has(destination.port)
    ) {
      throw createDestinationDeniedError();
    }

    try {
      return await resolvePinnedPublicAddresses(hostname, resolver);
    } catch {
      throw createDestinationDeniedError();
    }
  };
}

function parseDestination(input: unknown): EgressDestination {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    throw createDestinationDeniedError();
  }

  const candidate = input as Record<string, unknown>;
  if (
    Object.getPrototypeOf(candidate) !== Object.prototype ||
    Reflect.ownKeys(candidate).length !== 2 ||
    !Object.hasOwn(candidate, "hostname") ||
    !Object.hasOwn(candidate, "port")
  ) {
    throw createDestinationDeniedError();
  }

  return { hostname: candidate.hostname, port: candidate.port };
}

function createDestinationDeniedError(): Error {
  return new Error(DESTINATION_DENIED);
}

function isRequestedFamily(
  family: number,
  requested: number | "IPv4" | "IPv6" | undefined,
): boolean {
  if (requested === undefined || requested === 0) return true;
  if (requested === 4 || requested === "IPv4") return family === 4;
  if (requested === 6 || requested === "IPv6") return family === 6;
  return false;
}

function failLookup(
  all: boolean | undefined,
  callback: Parameters<LookupFunction>[2],
): void {
  const error = Object.assign(new Error("egress_destination_denied"), {
    code: "EHOSTUNREACH",
  });
  if (all) {
    callback(error, []);
    return;
  }
  callback(error, "", 0);
}
