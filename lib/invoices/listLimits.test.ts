import { describe, expect, it } from "vitest";
import { POSTGREST_DEFAULT_MAX_ROWS, mayBeTruncated } from "./listLimits";

describe("mayBeTruncated", () => {
  it("flags a list that reached the PostgREST row cap", () => {
    expect(mayBeTruncated(POSTGREST_DEFAULT_MAX_ROWS)).toBe(true);
    expect(mayBeTruncated(POSTGREST_DEFAULT_MAX_ROWS - 1)).toBe(false);
    expect(mayBeTruncated(0)).toBe(false);
    expect(mayBeTruncated(50, 50)).toBe(true);
  });
});
