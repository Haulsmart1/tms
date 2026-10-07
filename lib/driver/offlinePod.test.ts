import { describe, expect, it } from "vitest";
import { checkQueuedCompletion, checkQueuedScan } from "./offlinePod";

const items = [
  { id: "i1", serial_numbers: ["SN1", "SN2"] },
  { id: "i2", serial_numbers: null },
];

describe("checkQueuedScan", () => {
  it("matches a known serial to its item", () => {
    expect(checkQueuedScan({ items, verified: [], value: "SN1" })).toEqual({ ok: true, jobItemId: "i1", serialNumber: "SN1", scanFormat: null });
  });

  it("normalizes the scan format the way the scans route does", () => {
    expect(checkQueuedScan({ items, verified: [], value: "SN1", scanFormat: " code_128 " })).toEqual({
      ok: true,
      jobItemId: "i1",
      serialNumber: "SN1",
      scanFormat: "code_128",
    });
    expect(checkQueuedScan({ items, verified: [], value: "SN1", scanFormat: "" })).toMatchObject({ ok: true, scanFormat: null });
  });

  it("refuses a format the scans route would refuse", () => {
    expect(checkQueuedScan({ items, verified: [], value: "SN1", scanFormat: "x".repeat(81) })).toEqual({
      ok: false,
      duplicate: false,
      message: "Invalid barcode format.",
    });
    expect(checkQueuedScan({ items, verified: [], value: "SN1", scanFormat: "a\u0000b" })).toMatchObject({ ok: false, duplicate: false });
  });

  it("refuses an unknown serial with the server's wording", () => {
    const result = checkQueuedScan({ items, verified: [], value: "NOPE" });
    expect(result).toEqual({ ok: false, duplicate: false, message: "This barcode or serial number is not expected on this job." });
  });

  it("says when the serial is already verified or queued", () => {
    const result = checkQueuedScan({ items, verified: [{ job_item_id: "i1", serial_number: "SN1" }], value: "SN1" });
    expect(result).toEqual({ ok: false, duplicate: true, message: "This item has already been verified on this job." });
  });
});

describe("checkQueuedCompletion", () => {
  const base = {
    recipientName: "Pat",
    podNotes: "",
    evidenceCount: 1,
    legacyPhotoUrl: null,
    items,
    verified: [
      { job_item_id: "i1", serial_number: "SN1" },
      { job_item_id: "i1", serial_number: "SN2" },
    ],
    otherOutstandingDeliveryStops: 0,
  };

  it("passes a complete delivery", () => {
    expect(checkQueuedCompletion(base)).toEqual({ ok: true });
  });

  it("needs a recipient name", () => {
    expect(checkQueuedCompletion({ ...base, recipientName: "  " })).toEqual({ ok: false, message: "Recipient name is required." });
  });

  it("needs evidence", () => {
    const result = checkQueuedCompletion({ ...base, evidenceCount: 0 });
    expect(result.ok).toBe(false);
  });

  it("needs every serial before the final delivery only", () => {
    const partial = { ...base, verified: [{ job_item_id: "i1", serial_number: "SN1" }] };
    expect(checkQueuedCompletion(partial).ok).toBe(false);
    expect(checkQueuedCompletion({ ...partial, otherOutstandingDeliveryStops: 1 })).toEqual({ ok: true });
  });
});
