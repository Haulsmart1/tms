import { describe, expect, it } from "vitest";
import { jpegFilename, shouldKeepOriginal, targetImageSize } from "./imageResize";

describe("targetImageSize", () => {
  it("shrinks the long edge to 2000 and keeps the aspect ratio", () => {
    expect(targetImageSize(8160, 6120)).toEqual({ width: 2000, height: 1500, resized: true });
    expect(targetImageSize(3000, 4000)).toEqual({ width: 1500, height: 2000, resized: true });
  });

  it("leaves small images alone", () => {
    expect(targetImageSize(1600, 1200)).toEqual({ width: 1600, height: 1200, resized: false });
  });

  it("handles unusable dimensions", () => {
    expect(targetImageSize(0, 100)).toEqual({ width: 0, height: 0, resized: false });
    expect(targetImageSize(Number.NaN, 100).resized).toBe(false);
  });
});

describe("shouldKeepOriginal", () => {
  it("keeps a small JPEG that already fits", () => {
    expect(shouldKeepOriginal({ mimeType: "image/jpeg", size: 900_000, width: 1920, height: 1080 })).toBe(true);
  });

  it("re-encodes big, oversized or non-JPEG photos", () => {
    expect(shouldKeepOriginal({ mimeType: "image/jpeg", size: 9_000_000, width: 1920, height: 1080 })).toBe(false);
    expect(shouldKeepOriginal({ mimeType: "image/jpeg", size: 900_000, width: 4000, height: 3000 })).toBe(false);
    expect(shouldKeepOriginal({ mimeType: "image/png", size: 100, width: 10, height: 10 })).toBe(false);
  });
});

describe("jpegFilename", () => {
  it("swaps the extension", () => {
    expect(jpegFilename("IMG_0001.HEIC")).toBe("IMG_0001.jpg");
    expect(jpegFilename("photo")).toBe("photo.jpg");
    expect(jpegFilename("")).toBe("pod-photo.jpg");
  });
});
