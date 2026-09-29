import { describe, expect, it } from "vitest";
import { clockIn, isoToZonedInput, zonedInputToIso } from "./zonedTime";

describe("zoned datetime-local values", () => {
  it("reads a BST wall-clock time as an hour before UTC", () => {
    expect(zonedInputToIso("2026-09-29T06:00", "Europe/London")).toBe("2026-09-29T05:00:00.000Z");
    expect(isoToZonedInput("2026-09-29T05:00:00.000Z", "Europe/London")).toBe("2026-09-29T06:00");
  });

  it("reads a GMT wall-clock time as UTC", () => {
    expect(zonedInputToIso("2026-12-01T06:00", "Europe/London")).toBe("2026-12-01T06:00:00.000Z");
  });

  it("refuses the hour the clocks skip", () => {
    expect(zonedInputToIso("2026-03-29T01:30", "Europe/London")).toBeNull();
  });

  it("refuses something that is not a date and time", () => {
    expect(zonedInputToIso("2026-09-29", "Europe/London")).toBeNull();
    expect(isoToZonedInput("not a date", "Europe/London")).toBe("");
  });

  it("formats a clock time in the operator zone", () => {
    expect(clockIn("2026-09-28T23:30:00Z", "Europe/London")).toBe("00:30");
  });
});
