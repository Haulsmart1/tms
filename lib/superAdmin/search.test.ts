import { describe, it, expect } from "vitest";
import { matchesSearch, filterBySearch } from "./search";

describe("matchesSearch", () => {
  it("returns true for an empty query", () => {
    expect(matchesSearch("", ["Acme Haulage"])).toBe(true);
    expect(matchesSearch("   ", ["Acme Haulage"])).toBe(true);
  });

  it("matches case-insensitively", () => {
    expect(matchesSearch("acme", ["Acme Haulage"])).toBe(true);
    expect(matchesSearch("ACME", ["Acme Haulage"])).toBe(true);
  });

  it("requires every term to match, across different fields", () => {
    // The point of the module. "acme past" should find the past-due Acme,
    // even though no single field contains both words.
    expect(matchesSearch("acme past", ["Acme Haulage", "past_due"])).toBe(true);
    expect(matchesSearch("acme active", ["Acme Haulage", "past_due"])).toBe(false);
  });

  it("ignores null and undefined fields", () => {
    expect(matchesSearch("acme", [null, undefined, "Acme Haulage"])).toBe(true);
    expect(matchesSearch("acme", [null, undefined])).toBe(false);
  });

  it("collapses extra whitespace between terms", () => {
    expect(matchesSearch("  acme   past ", ["Acme Haulage", "past_due"])).toBe(true);
  });
});

describe("filterBySearch", () => {
  type Row = { name: string; status: string | null };
  const rows: Row[] = [
    { name: "Acme Haulage", status: "past_due" },
    { name: "Bravo Logistics", status: "active" },
  ];
  const fieldsOf = (row: Row) => [row.name, row.status];

  it("returns every row for an empty query", () => {
    expect(filterBySearch("", rows, fieldsOf)).toHaveLength(2);
  });

  it("returns only matching rows", () => {
    expect(filterBySearch("bravo", rows, fieldsOf)).toEqual([rows[1]]);
  });

  it("returns an empty array when nothing matches", () => {
    expect(filterBySearch("zzz", rows, fieldsOf)).toEqual([]);
  });

  it("does not match a field the caller did not declare", () => {
    // Searchable fields are declared explicitly, never derived by
    // stringifying the row, so a hidden field can never produce a
    // match the operator cannot see the reason for.
    const onlyName = (row: Row) => [row.name];
    expect(filterBySearch("past", rows, onlyName)).toEqual([]);
  });
});
