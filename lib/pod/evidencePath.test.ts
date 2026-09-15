import { describe, expect, it } from "vitest";
import { buildPodEvidencePath, isPodEvidencePathFor, sanitizePodFilename } from "./evidencePath";

const T = "11111111-1111-4111-8111-111111111111";
const J = "22222222-2222-4222-8222-222222222222";
const S = "33333333-3333-4333-8333-333333333333";
const OTHER = "44444444-4444-4444-8444-444444444444";
const owner = { tenantId: T, jobId: J, stopId: S };

describe("sanitizePodFilename", () => {
  it("keeps safe characters and replaces the rest", () => {
    expect(sanitizePodFilename("Łódź photo (1).jpg")).toBe("__d__photo__1_.jpg");
  });

  it("never yields a dot-leading or empty name", () => {
    expect(sanitizePodFilename("..")).toBe("_");
    expect(sanitizePodFilename(".env")).toBe("_env");
    expect(sanitizePodFilename("")).toBe("pod-file");
    expect(sanitizePodFilename(null, "x")).toBe("x");
  });
});

describe("buildPodEvidencePath", () => {
  it("builds a path the ownership check accepts", () => {
    const path = buildPodEvidencePath({ ...owner, folder: "photos", filename: "a b.jpg", timestamp: 1700, random: "abc-123" });
    expect(path).toBe(`${T}/${J}/${S}/photos/1700-abc-123-a_b.jpg`);
    expect(isPodEvidencePathFor(path, owner)).toBe(true);
  });

  it("refuses non-uuid owners", () => {
    expect(() =>
      buildPodEvidencePath({ tenantId: "../x", jobId: J, stopId: S, folder: "photos", filename: "a", timestamp: 1, random: "r" }),
    ).toThrow();
  });
});

describe("isPodEvidencePathFor", () => {
  it("accepts documents too", () => {
    expect(isPodEvidencePathFor(`${T}/${J}/${S}/documents/1-r-file.pdf`, owner)).toBe(true);
  });

  it("rejects another tenant, job or stop", () => {
    expect(isPodEvidencePathFor(`${OTHER}/${J}/${S}/photos/f.jpg`, owner)).toBe(false);
    expect(isPodEvidencePathFor(`${T}/${OTHER}/${S}/photos/f.jpg`, owner)).toBe(false);
    expect(isPodEvidencePathFor(`${T}/${J}/${OTHER}/photos/f.jpg`, owner)).toBe(false);
  });

  it("rejects traversal, extra depth and odd folders", () => {
    expect(isPodEvidencePathFor(`${T}/${J}/${S}/photos/../../../${OTHER}/x.jpg`, owner)).toBe(false);
    expect(isPodEvidencePathFor(`${T}/${J}/${S}/photos/sub/x.jpg`, owner)).toBe(false);
    expect(isPodEvidencePathFor(`${T}/${J}/${S}/secrets/x.jpg`, owner)).toBe(false);
    expect(isPodEvidencePathFor(`/${T}/${J}/${S}/photos/x.jpg`, owner)).toBe(false);
    expect(isPodEvidencePathFor(`${T}/${J}/${S}/photos/`, owner)).toBe(false);
    expect(isPodEvidencePathFor(`${T}\\${J}/${S}/photos/x.jpg`, owner)).toBe(false);
    expect(isPodEvidencePathFor(null, owner)).toBe(false);
  });

  it("rejects when the owner ids themselves are malformed", () => {
    expect(isPodEvidencePathFor("a/b/c/photos/x.jpg", { tenantId: "a", jobId: "b", stopId: "c" })).toBe(false);
  });
});
