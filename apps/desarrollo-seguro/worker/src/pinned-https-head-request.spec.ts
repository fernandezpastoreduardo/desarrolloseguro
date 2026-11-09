import type { ClientRequest } from "node:http";
import type { RequestOptions } from "node:https";
import { describe, expect, it, vi } from "vitest";
import { createPinnedHttpsHeadRequest } from "./pinned-https-head-request.js";

const PUBLIC_HOSTNAME = "sample.example.net";
const UNNORMALIZED_HOSTNAME = " Sample.Example.Net. ";
const NORMALIZABLE_HOSTNAME = "  Sample.Example.Net.  ";
const INVALID_HOSTNAMES: unknown[] = [
  "127.0.0.1",
  "service.local",
  "https://sample.example.net/path",
  null,
];
const SIMULATED_REQUEST_ERROR = "simulated_request_capture";

describe("createPinnedHttpsHeadRequest", () => {
  it("passes secure pinned HTTPS options to Node without opening a socket", () => {
    let capturedOptions: RequestOptions | undefined;
    const requestFactory = vi.fn((options: RequestOptions): ClientRequest => {
      capturedOptions = options;
      throw new Error(SIMULATED_REQUEST_ERROR);
    });

    expect(() =>
      createPinnedHttpsHeadRequest(UNNORMALIZED_HOSTNAME, requestFactory),
    ).toThrow(SIMULATED_REQUEST_ERROR);

    expect(requestFactory).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({
        protocol: "https:",
        hostname: PUBLIC_HOSTNAME,
        port: 443,
        method: "HEAD",
        path: "/",
        servername: PUBLIC_HOSTNAME,
        headers: { host: PUBLIC_HOSTNAME },
        agent: false,
        rejectUnauthorized: true,
        lookup: expect.any(Function),
      }),
    );
    expect(capturedOptions?.rejectUnauthorized).toBe(true);
  });

  it("normalizes the hostname consistently for the request, Host and SNI", () => {
    let capturedOptions: RequestOptions | undefined;
    const requestFactory = vi.fn((options: RequestOptions): ClientRequest => {
      capturedOptions = options;
      throw new Error(SIMULATED_REQUEST_ERROR);
    });

    expect(() =>
      createPinnedHttpsHeadRequest(NORMALIZABLE_HOSTNAME, requestFactory),
    ).toThrow(SIMULATED_REQUEST_ERROR);

    expect(requestFactory).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({
        hostname: PUBLIC_HOSTNAME,
        servername: PUBLIC_HOSTNAME,
        headers: { host: PUBLIC_HOSTNAME },
      }),
    );
    expect(capturedOptions?.hostname).toBe(PUBLIC_HOSTNAME);
    expect(capturedOptions?.servername).toBe(PUBLIC_HOSTNAME);
    expect(capturedOptions?.headers).toEqual({ host: PUBLIC_HOSTNAME });
  });

  it.each(INVALID_HOSTNAMES)(
    "rejects invalid hostname input %s before passing anything to Node",
    (inputHostname) => {
      const requestFactory = vi.fn((): ClientRequest => {
        throw new Error(SIMULATED_REQUEST_ERROR);
      });

      expect(() =>
        createPinnedHttpsHeadRequest(inputHostname, requestFactory),
      ).toThrow("invalid_hostname");
      expect(requestFactory).not.toHaveBeenCalled();
    },
  );
});
