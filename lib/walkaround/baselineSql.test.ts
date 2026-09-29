import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { BASELINE_CATALOGUE } from "./baseline";

/*
  docs/sql/shifts_02_catalogue_seed.sql seeds the same baseline as
  lib/walkaround/baseline.ts. The app reads severity and wording from the
  database, so a drift here would silently change which defects take a vehicle
  off the road, or what the driver is told to look for.
*/
const sql = readFileSync(join(process.cwd(), "docs/sql/shifts_02_catalogue_seed.sql"), "utf8");
const TEXT = "'((?:[^']|'')*)'";
const ROW = new RegExp(
  String.raw`^\s*\('([a-z0-9_.]+)', '([a-z_]+)', ${TEXT}, ${TEXT}, '(minor|dangerous)', '(vehicle|trailer|both)', (\d+), ${TEXT}\),?$`,
  "gm",
);
const unescape = (s: string) => s.replace(/''/g, "'");

describe("baseline seed SQL", () => {
  const rows = [...sql.matchAll(ROW)].map((m) => ({
    code: m[1],
    category: m[2],
    itemLabel: unescape(m[3]),
    defectLabel: unescape(m[4]),
    severity: m[5],
    appliesTo: m[6],
    sortOrder: Number(m[7]),
    guidance: unescape(m[8]),
  }));

  it("seeds exactly the baseline codes", () => {
    expect(rows.map((r) => r.code).sort()).toEqual(BASELINE_CATALOGUE.map((e) => e.code).sort());
  });

  it("seeds the same category, wording, severity, applies-to and order for every code", () => {
    for (const e of BASELINE_CATALOGUE) {
      const row = rows.find((r) => r.code === e.code);
      expect(row, e.code).toEqual({
        code: e.code,
        category: e.category,
        itemLabel: e.itemLabel,
        defectLabel: e.defectLabel,
        severity: e.severity,
        appliesTo: e.appliesTo,
        sortOrder: e.sortOrder,
        guidance: e.guidance,
      });
    }
  });
});
