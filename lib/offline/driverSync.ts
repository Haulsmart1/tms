/*
  How the driver app's queue reads each server answer. Pure, so the rules are
  tested; app/driver/driverQueue.ts does the fetching and storage.

  A queued item is either one driver event (POST /api/driver/shift/events) or
  one defect photo (signed upload, then attached to its defect). Photos are
  always queued after the event that carries their defect, and the queue is
  strictly ordered, so a photo is only sent once its defect has synced.
*/

import type { DriverEvent } from "../shifts/events";
import { classifySyncFailure, type QueueItem, type SendOutcome } from "./queue";

export type DriverQueuePayload =
  | { kind: "event"; event: DriverEvent }
  | { kind: "photo"; defectClientId: string; blob: Blob; mimeType: string; filename: string };

/** `stop`: the session has gone (401/403). The item stays put and the queue pauses. */
export type SyncResult = SendOutcome | { kind: "stop"; error: string };

export const SIGN_IN_AGAIN_MESSAGE = "Sign in again to send your checks.";
export const NO_CONNECTION_MESSAGE = "No connection. It will be sent when you have signal.";
export const PHOTO_UNMATCHED_MESSAGE = "A defect photo could not be matched to its check and was set aside. Tell the office.";

/*
  A photo whose defect never reaches the server (its check was refused, or the
  queue was cleared on another device) would answer 404 forever and block
  every later item. After this many 404s in a row it is set aside.
*/
export const PHOTO_UNMATCHED_AFTER = 20;

/** `status` is null when the request never got an answer. `error` is the server's own message, if any. */
export function eventOutcome(status: number | null, error: string | null): SyncResult {
  if (status !== null && status >= 200 && status < 300) return { kind: "sent" };
  const action = classifySyncFailure(status);
  if (action === "stop") return { kind: "stop", error: SIGN_IN_AGAIN_MESSAGE };
  if (action === "retry") {
    return { kind: "retry", error: status === null ? NO_CONNECTION_MESSAGE : error || `The server answered ${status}. Retrying.`, status };
  }
  return { kind: "rejected", error: error || "The server refused this." };
}

/**
 * A 404 from either photo route means the defect has not synced yet: retry,
 * unless it has gone on long enough that it never will.
 */
export function photoOutcome(status: number | null, error: string | null, attempts: number): SyncResult {
  if (status === 404) {
    if (attempts + 1 >= PHOTO_UNMATCHED_AFTER) return { kind: "rejected", error: PHOTO_UNMATCHED_MESSAGE };
    return { kind: "retry", error: "Waiting for the check to sync.", status };
  }
  return eventOutcome(status, error);
}

/** The defect client ids an event creates (their photos depend on it). */
export function defectClientIdsOf(event: DriverEvent): string[] {
  if (event.type === "check_submitted") return event.defects.map((d) => d.clientId);
  if (event.type === "shift_ended") return event.newDefects.map((d) => d.clientId);
  return [];
}

/** Queued photos that belong to an event the server refused: they can never be attached. */
export function orphanedPhotoIds(queue: readonly QueueItem<DriverQueuePayload>[], refused: DriverEvent): string[] {
  const defects = new Set(defectClientIdsOf(refused));
  if (defects.size === 0) return [];
  return queue.filter((i) => i.payload.kind === "photo" && defects.has(i.payload.defectClientId)).map((i) => i.id);
}

/** The events still waiting, in order, for the offline projection. */
export function pendingEvents(queue: readonly QueueItem<DriverQueuePayload>[]): DriverEvent[] {
  const out: DriverEvent[] = [];
  for (const item of queue) if (item.payload.kind === "event") out.push(item.payload.event);
  return out;
}
