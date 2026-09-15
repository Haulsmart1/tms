import { describe, expect, it } from "vitest";
import { findOpenManifestConflicts, openManifestIds } from "./manifestConflicts";

describe("openManifestIds", () => {
  it("treats never-scanned and loaded manifests as open, unloaded as closed", () => {
    const events = [
      { manifest_id: "m2", event_type: "loaded", scanned_at: "2026-09-14T08:00:00Z" },
      { manifest_id: "m3", event_type: "loaded", scanned_at: "2026-09-14T08:00:00Z" },
      { manifest_id: "m3", event_type: "unloaded", scanned_at: "2026-09-14T12:00:00Z" },
    ];
    expect([...openManifestIds(["m1", "m2", "m3"], events)].sort()).toEqual(["m1", "m2"]);
  });
});

describe("findOpenManifestConflicts", () => {
  const requested = [
    { jobItemId: "i1", serialNumber: "SN1" },
    { jobItemId: "i1", serialNumber: "SN2" },
  ];

  it("reports a serial already on an open manifest", () => {
    expect(
      findOpenManifestConflicts({
        requested,
        existing: [
          { manifest_id: "m1", job_item_id: "i1", serial_number: "SN1" },
          { manifest_id: "m9", job_item_id: "i1", serial_number: "OTHER" },
        ],
        events: [],
      }),
    ).toEqual([{ jobItemId: "i1", serialNumber: "SN1" }]);
  });

  it("ignores serials on manifests that were fully unloaded", () => {
    expect(
      findOpenManifestConflicts({
        requested,
        existing: [{ manifest_id: "m1", job_item_id: "i1", serial_number: "SN2" }],
        events: [{ manifest_id: "m1", event_type: "unloaded", scanned_at: "2026-09-14T12:00:00Z" }],
      }),
    ).toEqual([]);
  });

  it("does not confuse the same serial on a different item", () => {
    expect(
      findOpenManifestConflicts({
        requested,
        existing: [{ manifest_id: "m1", job_item_id: "i2", serial_number: "SN1" }],
        events: [],
      }),
    ).toEqual([]);
  });
});
