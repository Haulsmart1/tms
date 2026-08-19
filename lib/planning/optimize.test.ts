import { describe, expect, it } from "vitest";
import { bestOrder, pathSeconds } from "./optimize";

describe("pathSeconds", () => {
  it("sums consecutive hops", () => {
    const m = [
      [0, 10, 99],
      [99, 0, 20],
      [99, 99, 0],
    ];
    expect(pathSeconds([0, 1, 2], m)).toBe(30);
  });

  it("is 0 for a single job", () => {
    expect(pathSeconds([0], [[0]])).toBe(0);
  });
});

describe("bestOrder", () => {
  it("handles the empty and single-job cases", () => {
    expect(bestOrder([])).toEqual([]);
    expect(bestOrder([[0]])).toEqual([0]);
  });

  it("picks the cheaper direction for two jobs (asymmetric matrix)", () => {
    // 0 -> 1 costs 100, 1 -> 0 costs 10: the best open path is [1, 0].
    const m = [
      [0, 100],
      [10, 0],
    ];
    expect(bestOrder(m)).toEqual([1, 0]);
  });

  it("finds the exact best order for a small matrix", () => {
    // Best open path is 2 -> 0 -> 1 with cost 1 + 1 = 2.
    const m = [
      [0, 1, 50],
      [50, 0, 50],
      [1, 50, 0],
    ];
    expect(bestOrder(m)).toEqual([2, 0, 1]);
  });

  it("visits every job exactly once, even above the exhaustive limit", () => {
    // 10 jobs in a line: cost i -> j is |i - j| * 60. Any correct solver
    // returns a permutation; the line shape means the best is one end to the
    // other, so the heuristic path must also cost exactly 9 * 60.
    const n = 10;
    const m = Array.from({ length: n }, (_, i) =>
      Array.from({ length: n }, (_, j) => Math.abs(i - j) * 60)
    );
    const order = bestOrder(m);
    expect([...order].sort((a, b) => a - b)).toEqual(Array.from({ length: n }, (_, i) => i));
    expect(pathSeconds(order, m)).toBe((n - 1) * 60);
  });

  it("actually optimizes above the exhaustive limit (identity order is not optimal)", () => {
    // The same 10-jobs-on-a-line shape, but with the labels scrambled: job i
    // sits at position p[i], so the identity order zig-zags (cost 49 * 60)
    // while the true best path sweeps the line end to end (cost 9 * 60).
    // A solver that skipped the heuristic and returned the input order would
    // fail this loudly.
    const p = [5, 2, 8, 0, 9, 1, 6, 3, 7, 4];
    const n = p.length;
    const m = Array.from({ length: n }, (_, i) =>
      Array.from({ length: n }, (_, j) => Math.abs(p[i] - p[j]) * 60)
    );
    const order = bestOrder(m);
    expect([...order].sort((a, b) => a - b)).toEqual(Array.from({ length: n }, (_, i) => i));
    expect(pathSeconds(order, m)).toBe((n - 1) * 60);
  });
});
