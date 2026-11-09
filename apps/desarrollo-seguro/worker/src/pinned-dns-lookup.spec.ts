import type { LookupAddress } from "node:dns";
import type { LookupFunction } from "node:net";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createPinnedLookup } from "./pinned-dns-lookup.js";

const HOSTNAME = "sample.example.net";
const PUBLIC_IPV4: LookupAddress = { address: "93.184.216.34", family: 4 };
const PUBLIC_IPV6: LookupAddress = {
  address: "2606:4700:4700::1111",
  family: 6,
};

afterEach(() => vi.useRealTimers());

function runLookup(
  lookup: LookupFunction,
  hostname = HOSTNAME,
  options: { all?: boolean; family?: number } = {},
) {
  return new Promise<{
    error: NodeJS.ErrnoException | null;
    address: string | LookupAddress[];
    family?: number;
  }>((resolve) => {
    lookup(hostname, options, (error, address, family) => {
      resolve({ error, address, family });
    });
  });
}

function createDeferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

describe("createPinnedLookup", () => {
  it("returns validated public IPv4 addresses using a normalized hostname", async () => {
    const resolver = vi.fn().mockResolvedValue([PUBLIC_IPV4]);
    const result = await runLookup(
      createPinnedLookup(resolver),
      " Sample.Example.Net. ",
    );

    expect(result).toEqual({
      error: null,
      address: PUBLIC_IPV4.address,
      family: 4,
    });
    expect(resolver).toHaveBeenCalledExactlyOnceWith(HOSTNAME);
  });

  it("returns a validated public IPv6 address", async () => {
    const result = await runLookup(
      createPinnedLookup(async () => [PUBLIC_IPV6]),
      HOSTNAME,
      { family: 6 },
    );

    expect(result).toEqual({
      error: null,
      address: PUBLIC_IPV6.address,
      family: 6,
    });
  });

  it.each([
    ["unspecified", "0.0.0.0", 4],
    ["loopback", "127.0.0.1", 4],
    ["private", "10.2.3.4", 4],
    ["carrier-grade NAT", "100.64.0.1", 4],
    ["link-local", "169.254.169.254", 4],
    ["documentation", "192.0.2.1", 4],
    ["multicast", "224.0.0.1", 4],
    ["IPv6 unique-local", "fd00::1", 6],
    ["IPv6 discard-only", "100::1", 6],
    ["IPv6 dummy prefix", "100:0:0:1::1", 6],
    ["IPv6 link-local", "fe80::1", 6],
    ["IPv6 documentation", "2001:db8::1", 6],
    ["IPv6 protocol assignment", "2001::1", 6],
    ["IPv6 ORCHIDv2 special-purpose allocation", "2001:20::1", 6],
    ["IPv6 translation", "64:ff9b:1::1", 6],
    ["IPv6 documentation allocation", "3fff::1", 6],
    ["IPv4-mapped private IPv6", "::ffff:10.0.0.1", 6],
  ])("rejects %s address %s", async (_description, address, family) => {
    const result = await runLookup(
      createPinnedLookup(async () => [{ address, family }]),
    );

    expect(result.error?.code).toBe("EHOSTUNREACH");
    expect(result.address).toBe("");
  });

  it("rejects a mixed public and private DNS answer set", async () => {
    const result = await runLookup(
      createPinnedLookup(async () => [
        PUBLIC_IPV4,
        { address: "192.168.1.2", family: 4 },
      ]),
      HOSTNAME,
      { all: true },
    );

    expect(result.error?.code).toBe("EHOSTUNREACH");
    expect(result.address).toEqual([]);
  });

  it.each([
    ["empty", []],
    ["excessive", Array.from({ length: 33 }, () => PUBLIC_IPV4)],
  ])("rejects %s DNS answer sets", async (_description, answers) => {
    const result = await runLookup(
      createPinnedLookup(async () => answers),
      HOSTNAME,
      { all: true },
    );

    expect(result.error?.code).toBe("EHOSTUNREACH");
    expect(result.address).toEqual([]);
  });

  it("rejects an answer whose declared family does not match its address", async () => {
    const result = await runLookup(
      createPinnedLookup(async () => [
        { address: PUBLIC_IPV4.address, family: 6 },
      ]),
      HOSTNAME,
      { family: 4 },
    );

    expect(result.error?.code).toBe("EHOSTUNREACH");
    expect(result.address).toBe("");
  });

  it("validates answers outside the requested family before filtering", async () => {
    const result = await runLookup(
      createPinnedLookup(async () => [
        PUBLIC_IPV4,
        { address: "192.168.1.2", family: 4 },
        PUBLIC_IPV6,
      ]),
      HOSTNAME,
      { family: 6 },
    );

    expect(result.error?.code).toBe("EHOSTUNREACH");
    expect(result.address).toBe("");
  });

  it("does not resolve invalid hostnames", async () => {
    const resolver = vi.fn().mockResolvedValue([PUBLIC_IPV4]);
    const result = await runLookup(createPinnedLookup(resolver), "127.0.0.1");

    expect(result.error?.code).toBe("EHOSTUNREACH");
    expect(resolver).not.toHaveBeenCalled();
  });

  it("deduplicates equivalent address answers", async () => {
    const resolver = vi
      .fn()
      .mockResolvedValue([
        PUBLIC_IPV4,
        { address: "93.184.216.34", family: 4 },
      ]);
    const result = await runLookup(createPinnedLookup(resolver), HOSTNAME, {
      all: true,
    });

    expect(result).toEqual({
      error: null,
      address: [PUBLIC_IPV4],
      family: undefined,
    });
  });

  it("honors the requested family only after validating every answer", async () => {
    const resolver = vi.fn().mockResolvedValue([PUBLIC_IPV4, PUBLIC_IPV6]);
    const lookup = createPinnedLookup(resolver);

    await expect(runLookup(lookup, HOSTNAME, { family: 6 })).resolves.toEqual({
      error: null,
      address: PUBLIC_IPV6.address,
      family: 6,
    });
    await expect(runLookup(lookup, HOSTNAME, { all: true })).resolves.toEqual({
      error: null,
      address: [PUBLIC_IPV4, PUBLIC_IPV6],
      family: undefined,
    });
    expect(resolver).toHaveBeenCalledTimes(2);
  });

  it("resolves the hostname again for every lookup call", async () => {
    const nextAnswer = vi
      .fn()
      .mockResolvedValueOnce([PUBLIC_IPV4])
      .mockResolvedValueOnce([PUBLIC_IPV6]);
    const lookup = createPinnedLookup(nextAnswer);

    await expect(runLookup(lookup, HOSTNAME, { family: 4 })).resolves.toEqual({
      error: null,
      address: PUBLIC_IPV4.address,
      family: 4,
    });
    await expect(runLookup(lookup, HOSTNAME, { family: 6 })).resolves.toEqual({
      error: null,
      address: PUBLIC_IPV6.address,
      family: 6,
    });
    expect(nextAnswer).toHaveBeenCalledTimes(2);
    expect(nextAnswer).toHaveBeenNthCalledWith(1, HOSTNAME);
    expect(nextAnswer).toHaveBeenNthCalledWith(2, HOSTNAME);
  });

  it("fails closed when the DNS resolver errors without exposing its message", async () => {
    const result = await runLookup(
      createPinnedLookup(async () => {
        throw new Error("resolver leaked sensitive detail");
      }),
    );

    expect(result.error?.code).toBe("EHOSTUNREACH");
    expect(result.error?.message).not.toContain("sensitive");
  });

  it("returns an empty address list for an all-mode resolution error", async () => {
    const result = await runLookup(
      createPinnedLookup(async () => []),
      HOSTNAME,
      { all: true },
    );

    expect(result.error?.code).toBe("EHOSTUNREACH");
    expect(result.address).toEqual([]);
  });

  it("bounds how long it waits for a DNS resolver", async () => {
    vi.useFakeTimers();
    const pendingResolution = createDeferred<LookupAddress[]>();
    const lookup = createPinnedLookup(() => pendingResolution.promise);
    const resultPromise = runLookup(lookup, HOSTNAME, { all: true });

    await vi.advanceTimersByTimeAsync(5_000);
    await expect(resultPromise).resolves.toMatchObject({
      error: { code: "EHOSTUNREACH" },
      address: [],
    });
    pendingResolution.resolve([PUBLIC_IPV4]);
    await pendingResolution.promise;
  });

  it("keeps timed-out lookup slots occupied until the underlying DNS promises settle", async () => {
    vi.useFakeTimers();
    const pendingResolutions = Array.from({ length: 3 }, () =>
      createDeferred<LookupAddress[]>(),
    );
    let nextResolution = 0;
    const resolver = vi.fn(() => {
      const resolution = pendingResolutions[nextResolution];
      nextResolution += 1;
      if (!resolution) return Promise.reject(new Error("unexpected lookup"));
      return resolution.promise;
    });
    const lookup = createPinnedLookup(resolver);
    const firstTwo = Array.from({ length: 2 }, () =>
      runLookup(lookup, HOSTNAME, { all: true }),
    );

    expect(resolver).toHaveBeenCalledTimes(2);
    await expect(
      runLookup(lookup, HOSTNAME, { all: true }),
    ).resolves.toMatchObject({
      error: { code: "EHOSTUNREACH" },
      address: [],
    });
    await vi.advanceTimersByTimeAsync(5_000);
    expect(await Promise.all(firstTwo)).toHaveLength(2);

    await expect(
      runLookup(lookup, HOSTNAME, { all: true }),
    ).resolves.toMatchObject({
      error: { code: "EHOSTUNREACH" },
      address: [],
    });
    expect(resolver).toHaveBeenCalledTimes(2);

    pendingResolutions[0]?.resolve([PUBLIC_IPV4]);
    await pendingResolutions[0]?.promise;
    const afterUnderlyingResolution = runLookup(lookup, HOSTNAME, {
      all: true,
    });
    expect(resolver).toHaveBeenCalledTimes(3);

    pendingResolutions[1]?.resolve([PUBLIC_IPV4]);
    pendingResolutions[2]?.resolve([PUBLIC_IPV6]);
    await expect(afterUnderlyingResolution).resolves.toEqual({
      error: null,
      address: [PUBLIC_IPV6],
      family: undefined,
    });
    await Promise.all(
      pendingResolutions.slice(1, 2).map(({ promise }) => promise),
    );
  });

  it("keeps the shared process cap occupied across adapters after caller timeouts", async () => {
    vi.useFakeTimers();
    const pendingResolutions = Array.from({ length: 3 }, () =>
      createDeferred<LookupAddress[]>(),
    );
    let nextResolution = 0;
    const resolver = vi.fn(() => {
      const resolution = pendingResolutions[nextResolution];
      nextResolution += 1;
      if (!resolution) return Promise.reject(new Error("unexpected lookup"));
      return resolution.promise;
    });
    const firstAdapter = createPinnedLookup(resolver);
    const secondAdapter = createPinnedLookup(resolver);
    const firstTwo = [
      runLookup(firstAdapter, HOSTNAME, { all: true }),
      runLookup(secondAdapter, HOSTNAME, { all: true }),
    ];

    expect(resolver).toHaveBeenCalledTimes(2);
    const rejectedWhileAtCapacity = runLookup(firstAdapter, HOSTNAME, {
      all: true,
    });
    expect(resolver).toHaveBeenCalledTimes(2);
    await expect(rejectedWhileAtCapacity).resolves.toMatchObject({
      error: { code: "EHOSTUNREACH" },
      address: [],
    });
    await vi.advanceTimersByTimeAsync(5_000);
    await expect(Promise.all(firstTwo)).resolves.toHaveLength(2);

    await expect(
      runLookup(secondAdapter, HOSTNAME, { all: true }),
    ).resolves.toMatchObject({
      error: { code: "EHOSTUNREACH" },
      address: [],
    });
    expect(resolver).toHaveBeenCalledTimes(2);

    pendingResolutions[0]?.resolve([PUBLIC_IPV4]);
    await pendingResolutions[0]?.promise;
    const afterUnderlyingResolution = runLookup(firstAdapter, HOSTNAME, {
      all: true,
    });
    expect(resolver).toHaveBeenCalledTimes(3);

    pendingResolutions[1]?.resolve([PUBLIC_IPV4]);
    pendingResolutions[2]?.resolve([PUBLIC_IPV6]);
    await expect(afterUnderlyingResolution).resolves.toEqual({
      error: null,
      address: [PUBLIC_IPV6],
      family: undefined,
    });
    await Promise.all(
      pendingResolutions.slice(1, 2).map(({ promise }) => promise),
    );
  });
});
