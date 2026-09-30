import {
  describe,
  expect,
  it,
} from "vitest";

import {
  MAX_LOAD_TRANSFER_ITEMS,
  parseLoadTransferInput,
  parseLoadTransferScanInput,
  resolveLoadTransferScans,
} from "./loadTransfer";

const SOURCE =
  "11111111-1111-4111-8111-111111111111";
const DESTINATION =
  "22222222-2222-4222-8222-222222222222";
const DRIVER =
  "33333333-3333-4333-8333-333333333333";
const JOB =
  "44444444-4444-4444-8444-444444444444";
const ITEM =
  "55555555-5555-4555-8555-555555555555";

describe("parseLoadTransferInput", () => {
  it("normalizes a valid transfer", () => {
    expect(
      parseLoadTransferInput({
        sourceVehicleId: SOURCE,
        destinationVehicleId: DESTINATION,
        destinationDriverId: DRIVER,
        items: [
          {
            jobId: JOB,
            jobItemId: ITEM,
            serialNumber: " BOX-001 ",
          },
        ],
      }),
    ).toEqual({
      sourceVehicleId: SOURCE,
      destinationVehicleId: DESTINATION,
      destinationDriverId: DRIVER,
      items: [
        {
          jobId: JOB,
          jobItemId: ITEM,
          serialNumber: "BOX-001",
        },
      ],
    });
  });

  it("allows no destination driver", () => {
    expect(
      parseLoadTransferInput({
        sourceVehicleId: SOURCE,
        destinationVehicleId: DESTINATION,
        items: [
          {
            jobId: JOB,
            jobItemId: ITEM,
            serialNumber: "BOX-001",
          },
        ],
      }).destinationDriverId,
    ).toBeNull();
  });

  it("rejects identical vehicles", () => {
    expect(() =>
      parseLoadTransferInput({
        sourceVehicleId: SOURCE,
        destinationVehicleId: SOURCE,
        items: [
          {
            jobId: JOB,
            jobItemId: ITEM,
            serialNumber: "BOX-001",
          },
        ],
      }),
    ).toThrow(
      "Source and destination vehicles must differ.",
    );
  });

  it("rejects duplicate physical identities", () => {
    expect(() =>
      parseLoadTransferInput({
        sourceVehicleId: SOURCE,
        destinationVehicleId: DESTINATION,
        items: [
          {
            jobId: JOB,
            jobItemId: ITEM,
            serialNumber: "BOX-001",
          },
          {
            jobId: JOB,
            jobItemId: ITEM,
            serialNumber: "BOX-001",
          },
        ],
      }),
    ).toThrow(
      "The transfer contains a duplicate serialized item.",
    );
  });

  it("rejects an empty transfer", () => {
    expect(() =>
      parseLoadTransferInput({
        sourceVehicleId: SOURCE,
        destinationVehicleId: DESTINATION,
        items: [],
      }),
    ).toThrow(
      "A load transfer requires at least one serialized item.",
    );
  });

  it("rejects more than the batch limit", () => {
    const items = Array.from(
      {
        length:
          MAX_LOAD_TRANSFER_ITEMS + 1,
      },
      (_, index) => ({
        jobId: JOB,
        jobItemId: ITEM,
        serialNumber: `SER-${index}`,
      }),
    );

    expect(() =>
      parseLoadTransferInput({
        sourceVehicleId: SOURCE,
        destinationVehicleId: DESTINATION,
        items,
      }),
    ).toThrow(
      `A load transfer cannot contain more than ${MAX_LOAD_TRANSFER_ITEMS} serialized items.`,
    );
  });
});

describe("parseLoadTransferScanInput", () => {
  it("normalizes continuous scanner input", () => {
    expect(
      parseLoadTransferScanInput({
        sourceVehicleId: SOURCE,
        destinationVehicleId: DESTINATION,
        destinationDriverId: DRIVER,
        scannedValues: [
          " BOX-001 ",
          "BOX-002",
        ],
      }),
    ).toEqual({
      sourceVehicleId: SOURCE,
      destinationVehicleId: DESTINATION,
      destinationDriverId: DRIVER,
      scannedValues: [
        "BOX-001",
        "BOX-002",
      ],
    });
  });

  it("rejects duplicate scans", () => {
    expect(() =>
      parseLoadTransferScanInput({
        sourceVehicleId: SOURCE,
        destinationVehicleId: DESTINATION,
        scannedValues: [
          "BOX-001",
          " BOX-001 ",
        ],
      }),
    ).toThrow(
      "Duplicate scan: BOX-001.",
    );
  });
});

describe("resolveLoadTransferScans", () => {
  it("resolves serials to job/item identities", () => {
    const result =
      resolveLoadTransferScans(
        ["SER-1", "SER-2"],
        [
          {
            id: ITEM,
            job_id: JOB,
            serial_numbers: [
              "SER-1",
              "SER-2",
            ],
          },
        ],
      );

    expect(result).toEqual({
      ok: true,
      items: [
        {
          jobId: JOB,
          jobItemId: ITEM,
          serialNumber: "SER-1",
        },
        {
          jobId: JOB,
          jobItemId: ITEM,
          serialNumber: "SER-2",
        },
      ],
    });
  });

  it("rejects an unknown serial", () => {
    const result =
      resolveLoadTransferScans(
        ["MISSING"],
        [
          {
            id: ITEM,
            job_id: JOB,
            serial_numbers: ["SER-1"],
          },
        ],
      );

    expect(result).toMatchObject({
      ok: false,
      reason: "unknown",
      scannedValue: "MISSING",
    });
  });

  it("rejects ambiguous serials", () => {
    const result =
      resolveLoadTransferScans(
        ["DUP"],
        [
          {
            id: ITEM,
            job_id: JOB,
            serial_numbers: ["DUP"],
          },
          {
            id:
              "66666666-6666-4666-8666-666666666666",
            job_id:
              "77777777-7777-4777-8777-777777777777",
            serial_numbers: ["DUP"],
          },
        ],
      );

    expect(result).toMatchObject({
      ok: false,
      reason: "ambiguous",
      scannedValue: "DUP",
    });
  });

  it("does not confuse the same serial on separate items", () => {
    const result =
      resolveLoadTransferScans(
        ["DUP"],
        [
          {
            id: ITEM,
            job_id: JOB,
            serial_numbers: ["DUP"],
          },
          {
            id:
              "66666666-6666-4666-8666-666666666666",
            job_id: JOB,
            serial_numbers: ["DUP"],
          },
        ],
      );

    expect(result.ok).toBe(false);

    if (!result.ok) {
      expect(result.reason).toBe(
        "ambiguous",
      );
    }
  });
});