import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { BASELINE_CATALOGUE } from "./baseline";

/*
  docs/sql/shifts_02_catalogue_seed.sql seeds the same baseline as
  lib/walkaround/baseline.ts. The app reads severity from the database, so a
  drift here would silently change which defects take a vehicle off the road.
*/
const sql = readFileSync(join(process.cwd(), "docs/sql/shifts_02_catalogue_seed.sql"), "utf8");
const ROW = /^\s*\('([a-z0-9_.]+)', '([a-z_]+)', '(?:[^']|'')*', '(?:[^']|'')*', '(minor|dangerous)', '(vehicle|trailer|both)', (\d+), '(?:[^']|'')*'\),?$/gm;

describe("baseline seed SQL", () => {
  const rows = [...sql.matchAll(ROW)].map((m) => ({ code: m[1], category: m[2], severity: m[3], appliesTo: m[4], sortOrder: Number(m[5]) }));

  it("seeds exactly the baseline codes", () => {
    expect(rows.map((r) => r.code).sort()).toEqual(BASELINE_CATALOGUE.map((e) => e.code).sort());
  });

  it("seeds the same category, severity, applies-to and order for every code", () => {
    for (const e of BASELINE_CATALOGUE) {
      const row = rows.find((r) => r.code === e.code);
      expect(row, e.code).toEqual({ code: e.code, category: e.category, severity: e.severity, appliesTo: e.appliesTo, sortOrder: e.sortOrder });
    }
  });
});
