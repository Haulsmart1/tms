import { describe, expect, it } from "vitest";
import {
  assertOpaqueShareReference,
  podShareReference,
  quotationShareReference,
} from "./shareReference";

describe("assertOpaqueShareReference", () => {
  it("passes an opaque reference through unchanged", () => {
    expect(assertOpaqueShareReference("quotation_share:0b1c2d3e")).toBe("quotation_share:0b1c2d3e");
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
