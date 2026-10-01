import { describe, expect, it } from "vitest";

import { jobsInCanonicalDropOrder } from "./canonicalLaneOrder";
import type { PlanJob } from "./types";

function job(id: string): PlanJob {
  return { id } as PlanJob;
}

describe("jobsInCanonicalDropOrder", () => {
  it("preserves lane order when there is no canonical itinerary", () => {
    const jobs = [job("b"), job("a"), job("c")];

    expect(
      jobsInCanonicalDropOrder(jobs).map((value) => value.id)
    ).toEqual(["b", "a", "c"]);
  });

  it("orders job cards by their first canonical physical Drop", () => {
    const jobs = [job("late"), job("early"), job("middle")];

    expect(
      jobsInCanonicalDropOrder(jobs, {
        late: [8, 19],
        early: [1, 4],
        middle: [5, 7],
      }).map((value) => value.id)
    ).toEqual(["early", "middle", "late"]);
  });

  it("uses the earliest Drop for a multi-stop job", () => {
    const jobs = [job("other"), job("multi")];

    expect(
      jobsInCanonicalDropOrder(jobs, {
        other: [6],
        multi: [9, 2, 12],
      }).map((value) => value.id)
    ).toEqual(["multi", "other"]);
  });

  it("keeps unmapped jobs after canonical jobs without losing them", () => {
    const jobs = [
      job("unmapped-a"),
      job("drop-three"),
      job("unmapped-b"),
      job("drop-one"),
    ];

    expect(
      jobsInCanonicalDropOrder(jobs, {
        "drop-three": [3],
        "drop-one": [1],
      }).map((value) => value.id)
    ).toEqual([
      "drop-one",
      "drop-three",
      "unmapped-a",
      "unmapped-b",
    ]);
  });

  it("preserves existing lane order when first Drops tie", () => {
    const jobs = [job("a"), job("b")];

    expect(
      jobsInCanonicalDropOrder(jobs, {
        a: [1, 4],
        b: [1, 3],
      }).map((value) => value.id)
    ).toEqual(["a", "b"]);
  });

  it("does not mutate the supplied jobs array", () => {
    const jobs = [job("two"), job("one")];

    jobsInCanonicalDropOrder(jobs, {
      one: [1],
      two: [2],
    });

    expect(jobs.map((value) => value.id)).toEqual(["two", "one"]);
  });
});