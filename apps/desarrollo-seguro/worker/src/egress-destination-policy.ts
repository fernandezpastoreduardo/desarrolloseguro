import type { LookupAddress } from "node:dns";
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
