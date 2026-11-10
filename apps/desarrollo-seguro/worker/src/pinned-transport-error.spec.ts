import { describe, expect, it } from "vitest";
import { safeTransportErrorCode } from "./pinned-transport-error.js";

describe("safeTransportErrorCode", () => {
  it("reduces certificate failures to a safe category", () => {
    const error = Object.assign(new Error("private certificate details"), {
      code: "UNABLE_TO_VERIFY_LEAF_SIGNATURE",
    });

    expect(safeTransportErrorCode(error, "https_request_failed")).toBe(
      "tls_certificate_invalid",
    );
  });

  it("groups TLS protocol failures without exposing the runtime message", () => {
    const error = Object.assign(new Error("private handshake details"), {
      code: "ERR_SSL_TLSV1_ALERT_PROTOCOL_VERSION",
    });

    expect(safeTransportErrorCode(error, "https_request_failed")).toBe(
      "tls_handshake_failed",
    );
  });

  it("uses the fallback for unclassified runtime errors", () => {
    expect(
      safeTransportErrorCode(new Error("private socket details"), "https_request_failed"),
    ).toBe("https_request_failed");
  });

  it("preserves allowlisted internal transport codes", () => {
    expect(safeTransportErrorCode("request_timeout", "https_request_failed")).toBe(
      "request_timeout",
    );
  });
});
