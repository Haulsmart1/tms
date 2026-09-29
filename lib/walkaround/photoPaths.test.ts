import { describe, expect, it } from "vitest";
import { MAX_PHOTOS_PER_DEFECT, photoAppendDecision, postgresTextArray } from "./photoPaths";

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
