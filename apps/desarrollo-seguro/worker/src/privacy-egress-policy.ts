import { isIP } from "node:net";
import { lookup as dnsLookup } from "node:dns/promises";
import { normalizeHostname } from "@desarrolloseguro/core";

export type PrivacyTarget = {
  url: URL;
  hostname: string;
  port: 80 | 443;
};

export type PrivacyDnsLookup = (
  hostname: string,
) => Promise<Array<{ address: string; family: number }>>;

const PRIVATE_OR_RESERVED_IPV4 = [
  [0x00000000, 8], [0x0a000000, 8], [0x64400000, 10], [0x7f000000, 8],
  [0xa9fe0000, 16], [0xac100000, 12], [0xc0000000, 24], [0xc0000200, 24],
  [0xc0586300, 24], [0xc0a80000, 16], [0xc6120000, 15], [0xc6336400, 24],
  [0xcb007100, 24], [0xe0000000, 4], [0xf0000000, 4],
] as const;

export function authorizePrivacyTarget(input: unknown): PrivacyTarget {
  if (typeof input !== "string" || input.length > 2_048) throw new Error("privacy_target_invalid");
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    throw new Error("privacy_target_invalid");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error("privacy_target_scheme_blocked");
  if (url.username || url.password || url.hash) throw new Error("privacy_target_invalid");
  if (url.port !== "" && url.port !== "80" && url.port !== "443") throw new Error("privacy_target_port_blocked");

  let hostname: string;
  try {
    hostname = normalizeHostname(url.hostname);
  } catch {
    throw new Error("privacy_target_hostname_blocked");
  }
  if (isIP(hostname) !== 0) throw new Error("privacy_target_ip_literal_blocked");
  const port = url.protocol === "https:" ? 443 : 80;
  if (url.port && Number(url.port) !== port) throw new Error("privacy_target_port_blocked");
  return { url, hostname, port };
}

/** Resolves once and returns one pinned public IPv4 address for the connection. */
export async function resolvePinnedPublicIpv4(
  hostnameInput: string,
  lookup: PrivacyDnsLookup = defaultLookup,
): Promise<string> {
  let hostname: string;
  try {
    hostname = normalizeHostname(hostnameInput);
  } catch {
    throw new Error("privacy_dns_hostname_blocked");
  }
  const addresses = await lookup(hostname);
  const ipv4 = addresses.filter(({ family }) => family === 4);
  if (ipv4.length === 0 || ipv4.some(({ address }) => !isPublicIpv4(address))) {
    throw new Error("privacy_dns_address_blocked");
  }
  return ipv4[0]!.address;
}

export function isPublicIpv4(address: string): boolean {
  if (isIP(address) !== 4) return false;
  const value = address.split(".").reduce((result, octet) => (result << 8) | Number(octet), 0) >>> 0;
  return !PRIVATE_OR_RESERVED_IPV4.some(([network, prefix]) => {
    const mask = (0xffffffff << (32 - prefix)) >>> 0;
    return (value & mask) === ((network >>> 0) & mask);
  });
}

async function defaultLookup(hostname: string): Promise<Array<{ address: string; family: number }>> {
  return dnsLookup(hostname, { all: true, verbatim: true });
}
