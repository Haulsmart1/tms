"use client";
/*
  The driver's offline queue: shift and walkaround events plus defect photos,
  sent strictly in order to the server. State rules live in lib/offline/queue.ts
  and how each answer is read lives in lib/offline/driverSync.ts; this module
  does the fetching, storage (lib/offline/idbStore.ts) and scheduling.

  One queue per browser tab, shared by every component through this module.
  Only one flush runs at a time: every flush is chained on the previous one,
  and across tabs each flush holds the "tms-driver-queue-flush" Web Lock and
  re-reads IndexedDB once it has it, so two tabs never send the same item.
  Without Web Locks (old browsers) two open tabs can still both send an item:
  an event is idempotent on its clientId, but a photo could be stored twice.

  Phones are shared. Each item records the Supabase user who queued it, and
  only the signed-in user's own items are sent (lib/offline/driverSync.ts,
  partitionByOwner). Anyone else's are held, not deleted, until they sign in.
*/

import { idbDelete, idbLoadAll, idbPut, type StoredItem } from "../../lib/offline/idbStore";
import {
  eventOutcome,
  orphanedPhotoIds,
  partitionByOwner,
  photoOutcome,
  SIGN_IN_AGAIN_MESSAGE,
  type DriverQueuePayload,
  type SyncResult,
  withoutQrPayload,
} from "../../lib/offline/driverSync";
import { applyOutcome, enqueue, nextDue, type QueueItem } from "../../lib/offline/queue";
import { readJsonSafe } from "../../lib/pod/uploadClient";
import type { DriverEvent } from "../../lib/shifts/events";
import { createClient } from "../../lib/supabase/browser";

export type QueuePayload = DriverQueuePayload;
export type RejectedItem = { id: string; message: string; ownerId?: string };
/** Events the server accepted in this tab, so the page can keep showing them until it re-reads the server state. */
export type SentEvent = { event: DriverEvent; sentAt: number };
export type QueueSnapshot = {
  /** The signed-in user's own items, in the order they will be sent. */
  pending: QueueItem<QueuePayload>[];
  /** Items queued on this phone by someone else, held until they sign in. */
  heldForOthers: number;
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
const LAST_USER_KEY = "tms-driver-queue-user";
const REQUEST_TIMEOUT_MS = 20_000;

let queue: StoredItem<QueuePayload>[] = [];
let seq = 0;
let rejected: RejectedItem[] = [];
let paused: string | null = null;
let sent: SentEvent[] = [];
/** The signed-in user as far as this phone knows (see refreshUser). */
let currentUser: string | null = null;
let loading: Promise<void> | null = null;
let chain: Promise<unknown> = Promise.resolve();
let timer: ReturnType<typeof setTimeout> | null = null;
const listeners = new Set<(snapshot: QueueSnapshot) => void>();
let snapshot: QueueSnapshot = { pending: [], heldForOthers: 0, rejected: [], paused: null, sent: [] };
const EMPTY_SNAPSHOT: QueueSnapshot = snapshot;

function mine(): StoredItem<QueuePayload>[] {
  return partitionByOwner(queue, currentUser).mine;
}

function emit(): void {
  const { mine: own, heldForOthers } = partitionByOwner(queue, currentUser);
  const visible = rejected.filter((r) => !r.ownerId || r.ownerId === currentUser);
  snapshot = { pending: own, heldForOthers, rejected: visible, paused, sent };
  for (const listener of listeners) listener(snapshot);
}

function readRememberedUser(): string | null {
  try {
    return window.localStorage.getItem(LAST_USER_KEY);
  } catch {
    return null;
  }
}

function rememberUser(id: string): void {
  try {
    window.localStorage.setItem(LAST_USER_KEY, id);
  } catch {
    // Storage blocked: the session read below still works while online.
  }
}

function setCurrentUser(id: string | null): void {
  if (id === currentUser) return;
  currentUser = id;
  // Accepted events and pauses belong to the previous user's session.
  sent = [];
  paused = null;
  emit();
}

/*
  Who is signed in. getSession reads local storage, but with an expired access
  token and no signal it answers null (the refresh needs the network), so fall
  back to the last user this phone saw signed in: offline, the driver still
  sees their own queued work. Sending needs the real session cookie anyway;
  without one the server answers 401 and the queue pauses.
*/
async function refreshUser(): Promise<string | null> {
  let id: string | null = null;
  try {
    const { data } = await createClient().auth.getSession();
    id = data.session?.user.id ?? null;
  } catch {
    id = null;
  }
  if (id) rememberUser(id);
  setCurrentUser(id ?? readRememberedUser());
  return currentUser;
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
  try {
    createClient().auth.onAuthStateChange((_event, session) => {
      const id = session?.user.id ?? null;
      if (!id) return;
      rememberUser(id);
      // Deferred: calling back into supabase-js inside this callback can deadlock.
      setTimeout(() => {
        setCurrentUser(id);
        // A session exists again (same user signing back in included): unpause.
        if (paused !== null) {
          paused = null;
          emit();
        }
        void runChained(false);
      }, 0);
    });
  } catch {
    // No Supabase config: the session read in each flush still applies.
  }
  window.addEventListener("online", () => void runChained(true));
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") void runChained(true);
  });
  window.addEventListener("beforeunload", (event) => {
    if (mine().length === 0) return;
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
      await refreshUser();
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
  // POD kinds are not enqueued by anything yet; held rather than dropped.
  if (item.payload.kind !== "event") return { kind: "retry", error: "Waiting for an app update to send this.", status: null };
  const result = await post(EVENTS_URL, item.payload.event);
  return eventOutcome(result.status, result.error);
}

function schedule(): void {
  if (timer) clearTimeout(timer);
  timer = null;
  const head = mine()[0];
  if (paused !== null || !head) return;
  timer = setTimeout(() => void runChained(false), Math.max(0, head.nextAttemptAt - Date.now()));
}

const FLUSH_LOCK = "tms-driver-queue-flush";

/* Runs `work` holding the cross-tab flush lock, or directly when the browser has no Web Locks. */
function withFlushLock(work: () => Promise<void>): Promise<void> {
  const locks = typeof navigator !== "undefined" ? navigator.locks : undefined;
  if (!locks || typeof locks.request !== "function") return work();
  return locks.request(FLUSH_LOCK, () => work());
}

async function flushOnce(force: boolean): Promise<void> {
  await ensureLoaded();
  // Another tab may have sent, retried or added items while this one waited
  // for the lock: IndexedDB is the shared truth, memory is only this tab's copy.
  queue = await idbLoadAll<QueuePayload>();
  seq = queue.reduce((max, item) => Math.max(max, item.seq), seq);
  await refreshUser();
  if (force) {
    paused = null;
    const head = mine()[0];
    if (head && head.nextAttemptAt > Date.now()) {
      const reset = { ...head, nextAttemptAt: Date.now() };
      queue = queue.map((i) => (i.id === head.id ? reset : i));
      await idbPut(reset);
    }
    emit();
  }
  if (currentUser === null && queue.length > 0 && paused === null) {
    paused = SIGN_IN_AGAIN_MESSAGE;
    emit();
  }

  while (paused === null) {
    // Only the signed-in user's items, in order: the head of their own run.
    const head = nextDue(mine(), Date.now());
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
      sent = [...sent, { event: withoutQrPayload(head.payload.event), sentAt: now }].slice(-50);
    }
    if (result.rejected) {
      let message = result.rejected.lastError ?? "The server refused this.";
      if (head.payload.kind === "event") {
        const orphans = new Set(orphanedPhotoIds(next, head.payload.event));
        if (orphans.size > 0) message += " Its photos were not sent.";
        next = next.filter((i) => !orphans.has(i.id));
        for (const id of orphans) await idbDelete(id);
      }
      rejected = [...rejected, { id: head.id, message, ownerId: head.payload.ownerId }];
      saveRejected();
    }
    queue = next;
    const updated = queue.find((i) => i.id === head.id);
    // Sent or refused items leave IndexedDB here, and with them any scanned QR payload.
    if (updated) await idbPut(updated);
    else await idbDelete(head.id);
    emit();
    if (outcome.kind === "retry") break;
  }
  schedule();
}

