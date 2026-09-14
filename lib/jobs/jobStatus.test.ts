import { describe, expect, it } from "vitest";
import { isWorkableJobStatus, jobNotWorkableMessage } from "./jobStatus";
import { barcodeCompletionBlock } from "../driver/completionRules";
import { isOfficeCaller } from "./officeRoles";

describe("isWorkableJobStatus", () => {
  it("accepts accepted, open jobs", () => {
    for (const status of ["planned", "assigned", "in_progress", "collected", "en_route"]) {
      expect(isWorkableJobStatus(status)).toBe(true);
    }
  });

  it("refuses cancelled, unaccepted, finished and unknown jobs", () => {
    for (const status of ["cancelled", "pending_acceptance", "completed", "delivered", "weird", null, undefined]) {
      expect(isWorkableJobStatus(status)).toBe(false);
    }
  });

  it("explains the refusal", () => {
    expect(jobNotWorkableMessage("cancelled")).toMatch(/cancelled/);
    expect(jobNotWorkableMessage("pending_acceptance")).toMatch(/not been accepted/);
    expect(jobNotWorkableMessage("completed")).toMatch(/already completed/);
    expect(jobNotWorkableMessage(null)).toMatch(/not open/);
  });
});

describe("barcodeCompletionBlock", () => {
  const items = [{ id: "i1", serial_numbers: ["A", "B"] }];

  it("does not block while other deliveries are still outstanding", () => {
    expect(barcodeCompletionBlock({ items, scans: [], otherOutstandingDeliveryStops: 1 })).toBeNull();
  });

  it("blocks the final delivery until every serial is verified", () => {
    expect(
      barcodeCompletionBlock({ items, scans: [{ job_item_id: "i1", serial_number: "A" }], otherOutstandingDeliveryStops: 0 }),
    ).toBe("Scan every serialised item before completing the final delivery (1 of 2 verified).");
  });

  it("allows completion when all serials are verified or none are expected", () => {
    const scans = [
      { job_item_id: "i1", serial_number: "A" },
      { job_item_id: "i1", serial_number: "B" },
    ];
    expect(barcodeCompletionBlock({ items, scans, otherOutstandingDeliveryStops: 0 })).toBeNull();
    expect(barcodeCompletionBlock({ items: [{ id: "i2", serial_numbers: null }], scans: [], otherOutstandingDeliveryStops: 0 })).toBeNull();
  });
});

describe("isOfficeCaller", () => {
  it("lets admins through even when they also hold a driver link", () => {
    expect(isOfficeCaller({ tier: "admin", roleName: "admin", hasActiveDriverLink: true })).toBe(true);
    expect(isOfficeCaller({ tier: "super_admin", roleName: "super_admin", hasActiveDriverLink: true })).toBe(true);
  });

  it("lets office staff through", () => {
    expect(isOfficeCaller({ tier: "staff", roleName: "staff", hasActiveDriverLink: false })).toBe(true);
  });

  it("refuses driver roles and staff with an active driver link", () => {
    expect(isOfficeCaller({ tier: "staff", roleName: "driver", hasActiveDriverLink: false })).toBe(false);
    expect(isOfficeCaller({ tier: "staff", roleName: "Driver", hasActiveDriverLink: false })).toBe(false);
    expect(isOfficeCaller({ tier: "staff", roleName: "staff", hasActiveDriverLink: true })).toBe(false);
  });
});
