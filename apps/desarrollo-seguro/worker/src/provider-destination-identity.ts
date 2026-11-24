import { createHash } from "node:crypto";
import { normalizeHostname } from "@desarrolloseguro/core";

export type ProviderDestinationIdentity = {
  providerId: string;
  hostname: string;
  displayName: string;
};

/** Creates a stable catalog key without attributing a destination to a company. */
export function identifyUnattributedProviderDestination(input: string): ProviderDestinationIdentity {
  const hostname = normalizeHostname(input);
  const suffix = createHash("sha256").update(hostname).digest("hex").slice(0, 8);
  let slug = hostname.replace(/[^a-z0-9]+/giu, "_");
  while (slug.startsWith("_")) slug = slug.slice(1);
  while (slug.endsWith("_")) slug = slug.slice(0, -1);
  slug = slug.slice(0, 20) || "external";
  return {
    providerId: `dst_${slug}_${suffix}`.slice(0, 32),
    hostname,
    displayName: `Destino externo ${hostname}`.slice(0, 120),
  };
}
