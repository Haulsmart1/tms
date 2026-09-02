import { describe, expect, it } from "vitest";
import { assignJobsToLane, moveJobInLane } from "./boardActions";

describe("assignJobsToLane", () => {
  it("appends selected jobs to the target lane in selection order", () => {
    expect(
      assignJobsToLane(
        {
          van1: ["a"],
          van2: ["b"],
        },
        ["c", "d"],
        "van1"
      )
    ).toEqual({
      van1: ["a", "c", "d"],
      van2: ["b"],
    });
  });

  it("moves jobs without leaving duplicates in another lane", () => {
    expect(
      assignJobsToLane(
        {
          van1: ["a", "b"],
          van2: ["c"],
        },
        ["b", "c", "c"],
        "van2"
      )
    ).toEqual({
      van1: ["a"],
      van2: ["b", "c"],
    });
  });
});

describe("moveJobInLane", () => {
  it("moves a job up one drop position", () => {
    expect(
      moveJobInLane(
        { van1: ["a", "b", "c"] },
        "van1",
        "b",
        -1
      )
    ).toEqual({
      van1: ["b", "a", "c"],
    });
  });

  it("moves a job down one drop position", () => {
    expect(
      moveJobInLane(
        { van1: ["a", "b", "c"] },
        "van1",
        "b",
        1
      )
    ).toEqual({
      van1: ["a", "c", "b"],
    });
  });

  it("does not move beyond lane boundaries", () => {
    const lanes = { van1: ["a", "b"] };

    expect(moveJobInLane(lanes, "van1", "a", -1)).toBe(lanes);
    expect(moveJobInLane(lanes, "van1", "b", 1)).toBe(lanes);
  });
});
