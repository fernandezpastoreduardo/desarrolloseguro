import { describe, expect, it } from "vitest";
import { createDevelopmentSecurityApiProxy } from "./api-proxy.js";

describe("createDevelopmentSecurityApiProxy", () => {
  it("proxies only the Development Security API to a local target", () => {
    expect(createDevelopmentSecurityApiProxy("http://127.0.0.1:3001")).toEqual(
      {
        "/api/desarrollo-seguro": {
          target: "http://127.0.0.1:3001",
          changeOrigin: false,
        },
      },
    );
  });

  it.each([
    "https://api.example.com",
    "http://localhost:3001/path",
    "http://user:pass@localhost:3001",
    "not-a-url",
  ])("rejects non-local API proxy target %s", (target) => {
    expect(() => createDevelopmentSecurityApiProxy(target)).toThrow(
      "development_security_api_proxy_target_must_be_local",
    );
  });
});
