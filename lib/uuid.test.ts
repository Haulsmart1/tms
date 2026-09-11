import { describe, it, expect } from "vitest";
import { isUuid } from "./uuid";

describe("isUuid", () => {
  it("accepts a well-formed v4-shaped uuid", () => {
    expect(isUuid("11111111-1111-1111-1111-111111111111")).toBe(true);
  });

  it("accepts uppercase", () => {
    expect(isUuid("AAAAAAAA-BBBB-CCCC-DDDD-EEEEEEEEEEEE")).toBe(true);
  });

  it("rejects the wrong length", () => {
    expect(isUuid("11111111-1111-1111-1111-11111111111")).toBe(false); // one short
    expect(isUuid("11111111-1111-1111-1111-1111111111111")).toBe(false); // one long
  });

  it("rejects missing or misplaced dashes", () => {
    expect(isUuid("111111111111111111111111111111111")).toBe(false);
    expect(isUuid("1111111-11111-1111-1111-111111111111")).toBe(false);
  });

  it("rejects non-hex characters", () => {
    expect(isUuid("gggggggg-1111-1111-1111-111111111111")).toBe(false);
  });

  it("rejects an empty string and unrelated text", () => {
    expect(isUuid("")).toBe(false);
    expect(isUuid("not-a-uuid")).toBe(false);
  });
});
