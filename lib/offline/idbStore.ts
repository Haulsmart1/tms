/*
  Thin IndexedDB adapter for the driver's offline queue (browser only). The
  queue rules live in lib/offline/queue.ts; this file only stores items. When
  IndexedDB is missing or refuses (SSR, some private modes) it falls back to
  memory, so the queue still works for the life of the page.
*/

import type { QueueItem } from "./queue";

export type StoredItem<T> = QueueItem<T> & { seq: number };

const DB_NAME = "tms-driver-queue";
const STORE = "items";
const memory = new Map<string, StoredItem<unknown>>();
let dbPromise: Promise<IDBDatabase> | null = null;
let warned = false;

export function idbAvailable(): boolean {
  return typeof window !== "undefined" && typeof indexedDB !== "undefined";
}

function fallback(error: unknown): void {
  if (!warned) console.warn("[driver-queue] IndexedDB unavailable, queue is memory-only", error);
  warned = true;
}

function open(): Promise<IDBDatabase> {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, 1);
      request.onupgradeneeded = () => request.result.createObjectStore(STORE, { keyPath: "id" }).createIndex("seq", "seq");
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    dbPromise.catch(() => (dbPromise = null));
  }
  return dbPromise;
}

function run<R>(mode: IDBTransactionMode, work: (store: IDBObjectStore) => IDBRequest<R>): Promise<R> {
  return open().then(
    (db) =>
      new Promise<R>((resolve, reject) => {
        const request = work(db.transaction(STORE, mode).objectStore(STORE));
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      }),
  );
}

export async function idbLoadAll<T>(): Promise<StoredItem<T>[]> {
  try {
    if (!idbAvailable()) throw new Error("no indexedDB");
    const rows = await run("readonly", (store) => store.index("seq").getAll() as IDBRequest<StoredItem<T>[]>);
    for (const row of rows) memory.set(row.id, row as StoredItem<unknown>);
    return rows;
  } catch (error) {
    fallback(error);
    return ([...memory.values()] as StoredItem<T>[]).sort((a, b) => a.seq - b.seq);
  }
}

export async function idbPut<T>(item: StoredItem<T>): Promise<void> {
  memory.set(item.id, item as StoredItem<unknown>);
  try {
    if (!idbAvailable()) throw new Error("no indexedDB");
    await run("readwrite", (store) => store.put(item));
  } catch (error) {
    fallback(error);
  }
}

export async function idbDelete(id: string): Promise<void> {
  memory.delete(id);
  try {
    if (!idbAvailable()) throw new Error("no indexedDB");
    await run("readwrite", (store) => store.delete(id));
  } catch (error) {
    fallback(error);
  }
}
