import { describe, expect, it } from "vitest";
import type { DriverEvent } from "../shifts/events";
import {
  defectClientIdsOf,
  eventOutcome,
  orphanedPhotoIds,
  pendingEvents,
  photoOutcome,
  PHOTO_UNMATCHED_AFTER,
  SIGN_IN_AGAIN_MESSAGE,
  type DriverQueuePayload,
} from "./driverSync";
import { applyOutcome, enqueue, MAX_SERVER_FAILURES, type QueueItem } from "./queue";

const check: DriverEvent = {
  type: "check_submitted",
  clientId: "c1",
  occurredAt: "2026-09-29T05:40:00Z",
  phase: "start",
  shiftClientId: null,
  vehicleId: "v1",
  confirmation: "registration",
  qrPayload: null,
  typedRegistration: "AB12CDE",
  mismatchReason: null,
  odometer: 1000,
  previousEndOdometer: null,
  declarationAccepted: true,
  checklistItemIds: ["i1"],
  defects: [
    { clientId: "d1", catalogueItemId: "i1", driverSeverity: null, note: null },
    { clientId: "d2", catalogueItemId: null, driverSeverity: "dangerous", note: "Cracked mirror" },
  ],
};

const photo = (defectClientId: string): DriverQueuePayload => ({
  kind: "photo",
  defectClientId,
  blob: new Blob(["x"]),
  mimeType: "image/jpeg",
  filename: "a.jpg",
});

describe("eventOutcome", () => {
  it("treats any 2xx, including a duplicate answer, as sent", () => {
    expect(eventOutcome(200, null)).toEqual({ kind: "sent" });
    expect(eventOutcome(201, null)).toEqual({ kind: "sent" });
  });

  it("retries with the real status so repeated 5xx can set the item aside", () => {
    expect(eventOutcome(503, "Down")).toEqual({ kind: "retry", error: "Down", status: 503 });
    expect(eventOutcome(429, null)).toMatchObject({ kind: "retry", status: 429 });
    expect(eventOutcome(null, null)).toMatchObject({ kind: "retry", status: null });
  });

  it("pauses on a lost session", () => {
    expect(eventOutcome(401, "x")).toEqual({ kind: "stop", error: SIGN_IN_AGAIN_MESSAGE });
    expect(eventOutcome(403, "x")).toEqual({ kind: "stop", error: SIGN_IN_AGAIN_MESSAGE });
  });

  it("drops a refusal with the server's message", () => {
    expect(eventOutcome(409, "That vehicle is off the road.")).toEqual({ kind: "rejected", error: "That vehicle is off the road." });
    expect(eventOutcome(400, null)).toEqual({ kind: "rejected", error: "The server refused this." });
  });

  it("feeds applyOutcome so five 5xx in a row set the head aside", () => {
    let queue = enqueue<string>([], "a", "a", 0);
    let rejected = null;
    for (let i = 0; i < MAX_SERVER_FAILURES; i += 1) {
      const outcome = eventOutcome(500, "Boom");
      if (outcome.kind === "stop") throw new Error("unexpected");
      ({ queue, rejected } = applyOutcome(queue, "a", outcome, 0));
    }
    expect(queue).toEqual([]);
    expect(rejected).not.toBeNull();
  });
});

describe("photoOutcome", () => {
  it("retries a 404 because the defect has not synced yet", () => {
    expect(photoOutcome(404, "That defect has not synced yet.", 0)).toMatchObject({ kind: "retry", status: 404 });
  });

  it("sets a photo aside once its defect has been missing for too long", () => {
    expect(photoOutcome(404, null, PHOTO_UNMATCHED_AFTER - 1).kind).toBe("rejected");
  });

  it("otherwise reads the answer like an event", () => {
    expect(photoOutcome(409, "A defect can have at most five photos.", 0)).toEqual({ kind: "rejected", error: "A defect can have at most five photos." });
    expect(photoOutcome(200, null, 3)).toEqual({ kind: "sent" });
  });
});

describe("dependants", () => {
  it("lists the defects a check or end-of-shift creates", () => {
    expect(defectClientIdsOf(check)).toEqual(["d1", "d2"]);
    expect(defectClientIdsOf({ type: "shift_ended", clientId: "e", occurredAt: "x", shiftClientId: "c1", odometer: 5, newDefects: [check.defects[0]] })).toEqual(["d1"]);
    expect(defectClientIdsOf({ type: "break_started", clientId: "b", occurredAt: "x", shiftClientId: "c1" })).toEqual([]);
  });

  it("finds the photos orphaned by a refused event", () => {
    let queue: QueueItem<DriverQueuePayload>[] = [];
    queue = enqueue(queue, "e1", { kind: "event", event: check }, 0);
    queue = enqueue(queue, "p1", photo("d1"), 0);
    queue = enqueue(queue, "p2", photo("other"), 0);
    queue = enqueue(queue, "p3", photo("d2"), 0);
    expect(orphanedPhotoIds(queue, check)).toEqual(["p1", "p3"]);
    expect(pendingEvents(queue)).toEqual([check]);
  });
});
