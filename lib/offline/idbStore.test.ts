import { describe, expect, it, vi } from "vitest";
import { idbDelete, idbLoadAll, idbPut, isMemoryOnly } from "./idbStore";

describe("idbStore memory fallback", () => {
  it("reports memory-only once IndexedDB is unavailable, and still keeps items for the page", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    // vitest runs in node: no window, no indexedDB, so every call falls back.
    expect(isMemoryOnly()).toBe(false);

    await idbPut({ id: "a", seq: 1, payload: { n: 1 }, attempts: 0, serverFailures: 0, nextAttemptAt: 0, lastError: null });
    expect(isMemoryOnly()).toBe(true);

    const rows = await idbLoadAll<{ n: number }>();
    expect(rows.map((r) => r.id)).toEqual(["a"]);

    await idbDelete("a");
    expect(await idbLoadAll()).toEqual([]);
    expect(isMemoryOnly()).toBe(true);
  });
});
