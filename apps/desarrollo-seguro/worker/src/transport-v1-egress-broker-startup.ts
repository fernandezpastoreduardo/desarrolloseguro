import { normalizeHostname } from "@desarrolloseguro/core";
import type { ScanProfileVersion } from "./transport-v1-executor.js";

export type TransportV1EgressBrokerStartupRequest = {
  protocolVersion: 1;
  hostname: string;
  profileVersion: ScanProfileVersion;
};

export function parseTransportV1EgressBrokerStartupRequest(
  input: unknown,
): TransportV1EgressBrokerStartupRequest {
  if (
    typeof input !== "object" ||
    input === null ||
    Array.isArray(input) ||
    Object.getPrototypeOf(input) !== Object.prototype
  ) {
    throw new Error("egress_broker_startup_invalid");
  }
  const request = input as Record<string, unknown>;
  if (
    Reflect.ownKeys(request).length !== 3 ||
    request.protocolVersion !== 1 ||
    (request.profileVersion !== "transport-v1" &&
      request.profileVersion !== "domain-v1" &&
      request.profileVersion !== "domain-v2" &&
      request.profileVersion !== "domain-v3")
  ) {
    throw new Error("egress_broker_startup_invalid");
  }
  try {
    return {
      protocolVersion: 1,
      hostname: normalizeHostname(request.hostname),
      profileVersion: request.profileVersion,
    };
  } catch {
    throw new Error("egress_broker_startup_invalid");
  }
}
