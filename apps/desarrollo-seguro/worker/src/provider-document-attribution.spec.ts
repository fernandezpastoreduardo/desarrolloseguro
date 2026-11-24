import { describe, expect, it } from "vitest";
import { findUniqueCatalogedOfficialDocument } from "./provider-document-attribution.js";

describe("findUniqueCatalogedOfficialDocument", () => {
  it("attributes only an exact canonical URL with one catalog owner", () => {
    const match = findUniqueCatalogedOfficialDocument("https://vendor.example.com/privacy#cookies", [{
      providerId: "dst_vendor_1234567",
      displayName: "Vendor",
      officialDocuments: [{ kind: "privacy", title: "Privacy", url: "https://vendor.example.com/privacy" }],
    }]);
    expect(match?.providerId).toBe("dst_vendor_1234567");
    expect(match?.kind).toBe("privacy");
  });

  it("leaves a shared official URL unattributed", () => {
    const providers = ["dst_google_1234567", "dst_google_cloud_1234567"].map((providerId) => ({
      providerId,
      displayName: providerId,
      privacyPolicyUrl: "https://policies.google.com/privacy",
    }));
    expect(findUniqueCatalogedOfficialDocument("https://policies.google.com/privacy", providers)).toBeNull();
  });

  it("does not attribute from a host or similar path", () => {
    expect(findUniqueCatalogedOfficialDocument("https://vendor.example.com/legal", [{
      providerId: "dst_vendor_1234567",
      displayName: "Vendor",
      privacyPolicyUrl: "https://vendor.example.com/privacy",
    }])).toBeNull();
  });
});
