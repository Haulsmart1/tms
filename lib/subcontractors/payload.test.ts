import { describe, expect, it } from "vitest";
import {
  parseEmployeeInput,
  parseSubcontractorInput,
  parseVehicleInput,
} from "./payload";

describe("parseSubcontractorInput", () => {
  it("keeps only allowlisted columns, so tenant_id and id can never be written", () => {
    const result = parseSubcontractorInput(
      {
        name: "  Acme Haulage ",
        tenant_id: "11111111-1111-1111-1111-111111111111",
        id: "22222222-2222-2222-2222-222222222222",
        created_at: "2020-01-01",
        updated_at: "2020-01-01",
        is_admin: true,
      },
      "create",
    );
    expect(result).toEqual({ ok: true, value: { name: "Acme Haulage" } });
  });

  it("requires a name on create", () => {
    expect(parseSubcontractorInput({}, "create")).toEqual({
      ok: false,
      message: "Subcontractor name is required.",
    });
    expect(parseSubcontractorInput({ name: "   " }, "create").ok).toBe(false);
  });

  it("refuses an empty name on update but allows it to be left out", () => {
    expect(parseSubcontractorInput({ name: "" }, "update").ok).toBe(false);
    expect(parseSubcontractorInput({ active: false }, "update")).toEqual({
      ok: true,
      value: { active: false },
    });
  });

  it("refuses an update with nothing to change", () => {
    expect(parseSubcontractorInput({ tenant_id: "x" }, "update")).toEqual({
      ok: false,
      message: "No valid fields supplied.",
    });
  });

  it("refuses a body that is not an object", () => {
    expect(parseSubcontractorInput(null, "create").ok).toBe(false);
    expect(parseSubcontractorInput([], "create").ok).toBe(false);
    expect(parseSubcontractorInput("name", "create").ok).toBe(false);
  });

  it("turns blank optional text into null and trims the rest", () => {
    const result = parseSubcontractorInput(
      { name: "A", legal_name: "  ", trading_name: " Trade ", notes: null },
      "create",
    );
    expect(result).toEqual({
      ok: true,
      value: { name: "A", legal_name: null, trading_name: "Trade", notes: null },
    });
  });

  it("refuses non-string text and over-long text", () => {
    expect(parseSubcontractorInput({ name: "A", vat_number: 12 }, "create").ok).toBe(false);
    expect(parseSubcontractorInput({ name: "x".repeat(501) }, "create").ok).toBe(false);
  });

  it("only accepts the two subcontractor types", () => {
    expect(parseSubcontractorInput({ name: "A", subcontractor_type: "owner_driver" }, "create").ok).toBe(true);
    expect(parseSubcontractorInput({ name: "A", subcontractor_type: "fleet" }, "create").ok).toBe(true);
    expect(parseSubcontractorInput({ name: "A", subcontractor_type: "admin" }, "create").ok).toBe(false);
  });

  it("validates dates as YYYY-MM-DD calendar dates, blank meaning none", () => {
    expect(parseSubcontractorInput({ name: "A", goods_in_transit_expiry: "2026-12-31" }, "create")).toEqual({
      ok: true,
      value: { name: "A", goods_in_transit_expiry: "2026-12-31" },
    });
    expect(parseSubcontractorInput({ name: "A", goods_in_transit_expiry: "" }, "create")).toEqual({
      ok: true,
      value: { name: "A", goods_in_transit_expiry: null },
    });
    expect(parseSubcontractorInput({ name: "A", goods_in_transit_expiry: "2026-02-30" }, "create").ok).toBe(false);
    expect(parseSubcontractorInput({ name: "A", goods_in_transit_expiry: "31/12/2026" }, "create").ok).toBe(false);
  });

  it("accepts non-negative finite numbers, numeric strings and blank as null", () => {
    expect(
      parseSubcontractorInput(
        { name: "A", default_rate: 120.5, fuel_surcharge_percent: "4.5", cancellation_charge: "" },
        "create",
      ),
    ).toEqual({
      ok: true,
      value: { name: "A", default_rate: 120.5, fuel_surcharge_percent: 4.5, cancellation_charge: null },
    });
    expect(parseSubcontractorInput({ name: "A", default_rate: -1 }, "create").ok).toBe(false);
    expect(parseSubcontractorInput({ name: "A", default_rate: "abc" }, "create").ok).toBe(false);
    expect(parseSubcontractorInput({ name: "A", default_rate: Infinity }, "create").ok).toBe(false);
    expect(parseSubcontractorInput({ name: "A", default_rate: true }, "create").ok).toBe(false);
  });

  it("requires payment terms to be whole days within a year", () => {
    expect(parseSubcontractorInput({ name: "A", payment_terms_days: 30 }, "create").ok).toBe(true);
    expect(parseSubcontractorInput({ name: "A", payment_terms_days: 30.5 }, "create").ok).toBe(false);
    expect(parseSubcontractorInput({ name: "A", payment_terms_days: 366 }, "create").ok).toBe(false);
  });

  it("requires real booleans", () => {
    expect(parseSubcontractorInput({ name: "A", adr_capable: true, active: false }, "create").ok).toBe(true);
    expect(parseSubcontractorInput({ name: "A", active: "true" }, "create").ok).toBe(false);
  });
});

