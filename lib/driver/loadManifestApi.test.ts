import {
  describe,
  expect,
  it,
} from "vitest";

import {
  parseLoadManifestCreateBody,
  parseLoadManifestScanBody,
  parseManifestBarcodeToken,
} from "./loadManifest";

const VEHICLE_ID =
  "00000000-0000-4000-8000-000000000001";
const DRIVER_ID =
  "00000000-0000-4000-8000-000000000002";
const JOB_ID =
  "00000000-0000-4000-8000-000000000003";
const ITEM_ID =
  "00000000-0000-4000-8000-000000000004";
const TOKEN =
  "00000000-0000-4000-8000-000000000005";

describe("load manifest API validation", () => {
  it("parses a valid office manifest request", () => {
    expect(
      parseLoadManifestCreateBody({
        vehicleId: VEHICLE_ID,
        driverId: DRIVER_ID,
        items: [
          {
            jobId: JOB_ID,
            jobItemId: ITEM_ID,
            serialNumber: " BOX-001 ",
          },
        ],
      }),
    ).toEqual({
      vehicleId: VEHICLE_ID,
      driverId: DRIVER_ID,
      items: [
        {
          jobId: JOB_ID,
          jobItemId: ITEM_ID,
          serialNumber: "BOX-001",
        },
      ],
    });
  });

  it("rejects an empty manifest", () => {
    expect(() =>
      parseLoadManifestCreateBody({
        vehicleId: VEHICLE_ID,
        driverId: DRIVER_ID,
        items: [],
      }),
    ).toThrow(
      "A load manifest requires at least one serialized item.",
    );
  });

  it("rejects duplicate serialized units", () => {
    expect(() =>
      parseLoadManifestCreateBody({
        vehicleId: VEHICLE_ID,
        driverId: DRIVER_ID,
        items: [
          {
            jobId: JOB_ID,
            jobItemId: ITEM_ID,
            serialNumber: "BOX-001",
          },
          {
            jobId: JOB_ID,
            jobItemId: ITEM_ID,
            serialNumber: "BOX-001",
          },
        ],
      }),
    ).toThrow(
      "The manifest contains a duplicate serialized item.",
    );
  });

  it("extracts a master barcode token", () => {
    expect(
      parseManifestBarcodeToken(
        `TMSLOAD:${TOKEN}`,
      ),
    ).toBe(TOKEN);
  });

  it("rejects a normal box barcode as a manifest barcode", () => {
    expect(() =>
      parseManifestBarcodeToken("BOX-001"),
    ).toThrow(
      "A valid load manifest barcode is required.",
    );
  });

  it("parses a load scan with GPS", () => {
    expect(
      parseLoadManifestScanBody({
        barcode: `TMSLOAD:${TOKEN}`,
        action: "load",
        latitude: 52.2053,
        longitude: 0.1218,
        accuracyM: 8.5,
      }),
    ).toEqual({
      barcodeToken: TOKEN,
      action: "load",
      latitude: 52.2053,
      longitude: 0.1218,
      accuracyM: 8.5,
    });
  });

  it("allows scan GPS to be omitted", () => {
    expect(
      parseLoadManifestScanBody({
        barcode: `TMSLOAD:${TOKEN}`,
        action: "unload",
      }),
    ).toMatchObject({
      barcodeToken: TOKEN,
      action: "unload",
      latitude: null,
      longitude: null,
      accuracyM: null,
    });
  });

  it("rejects invalid scan actions", () => {
    expect(() =>
      parseLoadManifestScanBody({
        barcode: `TMSLOAD:${TOKEN}`,
        action: "delete",
      }),
    ).toThrow(
      "Manifest action must be load or unload.",
    );
  });

  it("rejects invalid GPS coordinates", () => {
    expect(() =>
      parseLoadManifestScanBody({
        barcode: `TMSLOAD:${TOKEN}`,
        action: "load",
        latitude: 91,
      }),
    ).toThrow("Invalid GPS latitude.");
  });
});
