import { describe, expect, it } from "vitest";
import { csvCell, shiftsToCsv } from "./csv";

describe("csvCell", () => {
  it("quotes commas, quotes and newlines", () => {
    expect(csvCell("plain")).toBe("plain");
    expect(csvCell('a,"b"')).toBe('"a,""b"""');
    expect(csvCell("a\nb")).toBe('"a\nb"');
  });

  it("neutralises spreadsheet formulas", () => {
    expect(csvCell("=SUM(A1)")).toBe("'=SUM(A1)");
    expect(csvCell("+44 7700")).toBe("'+44 7700");
    expect(csvCell("-1")).toBe("'-1");
    expect(csvCell("@x")).toBe("'@x");
  });
});

describe("shiftsToCsv", () => {
  it("writes a header and one row per shift in the operator's time zone", () => {
    const csv = shiftsToCsv(
      [
        {
          driverName: "J. Smith",
          startedAt: "2026-09-29T04:48:00Z",
          endedAt: "2026-09-29T14:00:00Z",
          vehicles: ["AB12 CDE", "FG34 HIJ"],
          summary: { dutyMinutes: 552, breakMinutes: 45, workedMinutes: 507, mileage: 292, flags: [] },
          corrected: true,
        },
      ],
      "Europe/London",
    );
    const lines = csv.trim().split("\r\n");
    expect(lines[0]).toBe("Driver,Date,Start,End,Vehicles,Duty,Breaks,Worked (excl. breaks),Mileage,Flags,Corrected by office");
    expect(lines[1]).toBe("J. Smith,2026-09-29,05:48,15:00,AB12 CDE; FG34 HIJ,9:12,0:45,8:27,292,,yes");
  });

  it("leaves end and mileage empty for an open shift", () => {
    const csv = shiftsToCsv(
      [{ driverName: "K", startedAt: "2026-09-29T04:00:00Z", endedAt: null, vehicles: [], summary: { dutyMinutes: 60, breakMinutes: 0, workedMinutes: 60, mileage: null, flags: ["over_13h"] }, corrected: false }],
      "Europe/London",
    );
    expect(csv.trim().split("\r\n")[1]).toBe("K,2026-09-29,05:00,,,1:00,0:00,1:00,,over_13h,no");
  });
});
