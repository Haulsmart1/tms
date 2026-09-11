import {
  describe,
  expect,
  it,
} from "vitest";
import {
  activitySourceLabel,
  validateManualActivityRange,
} from "./manualActivity";

describe("validateManualActivityRange", () => {
  it("accepts a positive activity range", () => {
    expect(
      validateManualActivityRange(
        new Date("2026-09-11T07:00:00Z"),
        new Date("2026-09-11T08:00:00Z")
      )
    ).toBeNull();
  });

  it("rejects zero or negative duration", () => {
    expect(
      validateManualActivityRange(
        new Date("2026-09-11T08:00:00Z"),
        new Date("2026-09-11T08:00:00Z")
      )
    ).toMatch(/after/i);
  });
});

describe("activitySourceLabel", () => {
  it("keeps manual activity visibly manual", () => {
    expect(activitySourceLabel("manual", null))
      .toBe("Manual");
  });

  it("identifies API provenance", () => {
    expect(
      activitySourceLabel("tachograph_api", "demo")
    ).toBe("Tacho API ? demo");
  });
});
