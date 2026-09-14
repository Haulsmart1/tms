import { describe, expect, it } from "vitest";
import { buildAcceptanceSnapshot, hashAcceptanceSnapshot } from "./acceptanceSnapshot";

const QUOTATION = {
  currency_code: "gbp",
  subtotal: "1000.00",
  vat_total: 200,
  total: "1200.00",
  quotation_lines: [
    { id: "b", line_number: 2, description: "Fuel surcharge", quantity: 1, unit_price: "200.00", vat_rate: 20, line_total: "240.00" },
    { id: "a", line_number: 1, description: "Leeds → Gdańsk", quantity: "1.0", unit_price: 800, vat_rate: "20.00", line_total: 960 },
  ],
};

function hashOf(value: Parameters<typeof buildAcceptanceSnapshot>[0]) {
  return hashAcceptanceSnapshot(buildAcceptanceSnapshot(value));
}

describe("acceptance snapshot hash", () => {
  it("is stable across numeric formatting and line order", () => {
    const reformatted = {
      ...QUOTATION,
      currency_code: "GBP",
      subtotal: 1000,
      total: 1200,
      quotation_lines: [...QUOTATION.quotation_lines].reverse().map((line) => ({
        ...line,
        quantity: Number(line.quantity),
        unit_price: Number(line.unit_price),
      })),
    };
    expect(hashOf(reformatted)).toBe(hashOf(QUOTATION));
    expect(hashOf(QUOTATION)).toMatch(/^[0-9a-f]{64}$/);
  });

  it("changes when a price, a description, the total or the currency changes", () => {
    const base = hashOf(QUOTATION);
    const lines = QUOTATION.quotation_lines;
    expect(hashOf({ ...QUOTATION, quotation_lines: [{ ...lines[0], unit_price: "250.00" }, lines[1]] })).not.toBe(base);
    expect(hashOf({ ...QUOTATION, quotation_lines: [{ ...lines[0], description: "Other" }, lines[1]] })).not.toBe(base);
    expect(hashOf({ ...QUOTATION, total: "1800.00" })).not.toBe(base);
    expect(hashOf({ ...QUOTATION, currency_code: "EUR" })).not.toBe(base);
  });

  it("orders lines by line_number", () => {
    expect(buildAcceptanceSnapshot(QUOTATION).lines.map((line) => line.id)).toEqual(["a", "b"]);
  });
});