describe("parseEmployeeInput", () => {
  it("never accepts subcontractor_id or tenant_id from the body", () => {
    const result = parseEmployeeInput(
      {
        full_name: " Sam Driver ",
        subcontractor_id: "33333333-3333-3333-3333-333333333333",
        tenant_id: "11111111-1111-1111-1111-111111111111",
      },
      "create",
    );
    expect(result).toEqual({ ok: true, value: { full_name: "Sam Driver" } });
  });

  it("requires a full name on create", () => {
    expect(parseEmployeeInput({ email: "a@b.c" }, "create")).toEqual({
      ok: false,
      message: "Employee name is required.",
    });
  });

  it("defaults a blank employment type to employee", () => {
    expect(parseEmployeeInput({ full_name: "A", employment_type: " " }, "create")).toEqual({
      ok: true,
      value: { full_name: "A", employment_type: "employee" },
    });
  });

  it("validates the employment dates and flags", () => {
    expect(
      parseEmployeeInput(
        {
          full_name: "A",
          employment_start_date: "2026-01-01",
          employment_end_date: "",
          directly_employed: true,
          owner: false,
          active: true,
        },
        "create",
      ),
    ).toEqual({
      ok: true,
      value: {
        full_name: "A",
        employment_start_date: "2026-01-01",
        employment_end_date: null,
        directly_employed: true,
        owner: false,
        active: true,
      },
    });
    expect(parseEmployeeInput({ full_name: "A", owner: 1 }, "create").ok).toBe(false);
    expect(parseEmployeeInput({ full_name: "A", employment_start_date: "soon" }, "create").ok).toBe(false);
  });
});

describe("parseVehicleInput", () => {
  it("upper-cases and trims the registration and drops unknown keys", () => {
    expect(
      parseVehicleInput({ registration: " ab12 cde ", subcontractor_id: "x", tenant_id: "y" }, "create"),
    ).toEqual({ ok: true, value: { registration: "AB12 CDE" } });
  });

  it("requires a registration on create", () => {
    expect(parseVehicleInput({ make: "Volvo" }, "create")).toEqual({
      ok: false,
      message: "Vehicle registration is required.",
    });
  });

  it("validates expiry dates and flags", () => {
    expect(
      parseVehicleInput(
        { registration: "A1", mot_expiry: "2027-03-01", tax_expiry: "", vor: false, active: true },
        "create",
      ),
    ).toEqual({
      ok: true,
      value: { registration: "A1", mot_expiry: "2027-03-01", tax_expiry: null, vor: false, active: true },
    });
    expect(parseVehicleInput({ registration: "A1", vor: "no" }, "create").ok).toBe(false);
    expect(parseVehicleInput({ registration: "A1", insurance_expiry: "2027-13-01" }, "create").ok).toBe(false);
  });
});
