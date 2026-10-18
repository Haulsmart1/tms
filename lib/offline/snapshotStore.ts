import type { Snapshot, SnapshotStore } from "./driverCache";
import type { DriverEvent } from "../shifts/events";
import { projectDriverState } from "../shifts/projection";
import type { DriverShiftState } from "../walkaround/driverState";
import { dashboardAssignedJobs } from "../driver/dashboardJobs";

type ShiftSnapshot = Snapshot<DriverShiftState>;
type AssignmentSnapshot = { jobs: { id: string }[]; todayJobs?: { id: string }[] };

// A separate database leaves existing queued events and photos untouched.
let database: Promise<IDBDatabase> | undefined;
function open(): Promise<IDBDatabase> {
  if (!database) {
    database = new Promise((resolve, reject) => {
      const request = indexedDB.open("tms-driver-snapshots", 1);
      request.onupgradeneeded = () => request.result.createObjectStore("snapshots", { keyPath: ["owner", "url"] });
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
      request.onblocked = () => reject(new Error("Driver snapshot database blocked"));
    });
    void database.catch(() => { database = undefined; });
  }
  return database;
}
async function run<T>(mode: IDBTransactionMode, work: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await open();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction("snapshots", mode);
    const request = work(transaction.objectStore("snapshots"));
    // A successful request is not yet durable: wait for the transaction commit.
    transaction.oncomplete = () => resolve(request.result);
    transaction.onabort = () => reject(transaction.error ?? new Error("Snapshot transaction aborted"));
    transaction.onerror = () => reject(transaction.error);
  });
}
export const snapshotStore: SnapshotStore = {
  get: <T>(owner: string, url: string) => run("readonly", (store) => store.get([owner, url]) as IDBRequest<Snapshot<T> | undefined>),
  put: async (snapshot) => {
    const db = await open();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction("snapshots", "readwrite");
      const store = tx.objectStore("snapshots");
      const existing = store.get([snapshot.owner, snapshot.url]);
      existing.onsuccess = () => {
        if (existing.result && existing.result.savedAt > snapshot.savedAt) return;
        if (snapshot.url === "/api/driver/shift") {
          const accepted = ((existing.result as ShiftSnapshot | undefined)?.accepted ?? []).filter((item) => item.sentAt >= snapshot.savedAt);
          store.put({ ...snapshot, data: projectDriverState(snapshot.data as DriverShiftState, accepted.map((item) => item.event)), accepted,
            reflectedAt: accepted.length ? Math.max(...accepted.map((item) => item.sentAt)) + 1 : undefined });
        } else if (snapshot.url.startsWith("/api/driver/jobs/")) {
          const dashboard = store.get([snapshot.owner, "/api/driver/me"]);
          dashboard.onsuccess = () => {
            const current = dashboard.result as Snapshot<AssignmentSnapshot> | undefined;
            if (current && current.savedAt >= snapshot.savedAt && !dashboardAssignedJobs(current.data).some((job) => snapshot.url === `/api/driver/jobs/${encodeURIComponent(job.id)}`)) return;
            store.put(snapshot);
          };
        } else store.put(snapshot);
        if (snapshot.url === "/api/driver/me") {
          const assignments = snapshot.data as AssignmentSnapshot;
          if (!Array.isArray(assignments.jobs)) return;
          const allowed = new Set(dashboardAssignedJobs(assignments).map((job) => `/api/driver/jobs/${encodeURIComponent(job.id)}`));
          const cursor = store.openCursor();
          cursor.onsuccess = () => {
            const row = cursor.result;
            if (!row) return;
            const item = row.value as Snapshot<unknown>;
            if (item.owner === snapshot.owner && item.url.startsWith("/api/driver/jobs/") && !allowed.has(item.url)) row.delete();
            row.continue();
          };
        }
      };
      tx.oncomplete = () => resolve();
      tx.onabort = () => reject(tx.error);
      tx.onerror = () => reject(tx.error);
    });
  },
  remove: async (owner, url) => {
    if (url !== "/api/driver/me") { await run("readwrite", (store) => store.delete([owner, url])); return; }
    const db = await open();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction("snapshots", "readwrite");
      const request = tx.objectStore("snapshots").openCursor();
      request.onsuccess = () => { const row = request.result; if (row) { if (row.value.owner === owner) row.delete(); row.continue(); } };
      tx.oncomplete = () => resolve();
      tx.onabort = () => reject(tx.error);
      tx.onerror = () => reject(tx.error);
    });
  },
};

/** Commit accepted shift events before dropping their mutation queue rows, so
 * closing the phone before the next GET does not lose the projected state. */
export async function reflectAcceptedShift(owner: string, event: DriverEvent, sentAt: number): Promise<void> {
  const db = await open();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction("snapshots", "readwrite");
    const store = tx.objectStore("snapshots");
    const request = store.get([owner, "/api/driver/shift"]);
    request.onsuccess = () => {
      const row = request.result as ShiftSnapshot | undefined;
      if (!row || row.savedAt > sentAt || row.accepted?.some((item) => item.event.clientId === event.clientId)) return;
      store.put({ ...row, data: projectDriverState(row.data, [event]), reflectedAt: sentAt + 1,
        accepted: [...(row.accepted ?? []), { event, sentAt }].slice(-50) });
    };
    tx.oncomplete = () => resolve();
    tx.onabort = () => reject(tx.error);
    tx.onerror = () => reject(tx.error);
  });
}
