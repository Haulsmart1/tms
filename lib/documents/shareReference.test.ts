import { describe, expect, it } from "vitest";
import {
  assertOpaqueShareReference,
  podShareReference,
  quotationShareReference,
  trackingShareReference,
} from "./shareReference";

describe("assertOpaqueShareReference", () => {
  it("passes an opaque reference through unchanged", () => {
    expect(assertOpaqueShareReference("quotation_share:5d7e0d1a-2b3c-4d5e-8f90-1a2b3c4d5e6f")).toBe("quotation_share:5d7e0d1a-2b3c-4d5e-8f90-1a2b3c4d5e6f");
    expect(assertOpaqueShareReference(null)).toBeNull();
    expect(assertOpaqueShareReference(undefined)).toBeNull();
  });

  it("refuses a full share URL, which carries the live bearer token", () => {
    expect(() =>
      assertOpaqueShareReference("https://tmswizard.cloud/pod/share/pod_abc123"),
    ).toThrow(/share URL/);
    expect(() =>
      assertOpaqueShareReference("https://tmswizard.cloud/quotation/share/eyJ.abc"),
    ).toThrow(/share URL/);
  });

  it("refuses anything that still looks like a share path or a raw token", () => {
    expect(() => assertOpaqueShareReference("/pod/share/pod_abc")).toThrow(/share URL/);
    expect(() => assertOpaqueShareReference("pod_" + "a".repeat(43))).toThrow(/share URL/);
  });
});

describe("reference builders", () => {
  it("names the POD link by its stored hash, never the token", () => {
    const hash = "c".repeat(64);
    expect(podShareReference(hash)).toBe(`pod_share:${hash}`);
    expect(() => podShareReference("pod_" + "a".repeat(43))).toThrow(/hash/);
  });

  it("names the quotation link by its row id", () => {
    const id = "5d7e0d1a-2b3c-4d5e-8f90-1a2b3c4d5e6f";
    expect(quotationShareReference(id)).toBe(`quotation_share:${id}`);
    expect(() => quotationShareReference("not-a-uuid")).toThrow(/uuid/);
  });
});

describe("tracking share references", () => {
  it("builds a reference from the stored hash", () => {
    const hash = "a".repeat(64);
    expect(trackingShareReference(hash)).toBe(`tracking_share:${hash}`);
    expect(assertOpaqueShareReference(trackingShareReference(hash))).toBe(`tracking_share:${hash}`);
  });

  it("refuses anything that is not a hash", () => {
    expect(() => trackingShareReference("trk_abc")).toThrow();
  });

  it("refuses a raw tracking token or a tracking URL", () => {
    expect(() => assertOpaqueShareReference(`trk_${"A".repeat(43)}`)).toThrow();
    expect(() => assertOpaqueShareReference("/track/abc")).toThrow();
  });
});

describe("assertOpaqueShareReference allowlist", () => {
  it("refuses a token embedded mid-string and any unknown shape", () => {
    expect(() => assertOpaqueShareReference(`note ${"pod_" + "a".repeat(43)} here`)).toThrow();
    expect(() => assertOpaqueShareReference(`tracking_share:${"a".repeat(64)}:trk_${"A".repeat(43)}`)).toThrow();
    expect(() => assertOpaqueShareReference("something_else:abc")).toThrow();
    expect(() => assertOpaqueShareReference("")).toThrow();
  });

  it("refuses an uppercase hash, since stored hashes are lowercase hex", () => {
    expect(() => assertOpaqueShareReference(`pod_share:${"A".repeat(64)}`)).toThrow();
    expect(() => trackingShareReference("A".repeat(64))).toThrow();
  });
});
