import { describe, expect, it } from "vitest";
import {
  isCheckPhotoPath,
  MAX_PHOTOS_PER_DEFECT,
  MAX_WALKAROUND_PHOTO_BYTES,
  photoAppendDecision,
  postgresTextArray,
  validateWalkaroundPhotoBytes,
  walkaroundPhotoMimeType,
} from "./photoPaths";

describe("photoAppendDecision", () => {
  it("appends a new path under the cap", () => {
    expect(photoAppendDecision(["a"], "b")).toBe("append");
  });

  it("treats a path already recorded as done, even at the cap", () => {
    const full = ["a", "b", "c", "d", "e"];
    expect(photoAppendDecision(full, "c")).toBe("already");
  });

  it("refuses a sixth photo", () => {
    expect(MAX_PHOTOS_PER_DEFECT).toBe(5);
    expect(photoAppendDecision(["a", "b", "c", "d", "e"], "f")).toBe("full");
  });
});

describe("postgresTextArray", () => {
  it("writes an empty array", () => {
    expect(postgresTextArray([])).toBe("{}");
  });

  it("quotes every element and escapes quotes and backslashes", () => {
    expect(postgresTextArray(["t/c/d/1.jpg", 'a"b', "c\\d", "x,y"])).toBe('{"t/c/d/1.jpg","a\\"b","c\\\\d","x,y"}');
  });
});

describe("walkaroundPhotoMimeType", () => {
  it("reads the type back from the server-chosen extension", () => {
    expect(walkaroundPhotoMimeType("t/c/d/x.jpg")).toBe("image/jpeg");
    expect(walkaroundPhotoMimeType("t/c/d/x.PNG")).toBe("image/png");
    expect(walkaroundPhotoMimeType("t/c/d/x.webp")).toBe("image/webp");
    expect(walkaroundPhotoMimeType("t/c/d/x.heic")).toBe("image/heic");
  });

  it("is null for anything else", () => {
    expect(walkaroundPhotoMimeType("t/c/d/x.pdf")).toBeNull();
    expect(walkaroundPhotoMimeType("t/c/d/x")).toBeNull();
  });
});

describe("validateWalkaroundPhotoBytes (S-18)", () => {
  const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0, 0, 0, 0, 0]);
  const pdf = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31]);

  it("accepts bytes that match the declared photo type", () => {
    expect(validateWalkaroundPhotoBytes(jpeg, "image/jpeg")).toEqual({ ok: true });
  });

  it("refuses bytes that do not match", () => {
    expect(validateWalkaroundPhotoBytes(pdf, "image/jpeg").ok).toBe(false);
    expect(validateWalkaroundPhotoBytes(jpeg, "image/png").ok).toBe(false);
  });

  it("refuses non-photo types even with matching bytes", () => {
    expect(validateWalkaroundPhotoBytes(pdf, "application/pdf")).toMatchObject({ ok: false, status: 415 });
    expect(validateWalkaroundPhotoBytes(jpeg, null)).toMatchObject({ ok: false, status: 415 });
  });

  it("refuses an empty or oversized object", () => {
    expect(validateWalkaroundPhotoBytes(new Uint8Array(0), "image/jpeg")).toMatchObject({ ok: false, status: 413 });
    const big = new Uint8Array(MAX_WALKAROUND_PHOTO_BYTES + 1);
    big.set([0xff, 0xd8, 0xff]);
    expect(validateWalkaroundPhotoBytes(big, "image/jpeg")).toMatchObject({ ok: false, status: 413 });
  });
});

describe("isCheckPhotoPath (N-11)", () => {
  it("accepts a file directly in the check's own defect folder", () => {
    expect(isCheckPhotoPath("t1/c1/d1/a.jpg", "t1", "c1", "d1")).toBe(true);
  });

  it("refuses another tenant, check or defect, traversal and nested folders", () => {
    expect(isCheckPhotoPath("t2/c1/d1/a.jpg", "t1", "c1", "d1")).toBe(false);
    expect(isCheckPhotoPath("t1/c2/d1/a.jpg", "t1", "c1", "d1")).toBe(false);
    expect(isCheckPhotoPath("t1/c1/d2/a.jpg", "t1", "c1", "d1")).toBe(false);
    expect(isCheckPhotoPath("t1/c1/d1/../../c2/d9/a.jpg", "t1", "c1", "d1")).toBe(false);
    expect(isCheckPhotoPath("t1/c1/d1/x/a.jpg", "t1", "c1", "d1")).toBe(false);
    expect(isCheckPhotoPath("t1/c1/d1/", "t1", "c1", "d1")).toBe(false);
  });
});
