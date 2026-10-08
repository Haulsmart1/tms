import { describe, expect, it } from "vitest";
import { serialOverlapLiteral } from "./serialFilter";

describe("serialOverlapLiteral", () => {
  it("quotes plain serials", () => {
    expect(serialOverlapLiteral(["SN-1", "SN-2"])).toBe('{"SN-1","SN-2"}');
  });

  it("keeps a comma inside one element instead of splitting it", () => {
    expect(serialOverlapLiteral(["A,B"])).toBe('{"A,B"}');
  });

  it("escapes quotes and backslashes", () => {
    expect(serialOverlapLiteral(['a"b', "c\\d"])).toBe('{"a\\"b","c\\\\d"}');
  });

  it("leaves braces and spaces inert inside the quotes", () => {
    expect(serialOverlapLiteral(["{x}", " y "])).toBe('{"{x}"," y "}');
  });

  it("quotes the word NULL so it stays a string", () => {
    expect(serialOverlapLiteral(["NULL"])).toBe('{"NULL"}');
  });

  it("writes an empty array", () => {
    expect(serialOverlapLiteral([])).toBe("{}");
  });
});
