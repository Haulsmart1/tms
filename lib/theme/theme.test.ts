import { describe, it, expect } from "vitest";
import { normalizeTheme, STORAGE_KEY } from "./theme";

describe("normalizeTheme", () => {
  it("passes through the two valid themes", () => {
    expect(normalizeTheme("dark")).toBe("dark");
    expect(normalizeTheme("light")).toBe("light");
  });

  it("falls back to dark for anything else, so a corrupted or stale storage value cannot produce a bright screen in a control room", () => {
    expect(normalizeTheme(null)).toBe("dark");
    expect(normalizeTheme("")).toBe("dark");
    expect(normalizeTheme("LIGHT")).toBe("dark");
    expect(normalizeTheme("solarized")).toBe("dark");
  });
});

describe("STORAGE_KEY", () => {
  it("is the exact key the inline script reads; changing it silently strands every existing preference", () => {
    expect(STORAGE_KEY).toBe("tms-theme");
  });
});
