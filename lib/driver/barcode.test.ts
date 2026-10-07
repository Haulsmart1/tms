
import { describe, expect, it } from "vitest";

import {
  barcodeProgress,
  expectedSerialsForItem,
  findExpectedSerial,
  normalizeScanFormat,
  normalizeScannedSerial,
} from "./barcode";

describe("driver barcode verification", () => {
  it("trims a scanned serial without changing case", () => {
    expect(
      normalizeScannedSerial("  AbC-123  "),
    ).toEqual({
      ok: true,
      value: "AbC-123",
    });
  });

  it("rejects an empty scanned value", () => {
    expect(
      normalizeScannedSerial("   "),
    ).toEqual({
      ok: false,
      message:
        "A barcode or serial number is required.",
    });
  });

  it("rejects control characters", () => {
    expect(
      normalizeScannedSerial("ABC\n123"),
    ).toEqual({
      ok: false,
      message:
        "The scanned value contains unsupported characters.",
    });
  });

  it("deduplicates repeated expected serials on one item", () => {
    expect(
      expectedSerialsForItem({
        id: "item-1",
        serial_numbers: [
          "SER-1",
          " SER-1 ",
          "SER-2",
        ],
      }),
    ).toEqual([
      "SER-1",
      "SER-2",
    ]);
  });

  it("matches an expected serial to its item", () => {
    expect(
      findExpectedSerial(
        [
          {
            id: "item-1",
            serial_numbers: [
              "SER-001",
              "SER-002",
            ],
          },
          {
            id: "item-2",
            serial_numbers: ["SER-003"],
          },
        ],
        "SER-003",
      ),
    ).toEqual({
      ok: true,
      itemId: "item-2",
      serialNumber: "SER-003",
    });
  });

  it("uses case-sensitive serial matching", () => {
    expect(
      findExpectedSerial(
        [
          {
            id: "item-1",
            serial_numbers: ["AbC123"],
          },
        ],
        "ABC123",
      ),
    ).toEqual({
      ok: false,
      reason: "unknown",
      message:
        "This barcode or serial number is not expected on this job.",
    });
  });

  it("rejects an unknown serial", () => {
    expect(
      findExpectedSerial(
        [
          {
            id: "item-1",
            serial_numbers: ["SER-001"],
          },
        ],
        "SER-999",
      ),
    ).toEqual({
      ok: false,
      reason: "unknown",
      message:
        "This barcode or serial number is not expected on this job.",
    });
  });

  it("rejects an ambiguous serial attached to two items", () => {
    expect(
      findExpectedSerial(
        [
          {
            id: "item-1",
            serial_numbers: ["DUPLICATE"],
          },
          {
            id: "item-2",
            serial_numbers: ["DUPLICATE"],
          },
        ],
        "DUPLICATE",
      ),
    ).toEqual({
      ok: false,
      reason: "ambiguous",
      message:
        "This serial number is attached to more than one item on this job. Ask the office to correct the job data.",
    });
  });

  it("calculates job-wide verification progress across stops", () => {
    expect(
      barcodeProgress(
        [
          {
            id: "item-1",
            serial_numbers: [
              "SER-1",
              "SER-2",
            ],
          },
          {
            id: "item-2",
            serial_numbers: ["SER-3"],
          },
        ],
        [
          {
            job_item_id: "item-1",
            serial_number: "SER-1",
            stop_id: "stop-1",
          },
          {
            job_item_id: "item-2",
            serial_number: "SER-3",
            stop_id: "stop-2",
          },
        ],
      ),
    ).toEqual({
      expected: 3,
      verified: 2,
      remaining: 1,
    });
  });

  it("does not count duplicate scan rows twice", () => {
    expect(
      barcodeProgress(
        [
          {
            id: "item-1",
            serial_numbers: ["SER-1"],
          },
        ],
        [
          {
            job_item_id: "item-1",
            serial_number: "SER-1",
            stop_id: "stop-1",
          },
          {
            job_item_id: "item-1",
            serial_number: "SER-1",
            stop_id: "stop-1",
          },
        ],
      ),
    ).toEqual({
      expected: 1,
      verified: 1,
      remaining: 0,
    });
  });

  it("counts a serial only once when scan rows exist at different stops", () => {
    expect(
      barcodeProgress(
        [
          {
            id: "item-1",
            serial_numbers: ["SER-1"],
          },
        ],
        [
          {
            job_item_id: "item-1",
            serial_number: "SER-1",
            stop_id: "stop-1",
          },
          {
            job_item_id: "item-1",
            serial_number: "SER-1",
            stop_id: "stop-2",
          },
        ],
      ),
    ).toEqual({
      expected: 1,
      verified: 1,
      remaining: 0,
    });
  });
});

describe("normalizeScanFormat", () => {
  it("treats a missing or empty format as none", () => {
    expect(normalizeScanFormat(undefined)).toEqual({ ok: true, value: null });
    expect(normalizeScanFormat(null)).toEqual({ ok: true, value: null });
    expect(normalizeScanFormat("")).toEqual({ ok: true, value: null });
  });

  it("trims a format", () => {
    expect(normalizeScanFormat("  code_128 ")).toEqual({ ok: true, value: "code_128" });
    expect(normalizeScanFormat("x".repeat(80))).toEqual({ ok: true, value: "x".repeat(80) });
  });

  it("refuses a non-string, blank, over-long or control-character format", () => {
    const invalid = { ok: false, message: "Invalid barcode format." };
    expect(normalizeScanFormat(7)).toEqual(invalid);
    expect(normalizeScanFormat("   ")).toEqual(invalid);
    expect(normalizeScanFormat("x".repeat(81))).toEqual(invalid);
    expect(normalizeScanFormat("qr\u0007")).toEqual(invalid);
    expect(normalizeScanFormat("qr\u007fcode")).toEqual(invalid);
  });
});
