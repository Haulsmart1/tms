import { describe, expect, it } from "vitest";
import { defaultMechanical, formatLabel, formFromAsset, type Asset } from "./types";

describe("formatLabel", () => {
  it("title-cases and replaces underscores", () => {
    expect(formatLabel("serial_number")).toBe("Serial Number");
    expect(formatLabel("vrm")).toBe("Vrm");
    expect(formatLabel("active")).toBe("Active");
  });
});

const full: Asset = {
  id: "a",
  company_id: "c",
  tenant_id: "t",
  name: "Trailer 12",
  asset_type: "Trailer",
  asset_type_id: "type-trailer",
  asset_number: "TRL-012",
  identifier_type: "vrm",
  reference: null,
  serial_number: "SN-1",
  registration: "AB12 CDE",
  barcode: "B-1",
  mechanical: true,
  status: "maintenance",
  notes: "Spare",
  created_at: null,
};

describe("formFromAsset", () => {
  it("maps every field", () => {
    expect(formFromAsset(full)).toEqual({
      name: "Trailer 12",
      assetNumber: "TRL-012",
      identifierType: "vrm",
      assetTypeId: "type-trailer",
      serialNumber: "SN-1",
      barcode: "B-1",
      mechanical: true,
      status: "maintenance",
      notes: "Spare",
    });
  });

  it("falls back for null fields", () => {
    const form = formFromAsset({
      ...full,
      asset_type_id: null,
      asset_number: null,
      identifier_type: null,
      serial_number: null,
      barcode: null,
      mechanical: false,
      status: null,
      notes: null,
    });
    expect(form).toEqual({
      name: "Trailer 12",
      assetNumber: "",
      identifierType: "internal",
      assetTypeId: "",
      serialNumber: "",
      barcode: "",
      mechanical: false,
      status: "active",
      notes: "",
    });
  });
});

describe("defaultMechanical", () => {
  it("ticks mechanical for machinery types only", () => {
    expect(defaultMechanical("Trailer")).toBe(true);
    expect(defaultMechanical("Pallet")).toBe(false);
  });
});
