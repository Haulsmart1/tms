import { describe, expect, it } from "vitest";
import { buildStopPodPatch } from "./savePod";

const now = new Date("2026-09-14T09:30:00.000Z");

describe("buildStopPodPatch", () => {
  it("always stamps pod_updated_at, the field /jobs used to skip", () => {
    expect(buildStopPodPatch({ stopType: "delivery", recipientName: " Ann ", podNotes: "", markComplete: false }, now)).toEqual({
      recipient_name: "Ann",
      pod_notes: null,
      pod_updated_at: "2026-09-14T09:30:00.000Z",
    });
  });

  it("marks a delivery delivered", () => {
    expect(buildStopPodPatch({ stopType: "delivery", recipientName: "Ann", podNotes: "Left at gate", markComplete: true }, now)).toEqual({
      recipient_name: "Ann",
      pod_notes: "Left at gate",
      pod_updated_at: "2026-09-14T09:30:00.000Z",
      status: "completed",
      pod_status: "delivered",
      delivered_at: "2026-09-14T09:30:00.000Z",
    });
  });

  it("marks a collection collected", () => {
    expect(buildStopPodPatch({ stopType: "collection", recipientName: "Bob", podNotes: "", markComplete: true }, now)).toMatchObject({
      status: "completed",
      pod_status: "collected",
      collected_at: "2026-09-14T09:30:00.000Z",
    });
  });

  it("never writes a free-text photo url", () => {
    expect(buildStopPodPatch({ stopType: "delivery", recipientName: "A", podNotes: "", markComplete: true }, now)).not.toHaveProperty("pod_photo_url");
  });
});
