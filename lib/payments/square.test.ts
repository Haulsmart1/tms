import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The module caches its client, so re-import fresh for every test.
async function importFresh() {
  vi.resetModules();
  return import("./square");
}

describe("getSquare env guards", () => {
  beforeEach(() => {
    vi.stubEnv("SQUARE_ACCESS_TOKEN", "test-token");
    vi.stubEnv("SQUARE_ENVIRONMENT", "sandbox");
    vi.stubEnv("SQUARE_LOCATION_ID", "LTEST");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("throws when SQUARE_ACCESS_TOKEN is missing", async () => {
    vi.stubEnv("SQUARE_ACCESS_TOKEN", "");
    const { getSquare } = await importFresh();
    expect(() => getSquare()).toThrow(/SQUARE_ACCESS_TOKEN/);
  });

  it("throws when SQUARE_ENVIRONMENT is not sandbox or production", async () => {
    vi.stubEnv("SQUARE_ENVIRONMENT", "staging");
    const { getSquare } = await importFresh();
    expect(() => getSquare()).toThrow(/SQUARE_ENVIRONMENT/);
  });

  it("constructs a client when config is valid", async () => {
    const { getSquare } = await importFresh();
    expect(getSquare()).toBeTruthy();
  });

  it("throws from getSquareLocationId when unset", async () => {
    vi.stubEnv("SQUARE_LOCATION_ID", "");
    const { getSquareLocationId } = await importFresh();
    expect(() => getSquareLocationId()).toThrow(/SQUARE_LOCATION_ID/);
  });

  it("returns the location id when set", async () => {
    const { getSquareLocationId } = await importFresh();
    expect(getSquareLocationId()).toBe("LTEST");
  });
});
