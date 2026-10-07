/*
  How the driver app's queue reads each server answer. Pure, so the rules are
  tested; app/driver/driverQueue.ts does the fetching and storage.

  A queued item is either one driver event (POST /api/driver/shift/events) or
  one defect photo (signed upload, then attached to its defect). Photos are
  always queued after the event that carries their defect, and the queue is
  strictly ordered, so a photo is only sent once its defect has synced.
  Offline POD work joins the same queue as three more kinds: a POD photo
  (signed upload, then recorded on its stop), a barcode scan and a delivery
  completion. They are queued in the order the driver acted, so a stop's
  photos and scans always reach the server before its completion.

  Every item records the signed-in user who queued it (ownerId). A phone can
  be shared: items queued by driver A are only ever sent while A is signed in,
  never under driver B's session. They are held, not deleted, until A returns.
*/

import type { DriverEvent } from "../shifts/events";
import { PHOTO_RACE_MESSAGE } from "../walkaround/photoPaths";
import { classifySyncFailure, type QueueItem, type SendOutcome } from "./queue";

export type DriverQueuePayload =
  | { kind: "event"; ownerId: string; event: DriverEvent }
  | { kind: "photo"; ownerId: string; defectClientId: string; blob: Blob; mimeType: string; filename: string }
  /* Offline POD. Queued in the order the driver acted, so a stop's photos and
     scans always reach the server before its completion. */
  | {
      kind: "pod_photo";
      ownerId: string;
      clientId: string;
      jobId: string;
      stopId: string;
      shiftClientId: string | null;
      recordedAt: string;
      blob: Blob;
      mimeType: string;
      filename: string;
    }
  | {
      kind: "pod_scan";
      ownerId: string;
      clientId: string;
      jobId: string;
      stopId: string;
      /** Matched on the phone (findExpectedSerial) for the projection; the server matches again. */
      jobItemId: string;
      serialNumber: string;
      scanFormat: string;
    }
  | {
      kind: "pod_complete";
      ownerId: string;
      clientId: string;
      jobId: string;
      stopId: string;
      shiftClientId: string | null;
      recordedAt: string;
      recipientName: string;
      podNotes: string;
    };

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
 * unless it has gone on long enough that it never will. A 409 carrying
 * PHOTO_RACE_MESSAGE lost a race with another photo on the same defect: retry.
 */
export function photoOutcome(status: number | null, error: string | null, attempts: number): SyncResult {
  if (status === 404) {
    if (attempts + 1 >= PHOTO_UNMATCHED_AFTER) return { kind: "rejected", error: PHOTO_UNMATCHED_MESSAGE };
    return { kind: "retry", error: "Waiting for the check to sync.", status };
  }
  if (status === 409 && error === PHOTO_RACE_MESSAGE) return { kind: "retry", error: "Retrying the photo.", status };
  return eventOutcome(status, error);
}

/** The defect client ids an event creates (their photos depend on it). */
export function defectClientIdsOf(event: DriverEvent): string[] {
  if (event.type === "check_submitted") return event.defects.map((d) => d.clientId);
  if (event.type === "shift_ended") return event.newDefects.map((d) => d.clientId);
  return [];
}