function runChained(force: boolean): Promise<void> {
  const run = chain.then(() => withFlushLock(() => flushOnce(force)));
  chain = run.catch((error) => console.warn("[driver-queue] flush failed", error));
  return run;
}

async function add(id: string, build: (ownerId: string) => QueuePayload): Promise<void> {
  await ensureLoaded();
  const owner = await refreshUser();
  if (!owner) throw new Error(SIGN_IN_AGAIN_MESSAGE);
  const payload = build(owner);
  const grown = enqueue(queue, id, payload, Date.now());
  if (grown.length === queue.length) return;
  seq += 1;
  const item: StoredItem<QueuePayload> = { ...grown[grown.length - 1], seq };
  // Stored before it joins the in-memory queue, so a flush re-reading
  // IndexedDB can never see memory ahead of storage. That re-read may already
  // have picked it up during the await, hence the filter.
  await idbPut(item);
  queue = [...queue.filter((i) => i.id !== item.id), item];
  emit();
  void runChained(false);
}

/** Queue one driver event. Resolves once it is stored, not once it is sent. Rejects when nobody is signed in. */
export function enqueueEvent(event: DriverEvent): Promise<void> {
  return add(event.clientId, (ownerId) => ({ kind: "event", ownerId, event }));
}

/** Queue one defect photo. It is sent after the event carrying its defect. */
export function enqueuePhoto(defectClientId: string, blob: Blob, mimeType: string, filename: string): Promise<void> {
  return add(crypto.randomUUID(), (ownerId) => ({ kind: "photo", ownerId, defectClientId, blob, mimeType, filename }));
}

/** Try to send everything now, ignoring any backoff. `remaining` counts only the signed-in user's items. */
export async function flushDriverQueue(): Promise<{ remaining: number }> {
  try {
    await runChained(true);
  } catch {
    // Logged by runChained; the count below still tells the caller what is left.
  }
  return { remaining: mine().length };
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
