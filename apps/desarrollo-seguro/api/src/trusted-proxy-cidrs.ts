import { isIP } from "node:net";

const INVALID_TRUSTED_PROXY_CIDRS = "invalid_ds_trusted_proxy_cidrs";

export function parseTrustedProxyCidrs(value: string | undefined): string[] {
  if (value === undefined || value.trim() === "") return [];

  const cidrs = value.split(",").map((entry) => entry.trim());
  if (cidrs.some((entry) => entry === "" || !isValidCidr(entry))) {
    throw new Error(INVALID_TRUSTED_PROXY_CIDRS);
  }
  return cidrs;
}

function isValidCidr(value: string): boolean {
  const [address, prefix, ...unexpectedParts] = value.split("/");
  if (unexpectedParts.length > 0 || !address) return false;

  const ipVersion = isIP(address);
  if (ipVersion === 0) return false;
  if (prefix === undefined) return true;
  if (!/^\d+$/u.test(prefix)) return false;

  const prefixLength = Number(prefix);
  const maxPrefixLength = ipVersion === 4 ? 32 : 128;
  return (
    Number.isSafeInteger(prefixLength) &&
    prefixLength > 0 &&
    prefixLength <= maxPrefixLength
  );
}
