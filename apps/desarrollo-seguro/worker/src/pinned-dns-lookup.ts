import { lookup } from "node:dns/promises";
import type { LookupAddress } from "node:dns";
import { isIP, type LookupFunction } from "node:net";
import { normalizeHostname } from "@desarrolloseguro/core";

const MAX_DNS_ANSWERS = 32;
const MAX_CONCURRENT_DNS_LOOKUPS = 2;
const DNS_LOOKUP_TIMEOUT_MS = 5_000;
const LOOKUP_FAILURE_CODE = "EHOSTUNREACH";
const LOOKUP_FAILURE_MESSAGE = "pinned_dns_lookup_failed";

const BLOCKED_IPV4_CIDRS = [
  "0.0.0.0/8",
  "10.0.0.0/8",
  "100.64.0.0/10",
  "127.0.0.0/8",
  "169.254.0.0/16",
  "172.16.0.0/12",
  "192.0.0.0/24",
  "192.0.2.0/24",
  "192.88.99.0/24",
  "192.168.0.0/16",
  "198.18.0.0/15",
  "198.51.100.0/24",
  "203.0.113.0/24",
  "224.0.0.0/4",
  "240.0.0.0/4",
] as const;

const IPV6_GLOBAL_UNICAST_CIDR = "2000::/3";
const BLOCKED_IPV6_CIDRS = [
  "100::/64",
  "100:0:0:1::/64",
  "2001::/23",
  "2001:db8::/32",
  "2002::/16",
  "3fff::/20",
  "64:ff9b::/96",
  "64:ff9b:1::/48",
] as const;

type Resolver = (hostname: string) => Promise<readonly LookupAddress[]>;
type AddressFamily = 4 | 6;
type ParsedAddress = { family: AddressFamily; value: bigint; bits: number };
type DnsLookupLimiter = {
  run<T>(operation: () => Promise<T>): Promise<T>;
};

const defaultResolver: Resolver = async (hostname) =>
  lookup(hostname, { all: true, order: "verbatim" });

function createDnsLookupLimiter(): DnsLookupLimiter {
  let activeLookups = 0;
  return {
    run<T>(operation: () => Promise<T>): Promise<T> {
      if (activeLookups >= MAX_CONCURRENT_DNS_LOOKUPS) {
        return Promise.reject(createLookupError());
      }

      activeLookups += 1;
      let result: Promise<T>;
      try {
        result = operation();
      } catch {
        activeLookups -= 1;
        return Promise.reject(createLookupError());
      }

      return result.then(
        (value) => {
          activeLookups -= 1;
          return value;
        },
        () => {
          activeLookups -= 1;
          throw createLookupError();
        },
      );
    },
  };
}

const moduleDnsLookupLimiter = createDnsLookupLimiter();

export function createPinnedLookup(
  resolver: Resolver = defaultResolver,
): LookupFunction {
  const limitedResolver: Resolver = (hostname) =>
    moduleDnsLookupLimiter.run(() => resolver(hostname));

  return (hostname, options, callback) => {
    void resolvePublicAddresses(hostname, limitedResolver).then(
      (addresses) => {
        const family = options.family;
        const eligible = getEligibleAddresses(addresses, family);

        if (eligible.length === 0) {
          failLookup(options.all, callback);
          return;
        }

        if (options.all) {
          callback(null, eligible);
          return;
        }

        const selected = eligible[0];
        if (selected === undefined) {
          failLookup(options.all, callback);
          return;
        }
        callback(null, selected.address, selected.family);
      },
      () => failLookup(options.all, callback),
    );
  };
}

function getEligibleAddresses(
  addresses: LookupAddress[],
  family: number | "IPv4" | "IPv6" | undefined,
): LookupAddress[] {
  if (family === undefined || family === 0) {
    return addresses;
  }
  if (family === 4 || family === "IPv4") {
    return addresses.filter((address) => address.family === 4);
  }
  if (family === 6 || family === "IPv6") {
    return addresses.filter((address) => address.family === 6);
  }
  return [];
}

async function resolvePublicAddresses(
  inputHostname: unknown,
  resolver: Resolver,
): Promise<LookupAddress[]> {
  const hostname = normalizeHostname(inputHostname);
  const answers = await resolveWithTimeout(resolver(hostname));
  if (
    !Array.isArray(answers) ||
    answers.length === 0 ||
    answers.length > MAX_DNS_ANSWERS
  ) {
    throw createLookupError();
  }

  const validatedAnswers = answers.map(validatePublicAddress);
  const uniqueAnswers = new Map<string, LookupAddress>();
  for (const address of validatedAnswers) {
    uniqueAnswers.set(`${address.family}:${address.address}`, address);
  }
  return [...uniqueAnswers.values()];
}

