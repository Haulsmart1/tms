"use client";
/*
  The driver's offline queue: shift and walkaround events plus defect photos,
  sent strictly in order to the server. State rules live in lib/offline/queue.ts
  and how each answer is read lives in lib/offline/driverSync.ts; this module
  does the fetching, storage (lib/offline/idbStore.ts) and scheduling.

  One queue per browser tab, shared by every component through this module.
  Only one flush runs at a time: every flush is chained on the previous one.
*/

import { idbDelete, idbLoadAll, idbPut, type StoredItem } from "../../lib/offline/idbStore";
import { eventOutcome, orphanedPhotoIds, photoOutcome, type DriverQueuePayload, type SyncResult } from "../../lib/offline/driverSync";
import { applyOutcome, enqueue, nextDue, type QueueItem } from "../../lib/offline/queue";
import { readJsonSafe } from "../../lib/pod/uploadClient";
import type { DriverEvent } from "../../lib/shifts/events";
import { createClient } from "../../lib/supabase/browser";

export type QueuePayload = DriverQueuePayload;
export type RejectedItem = { id: string; message: string };
/** Events the server accepted in this tab, so the page can keep showing them until it re-reads the server state. */
export type SentEvent = { event: DriverEvent; sentAt: number };
export type QueueSnapshot = {
  pending: QueueItem<QueuePayload>[];
  rejected: RejectedItem[];
  /** Set when the session has gone: nothing is sent until the next flushDriverQueue call. */
  paused: string | null;
  sent: SentEvent[];
};

const EVENTS_URL = "/api/driver/shift/events";
const PHOTO_UPLOAD_URL = "/api/driver/walkaround/photos/upload-url";
const PHOTO_RECORD_URL = "/api/driver/walkaround/photos";
const PHOTO_BUCKET = "walkaround-photos";
const REJECTED_KEY = "tms-driver-queue-rejected";
const REQUEST_TIMEOUT_MS = 20_000;

let queue: StoredItem<QueuePayload>[] = [];
let seq = 0;
let rejected: RejectedItem[] = [];
let paused: string | null = null;
let sent: SentEvent[] = [];
let loading: Promise<void> | null = null;
let chain: Promise<unknown> = Promise.resolve();
let timer: ReturnType<typeof setTimeout> | null = null;
const listeners = new Set<(snapshot: QueueSnapshot) => void>();
let snapshot: QueueSnapshot = { pending: [], rejected: [], paused: null, sent: [] };
const EMPTY_SNAPSHOT: QueueSnapshot = snapshot;

function emit(): void {
  snapshot = { pending: queue, rejected, paused, sent };
  for (const listener of listeners) listener(snapshot);
}

function readRejected(): RejectedItem[] {
  try {
    const parsed: unknown = JSON.parse(window.localStorage.getItem(REJECTED_KEY) ?? "[]");
    return Array.isArray(parsed) ? parsed.filter((r): r is RejectedItem => typeof r?.id === "string" && typeof r?.message === "string") : [];
  } catch {
    return [];
  }
}

function saveRejected(): void {
  try {
    window.localStorage.setItem(REJECTED_KEY, JSON.stringify(rejected));
  } catch {
    // Storage blocked: the notice lasts for this page only.
  }
}

function installWindowHooks(): void {
  window.addEventListener("online", () => void runChained(true));
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") void runChained(true);
  });
  window.addEventListener("beforeunload", (event) => {
    if (queue.length === 0) return;
    event.preventDefault();
    event.returnValue = "";
  });
}

function ensureLoaded(): Promise<void> {
  if (!loading) {
    loading = (async () => {
      installWindowHooks();
      rejected = readRejected();
      queue = await idbLoadAll<QueuePayload>();
      seq = queue.reduce((max, item) => Math.max(max, item.seq), 0);
      emit();
      schedule();
    })();
  }
  return loading;
}

async function post(url: string, body: unknown): Promise<{ status: number | null; error: string | null; json: Record<string, unknown> }> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      cache: "no-store",
      signal: controller.signal,
    });
    const json = await readJsonSafe(response);
    return { status: response.status, error: typeof json.error === "string" ? json.error : null, json };
  } catch {
    return { status: null, error: null, json: {} };
  } finally {
    clearTimeout(timeout);
  }
}

