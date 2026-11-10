import { normalizeHostname } from "@desarrolloseguro/core";

export type TransportV1EgressBrokerStartupRequest = {
  protocolVersion: 1;
  hostname: string;
  profileVersion: "transport-v1";
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
    request.profileVersion !== "transport-v1"
  ) {
    throw new Error("egress_broker_startup_invalid");
  }
  try {
    return {
      protocolVersion: 1,
      hostname: normalizeHostname(request.hostname),
      profileVersion: "transport-v1",
    };
  } catch {
    throw new Error("egress_broker_startup_invalid");
  }
}
