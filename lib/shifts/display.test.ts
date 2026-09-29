import { describe, expect, it } from "vitest";
import { correctionFieldLabel, flagLabel, flagLabels } from "./display";

describe("flag labels", () => {
  it("states the long-duty fact without a legal verdict", () => {
    expect(flagLabel("over_13h")).toBe("On duty over 13h");
    expect(flagLabels(["over_13h", "over_13h", "late_sync"])).toBe("On duty over 13h, Synced late");
  });

  it("falls back to readable text for a flag it does not know", () => {
    expect(flagLabel("some_new_flag")).toBe("Some new flag");
  });

  it("never uses the words legal, compliant or infringement", () => {
    const all = ["over_13h", "open_over_16h", "odometer_decrease", "late_sync", "out_of_order", "after_office_end",
      "late_break_skipped", "driver_end_after_office", "assigned_vehicle_mismatch"].map(flagLabel).join(" ");
    expect(all).not.toMatch(/legal|compliant|infringement/i);
  });
});

describe("correctionFieldLabel", () => {
  it("names the corrected field", () => {
    expect(correctionFieldLabel("started_at")).toBe("Start time");
    expect(correctionFieldLabel("ended_at")).toBe("End time");
  });
});
