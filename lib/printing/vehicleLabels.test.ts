import { describe, expect, it } from "vitest";
import {
  buildVehicleLabels,
  type VehicleLabelJob,
} from "./vehicleLabels";

function job(
  overrides: Partial<VehicleLabelJob> = {},
): VehicleLabelJob {
  return {
    id: "job-1",
    reference: "JOB-001",
    stops: [
      {
        id: "collection-1",
        stop_order: 1,
        type: "collection",
        address_line: "Collection Road",
        city: "Manchester",
        postcode: "M1 1AA",
      },
      {
        id: "delivery-1",
        stop_order: 2,
        type: "delivery",
        address_line: "Delivery Road",
        city: "Leeds",
        postcode: "LS1 1AA",
      },
    ],
    items: [
      {
        id: "item-1",
        sku: "SKU-1",
        description: "Box",
        quantity: 2,
        serial_numbers: ["SERIAL-1", "SERIAL-2"],
        external_reference: null,
        notes: null,
      },
    ],
    ...overrides,
  };
}

describe("buildVehicleLabels", () => {
  it("builds labels in job and serial order", () => {
    const result = buildVehicleLabels([
      job(),
      job({
        id: "job-2",
        reference: "JOB-002",
        items: [
          {
            id: "item-2",
            sku: null,
            description: null,
            quantity: 1,
            serial_numbers: ["SERIAL-3"],
            external_reference: null,
            notes: null,
          },
        ],
      }),
    ]);

    expect(result.errors).toEqual([]);
    expect(
      result.labels.map((label) => [
        label.jobReference,
        label.box.serial,
      ]),
    ).toEqual([
      ["JOB-001", "SERIAL-1"],
      ["JOB-001", "SERIAL-2"],
      ["JOB-002", "SERIAL-3"],
    ]);
  });

  it("preserves each job's addresses", () => {
    const second = job({
      id: "job-2",
      reference: "JOB-002",
      stops: [
        {
          id: "collection-2",
          stop_order: 1,
          type: "collection",
          address_line: "Second Collection",
          city: null,
          postcode: "G1 1AA",
        },
        {
          id: "delivery-2",
          stop_order: 2,
          type: "delivery",
          address_line: "Second Delivery",
          city: null,
          postcode: "EH1 1AA",
        },
      ],
      items: [
        {
          id: "item-2",
          sku: null,
          description: null,
          quantity: 1,
          serial_numbers: ["SERIAL-3"],
          external_reference: null,
          notes: null,
        },
      ],
    });

    const result = buildVehicleLabels([job(), second]);

    expect(result.labels[0].collection.address_line)
      .toBe("Collection Road");

    expect(result.labels[2].collection.address_line)
      .toBe("Second Collection");
  });

  it("reports a job with no serialized boxes", () => {
    const result = buildVehicleLabels([
      job({
        items: [],
      }),
    ]);

    expect(result.labels).toEqual([]);
    expect(result.errors).toContain(
      "JOB-001: no serialized boxes.",
    );
  });

  it("reports duplicate serials between jobs", () => {
    const result = buildVehicleLabels([
      job({
        items: [
          {
            id: "item-1",
            sku: null,
            description: null,
            quantity: 1,
            serial_numbers: ["DUPLICATE"],
            external_reference: null,
            notes: null,
          },
        ],
      }),
      job({
        id: "job-2",
        reference: "JOB-002",
        items: [
          {
            id: "item-2",
            sku: null,
            description: null,
            quantity: 1,
            serial_numbers: ["DUPLICATE"],
            external_reference: null,
            notes: null,
          },
        ],
      }),
    ]);

    expect(
      result.errors.some((error) =>
        error.includes("Barcode DUPLICATE is duplicated"),
      ),
    ).toBe(true);
  });

  it("uses explicit collection and delivery selections", () => {
    const multiStopJob = job({
      stops: [
        ...job().stops,
        {
          id: "collection-2",
          stop_order: 3,
          type: "collection",
          address_line: "Chosen Collection",
          city: null,
          postcode: "M2 2AA",
        },
        {
          id: "delivery-2",
          stop_order: 4,
          type: "delivery",
          address_line: "Chosen Delivery",
          city: null,
          postcode: "LS2 2AA",
        },
      ],
    });

    const result = buildVehicleLabels(
      [multiStopJob],
      {
        "job-1": {
          collectionId: "collection-2",
          deliveryId: "delivery-2",
        },
      },
    );

    expect(result.errors).toEqual([]);
    expect(result.labels).toHaveLength(2);
    expect(result.labels[0].collection.address_line)
      .toBe("Chosen Collection");
    expect(result.labels[0].delivery.address_line)
      .toBe("Chosen Delivery");
  });

  it("requires an unambiguous collection and delivery", () => {
    const result = buildVehicleLabels([
      job({
        stops: [
          ...job().stops,
          {
            id: "collection-2",
            stop_order: 3,
            type: "collection",
            address_line: "Other Collection",
            city: null,
            postcode: null,
          },
        ],
      }),
    ]);

    expect(result.labels).toEqual([]);
    expect(result.errors).toContain(
      "JOB-001: multiple or missing collection addresses.",
    );
  });
});
