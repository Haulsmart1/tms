import { describe, expect, it } from "vitest";
import { buildAssetPayload, validateAssetForm } from "./payload";
import { EMPTY_ASSET_FORM, type AssetFormValues, type AssetType } from "./types";

const trailer: AssetType = { id: "type-trailer", name: "Trailer" };
const types = [trailer];

const base: AssetFormValues = {
  ...EMPTY_ASSET_FORM,
  name: " Trailer 12 ",
  assetNumber: " TRL-012 ",
  assetTypeId: "type-trailer",
};

describe("validateAssetForm", () => {
  it("accepts a complete form and returns the chosen type", () => {
    expect(validateAssetForm(base, types)).toEqual({ ok: true, type: trailer });
  });

  it.each([
    [{ name: "   " }, "Asset name is required."],
    [{ assetNumber: "" }, "Asset number is required."],
    [{ assetTypeId: "" }, "Select an asset type."],
    [{ assetTypeId: "type-gone" }, "The selected asset type is invalid."],
  ])("refuses %j", (patch, error) => {
    expect(validateAssetForm({ ...base, ...patch }, types)).toEqual({ ok: false, error });
  });
});

describe("buildAssetPayload", () => {
  it("trims, stores the type name and uses the number as the reference for internal ids", () => {
    expect(buildAssetPayload(base, trailer)).toEqual({
      name: "Trailer 12",
      asset_number: "TRL-012",
      identifier_type: "internal",
      asset_type_id: "type-trailer",
      asset_type: "Trailer",
      reference: "TRL-012",
      registration: null,
      serial_number: null,
      barcode: null,
      mechanical: false,
      status: "active",
      notes: null,
    });
  });

  it("upper-cases a VRM into registration and sets no reference", () => {
    const payload = buildAssetPayload(
      { ...base, identifierType: "vrm", assetNumber: " ab12 cde " },
      trailer,
    );
    expect(payload.registration).toBe("AB12 CDE");
    expect(payload.reference).toBeNull();
  });

  it("falls back to the asset number for an empty serial when the identifier is a serial", () => {
    const payload = buildAssetPayload({ ...base, identifierType: "serial_number" }, trailer);
    expect(payload.serial_number).toBe("TRL-012");
  });

  it("keeps an explicit serial number", () => {
    const payload = buildAssetPayload(
      { ...base, identifierType: "serial_number", serialNumber: " SN-1 " },
      trailer,
    );
    expect(payload.serial_number).toBe("SN-1");
  });

  it("falls back to the asset number for an empty barcode when the identifier is a barcode", () => {
    const payload = buildAssetPayload({ ...base, identifierType: "barcode" }, trailer);
    expect(payload.barcode).toBe("TRL-012");
  });

  it("stores trimmed notes, or null when blank", () => {
    expect(buildAssetPayload({ ...base, notes: "  Spare  " }, trailer).notes).toBe("Spare");
    expect(buildAssetPayload({ ...base, notes: "   " }, trailer).notes).toBeNull();
  });

  it("keeps an explicit barcode when the identifier is internal", () => {
    expect(buildAssetPayload({ ...base, barcode: " B1 " }, trailer).barcode).toBe("B1");
  });

  it.each(["trailer_number", "container_number", "pallet_number"])(
    "uses the number as the reference for %s",
    (identifierType) => {
      expect(buildAssetPayload({ ...base, identifierType }, trailer).reference).toBe("TRL-012");
    },
  );

  it.each(["barcode", "serial_number", "vrm"])("sets no reference for %s", (identifierType) => {
    expect(buildAssetPayload({ ...base, identifierType }, trailer).reference).toBeNull();
  });
});
