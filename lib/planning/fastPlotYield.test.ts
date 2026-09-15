import { describe, expect, it } from "vitest";
import {
  createCooperativeYield,
  FastPlotCancelledError,
} from "./fastPlot";

describe("createCooperativeYield (PLAN-12)", () => {
  it("does not yield inside the time slice", async () => {
    let now = 0;
    const maybeYield = createCooperativeYield(undefined, 12, () => now);

    now = 5;
    await expect(maybeYield()).resolves.toBeUndefined();
  });

  it("yields to the event loop once the slice is used, letting queued work run", async () => {
    let now = 0;
    const maybeYield = createCooperativeYield(undefined, 12, () => now);
    let otherWorkRan = false;

    setTimeout(() => {
      otherWorkRan = true;
    }, 0);

    now = 20;
    await maybeYield();

    expect(otherWorkRan).toBe(true);
  });

  it("throws as soon as the signal is aborted", async () => {
    const controller = new AbortController();
    const maybeYield = createCooperativeYield(controller.signal);

    controller.abort();

    await expect(maybeYield()).rejects.toBeInstanceOf(FastPlotCancelledError);
  });
});