/* Mirrors lib/pod/uploadClient.ts, but keeps each step's HTTP status so the queue can classify it. */
async function sendPhoto(item: QueueItem<QueuePayload>, payload: Extract<QueuePayload, { kind: "photo" }>): Promise<SyncResult> {
  const start = await post(PHOTO_UPLOAD_URL, { defectClientId: payload.defectClientId, mimeType: payload.mimeType, size: payload.blob.size });
  if (start.status !== 200) return photoOutcome(start.status, start.error, item.attempts);
  const { path, token } = start.json;
  if (typeof path !== "string" || typeof token !== "string") return { kind: "retry", error: "Unable to start the photo upload.", status: 500 };

  try {
    const { error } = await createClient()
      .storage.from(PHOTO_BUCKET)
      .uploadToSignedUrl(path, token, payload.blob, { contentType: payload.mimeType, upsert: false });
    if (error) return { kind: "retry", error: "The photo upload did not complete.", status: null };
  } catch {
    return { kind: "retry", error: "The photo upload did not complete.", status: null };
  }

  const record = await post(PHOTO_RECORD_URL, { defectClientId: payload.defectClientId, path });
  return photoOutcome(record.status, record.error, item.attempts);
}

async function sendItem(item: QueueItem<QueuePayload>): Promise<SyncResult> {
  if (item.payload.kind === "photo") return sendPhoto(item, item.payload);
  const result = await post(EVENTS_URL, item.payload.event);
  return eventOutcome(result.status, result.error);
}

function schedule(): void {
  if (timer) clearTimeout(timer);
  timer = null;
  const head = queue[0];
  if (paused !== null || !head) return;
  timer = setTimeout(() => void runChained(false), Math.max(0, head.nextAttemptAt - Date.now()));
}

async function flushOnce(force: boolean): Promise<void> {
  await ensureLoaded();
  if (force) {
    paused = null;
    const head = queue[0];
    if (head && head.nextAttemptAt > Date.now()) {
      queue = [{ ...head, nextAttemptAt: Date.now() }, ...queue.slice(1)];
      await idbPut(queue[0]);
    }
    emit();
  }

  while (paused === null) {
    const head = nextDue(queue, Date.now());
    if (!head) break;
    const outcome = await sendItem(head);
    if (outcome.kind === "stop") {
      paused = outcome.error;
      emit();
      break;
    }

    const now = Date.now();
    // Read `queue` again after the await: items may have been added meanwhile.
    const result = applyOutcome(queue, head.id, outcome, now);
    let next = result.queue as StoredItem<QueuePayload>[];
    if (outcome.kind === "sent" && head.payload.kind === "event") {
      sent = [...sent, { event: head.payload.event, sentAt: now }].slice(-50);
    }
    if (result.rejected) {
      let message = result.rejected.lastError ?? "The server refused this.";
      if (head.payload.kind === "event") {
        const orphans = new Set(orphanedPhotoIds(next, head.payload.event));
        if (orphans.size > 0) message += " Its photos were not sent.";
        next = next.filter((i) => !orphans.has(i.id));
        for (const id of orphans) await idbDelete(id);
      }
      rejected = [...rejected, { id: head.id, message }];
      saveRejected();
    }
    queue = next;
    const updated = queue.find((i) => i.id === head.id);
    if (updated) await idbPut(updated);
    else await idbDelete(head.id);
    emit();
    if (outcome.kind === "retry") break;
  }
  schedule();
}

function runChained(force: boolean): Promise<void> {
  const run = chain.then(() => flushOnce(force));
  chain = run.catch((error) => console.warn("[driver-queue] flush failed", error));
  return run;
}

async function add(id: string, payload: QueuePayload): Promise<void> {
  await ensureLoaded();
  const grown = enqueue(queue, id, payload, Date.now());
  if (grown.length === queue.length) return;
  seq += 1;
  const item: StoredItem<QueuePayload> = { ...grown[grown.length - 1], seq };
  queue = [...queue, item];
  await idbPut(item);
  emit();
  void runChained(false);
}

/** Queue one driver event. Resolves once it is stored, not once it is sent. */
export function enqueueEvent(event: DriverEvent): Promise<void> {
  return add(event.clientId, { kind: "event", event });
}

/** Queue one defect photo. It is sent after the event carrying its defect. */
export function enqueuePhoto(defectClientId: string, blob: Blob, mimeType: string, filename: string): Promise<void> {
  return add(crypto.randomUUID(), { kind: "photo", defectClientId, blob, mimeType, filename });
}

/** Try to send everything now, ignoring any backoff. Resolves when this attempt is over. */
export async function flushDriverQueue(): Promise<{ remaining: number }> {
  try {
    await runChained(true);
  } catch {
    // Logged by runChained; the count below still tells the caller what is left.
  }
  return { remaining: queue.length };
}

export function subscribe(listener: (snapshot: QueueSnapshot) => void): () => void {
  listeners.add(listener);
  void ensureLoaded();
  return () => {
    listeners.delete(listener);
  };
}

export function getQueueSnapshot(): QueueSnapshot {
  return snapshot;
}

export function getServerQueueSnapshot(): QueueSnapshot {
  return EMPTY_SNAPSHOT;
}

export function dismissRejected(id: string): void {
  rejected = rejected.filter((r) => r.id !== id);
  saveRejected();
  emit();
}