function resolveWithTimeout<T>(operation: Promise<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(createLookupError()),
      DNS_LOOKUP_TIMEOUT_MS,
    );
    operation.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      () => {
        clearTimeout(timer);
        reject(createLookupError());
      },
    );
  });
}

function failLookup(
  all: boolean | undefined,
  callback: Parameters<LookupFunction>[2],
): void {
  if (all) {
    callback(createLookupError(), []);
    return;
  }
  callback(createLookupError(), "", 0);
}

function validatePublicAddress(input: unknown): LookupAddress {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    throw createLookupError();
  }

  const candidate = input as Record<string, unknown>;
  if (
    typeof candidate.address !== "string" ||
    (candidate.family !== 4 && candidate.family !== 6)
  ) {
    throw createLookupError();
  }

  const parsed = parseAddress(candidate.address);
  if (
    parsed === null ||
    parsed.family !== candidate.family ||
    !isGloballyRoutable(parsed)
  ) {
    throw createLookupError();
  }

  return { address: candidate.address, family: candidate.family };
}

function parseAddress(address: string): ParsedAddress | null {
  const family = isIP(address);
  if (family === 4) {
    const octets = address.split(".").map(Number);
    return {
      family: 4,
      value: octets.reduce((value, octet) => (value << 8n) | BigInt(octet), 0n),
      bits: 32,
    };
  }
  if (family !== 6 || address.includes("%")) {
    return null;
  }

  const words = parseIPv6Words(address);
  if (words === null) {
    return null;
  }
  return {
    family: 6,
    value: words.reduce((value, word) => (value << 16n) | BigInt(word), 0n),
    bits: 128,
  };
}

function parseIPv6Words(address: string): number[] | null {
  const halves = address.split("::");
  if (halves.length > 2) {
    return null;
  }
  const left = parseIPv6Half(halves[0] ?? "");
  const right = parseIPv6Half(halves[1] ?? "");
  if (left === null || right === null) {
    return null;
  }

  if (halves.length === 1) {
    return left.length === 8 ? left : null;
  }
  const missingWords = 8 - left.length - right.length;
  if (missingWords < 1) {
    return null;
  }
  return [...left, ...Array.from({ length: missingWords }, () => 0), ...right];
}

function parseIPv6Half(half: string): number[] | null {
  if (half.length === 0) {
    return [];
  }
  const segments = half.split(":");
  const words: number[] = [];
  for (const segment of segments) {
    if (segment.includes(".")) {
      if (segment !== segments.at(-1)) {
        return null;
      }
      const ipv4 = parseAddress(segment);
      if (ipv4 === null || ipv4.family !== 4) {
        return null;
      }
      words.push(
        Number((ipv4.value >> 16n) & 0xffffn),
        Number(ipv4.value & 0xffffn),
      );
      continue;
    }
    if (!/^[a-fA-F0-9]{1,4}$/u.test(segment)) {
      return null;
    }
    words.push(Number.parseInt(segment, 16));
  }
  return words;
}

function isGloballyRoutable(address: ParsedAddress): boolean {
  if (address.family === 4) {
    return !BLOCKED_IPV4_CIDRS.some((cidr) => matchesCidr(address, cidr));
  }
  return (
    matchesCidr(address, IPV6_GLOBAL_UNICAST_CIDR) &&
    !BLOCKED_IPV6_CIDRS.some((cidr) => matchesCidr(address, cidr))
  );
}

function matchesCidr(address: ParsedAddress, cidr: string): boolean {
  const [networkInput, prefixInput] = cidr.split("/");
  if (networkInput === undefined || prefixInput === undefined) {
    return false;
  }
  const network = parseAddress(networkInput);
  const prefix = Number(prefixInput);
  if (
    network === null ||
    network.family !== address.family ||
    !Number.isInteger(prefix) ||
    prefix < 0 ||
    prefix > address.bits
  ) {
    return false;
  }
  const shift = BigInt(address.bits - prefix);
  return address.value >> shift === network.value >> shift;
}

function createLookupError(): NodeJS.ErrnoException {
  const error = new Error(LOOKUP_FAILURE_MESSAGE) as NodeJS.ErrnoException;
  error.code = LOOKUP_FAILURE_CODE;
  return error;
}