/*
  A queued start or swap check holds the scanned cab QR payload in IndexedDB
  until it is sent: offline, that is the only record of the scan. Once the
  item is sent or refused it is deleted from storage, and the copy kept in
  memory for the page (the "sent" list) goes through this, so the payload is
  not held any longer than it has to be.
*/
export function withoutQrPayload(event: DriverEvent): DriverEvent {
  if (event.type !== "check_submitted" || event.qrPayload === null) return event;
  return { ...event, qrPayload: null };
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

/**
 * The POD upload-url answer. `token: null` means the object is already
 * stored (or recorded): skip the storage upload and go straight to the record
 * call. Anything malformed is null, so the runner retries.
 */
export function parsePodUploadStart(json: unknown): { path: string; token: string | null } | null {
  if (!json || typeof json !== "object") return null;
  const { path, token } = json as Record<string, unknown>;
  if (typeof path !== "string" || path.length === 0) return null;
  if (token !== null && typeof token !== "string") return null;
  return { path, token };
}

/*
  A queued POD photo is uploaded without upsert, to a path derived from its
  client id. A retry after an upload that landed but whose answer was lost
  finds the object already there: that is success, so the runner goes on to
  record it. storage-js reports it as a StorageApiError carrying the HTTP
  `status` (a number) and the service's `statusCode` (a string, "409" even
  when the HTTP status is 400), with the message "The resource already exists"
  or an error code "Duplicate".
*/
const ALREADY_STORED = /already exists|duplicate/i;

export function podUploadErrorIsAlreadyStored(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const e = error as { status?: unknown; statusCode?: unknown; message?: unknown; error?: unknown };
  if (e.status === 409 || e.status === "409") return true;
  if (e.statusCode === 409 || e.statusCode === "409") return true;
  for (const text of [e.message, e.statusCode, e.error]) {
    if (typeof text === "string" && ALREADY_STORED.test(text)) return true;
  }
  return false;
}

export const POD_PHOTO_NOT_STORABLE_MESSAGE =
  "The photo could not be stored (it may be too large or an unsupported type). Tell the office.";
const POD_UPLOAD_INCOMPLETE = "The photo upload did not complete.";

/** The HTTP status a storage error carries: StorageApiError's numeric `status`, else a numeric-looking `statusCode`. */
function storageErrorStatus(error: unknown): number | null {
  if (!error || typeof error !== "object") return null;
  const { status, statusCode } = error as { status?: unknown; statusCode?: unknown };
  if (typeof status === "number" && Number.isInteger(status) && status > 0) return status;
  if (typeof statusCode === "number" && Number.isInteger(statusCode) && statusCode > 0) return statusCode;
  if (typeof statusCode === "string" && /^\d{3}$/.test(statusCode)) return Number(statusCode);
  return null;
}

/**
 * How the runner reads a failed POD storage upload. "already_stored": an
 * earlier attempt landed, go on to record it. No HTTP answer: retry. 408, 425,
 * 429 and 5xx: retry with the status, so repeated 5xx sets the item aside.
 * Any other 4xx (401 and 403 included: the signed token was refused, not the
 * session, and pausing would never end) is a final refusal the driver sees.
 */
export function podUploadErrorOutcome(error: unknown): SyncResult | "already_stored" {
  if (podUploadErrorIsAlreadyStored(error)) return "already_stored";
  const status = storageErrorStatus(error);
  if (status === null) return { kind: "retry", error: POD_UPLOAD_INCOMPLETE, status: null };
  if (status === 408 || status === 425 || status === 429 || status >= 500) return { kind: "retry", error: POD_UPLOAD_INCOMPLETE, status };
  return { kind: "rejected", error: POD_PHOTO_NOT_STORABLE_MESSAGE };
}

export type PendingPod = {
  photos: number;
  scans: { job_item_id: string; serial_number: string }[];
  completion: null | { recipientName: string; podNotes: string; recordedAt: string };
};

/** Queued POD work for one job, per stop, so the job page can show it before it is sent. */
export function pendingPodByStop(queue: readonly QueueItem<DriverQueuePayload>[], jobId: string): Map<string, PendingPod> {
  const out = new Map<string, PendingPod>();
  const entry = (stopId: string) => {
    let found = out.get(stopId);
    if (!found) {
      found = { photos: 0, scans: [], completion: null };
      out.set(stopId, found);
    }
    return found;
  };
  for (const { payload } of queue) {
    if (payload.kind !== "pod_photo" && payload.kind !== "pod_scan" && payload.kind !== "pod_complete") continue;
    if (payload.jobId !== jobId) continue;
    const stop = entry(payload.stopId);
    if (payload.kind === "pod_photo") stop.photos += 1;
    else if (payload.kind === "pod_scan") stop.scans.push({ job_item_id: payload.jobItemId, serial_number: payload.serialNumber });
    else stop.completion = { recipientName: payload.recipientName, podNotes: payload.podNotes, recordedAt: payload.recordedAt };
  }
  return out;
}

/**
 * The items the signed-in user may send, in queue order, and how many belong
 * to someone else. With nobody signed in, nothing is sendable. An item with no
 * owner (never written by this code) is held too: sending it could put
 * another driver's check under this driver's name.
 */
export function partitionByOwner<I extends QueueItem<{ ownerId?: string | null }>>(
  queue: readonly I[],
  userId: string | null,
): { mine: I[]; heldForOthers: number } {
  const mine = userId ? queue.filter((i) => i.payload.ownerId === userId) : [];
  return { mine, heldForOthers: queue.length - mine.length };
}

export function heldForOthersMessage(count: number): string | null {
  if (count <= 0) return null;
  return count === 1
    ? "1 item queued by another driver on this phone is waiting for them to sign in."
    : `${count} items queued by another driver on this phone are waiting for them to sign in.`;
}
