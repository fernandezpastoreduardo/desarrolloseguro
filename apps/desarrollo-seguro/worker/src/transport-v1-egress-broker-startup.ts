import { normalizeHostname } from "@desarrolloseguro/core";
import type { ScanProfileVersion } from "./transport-v1-executor.js";

export type TransportV1EgressBrokerStartupRequest = {
  protocolVersion: 1;
  hostname: string;
  profileVersion: ScanProfileVersion;
  targetPath: string;
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
  const isDomainV5 = request.profileVersion === "domain-v5";
  if (
    Reflect.ownKeys(request).length !== (isDomainV5 ? 4 : 3) ||
    request.protocolVersion !== 1 ||
    (request.profileVersion !== "transport-v1" &&
      request.profileVersion !== "domain-v1" &&
      request.profileVersion !== "domain-v2" &&
      request.profileVersion !== "domain-v3" &&
      request.profileVersion !== "domain-v4" &&
      request.profileVersion !== "domain-v5") ||
    (isDomainV5
      ? typeof request.targetPath !== "string" || !isSafeTargetPath(request.targetPath)
      : Object.hasOwn(request, "targetPath"))
  ) {
    throw new Error("egress_broker_startup_invalid");
  }
  try {
    return {
      protocolVersion: 1,
      hostname: normalizeHostname(request.hostname),
      profileVersion: request.profileVersion,
      targetPath: isDomainV5 ? request.targetPath as string : "/",
    };
  } catch {
    throw new Error("egress_broker_startup_invalid");
  }
}

function isSafeTargetPath(value: string): boolean {
  return value.length > 0 && value.length <= 2_048 && value.startsWith("/") && !value.startsWith("//") &&
    !hasUnsafeTargetPathCharacters(value);
}

function hasUnsafeTargetPathCharacters(value: string): boolean {
  return [...value].some((character) => {
    const code = character.codePointAt(0) ?? 0;
    return character === "#" || character === "\\" || code < 0x20 || code === 0x7f;
  });
}
