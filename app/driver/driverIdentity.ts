"use client";
import { useEffect, useSyncExternalStore } from "react";
import { createClient } from "../../lib/supabase/browser";
import { readDriverSnapshot } from "../../lib/offline/driverCache";
import { snapshotStore } from "../../lib/offline/snapshotStore";

const KEY = "tms-driver-snapshot-owner";
let owner: string | null = null;
let revision = 0;
let started = false;
const listeners = new Set<() => void>();
function setOwner(id: string | null) {
  revision++;
  owner = id;
  try { if (id) localStorage.setItem(KEY, id); else localStorage.removeItem(KEY); } catch { /* storage refused */ }
  for (const listener of listeners) listener();
}
/** Also observed by the root provider: an office-page sign-out/account switch
 * must invalidate the driver's remembered identity on this shared phone. */
export function observeDriverAuth(event: string, userId: string | null): void {
  if (event === "SIGNED_OUT") setOwner(null);
  else if (userId && owner !== userId) setOwner(userId);
}
async function start() {
  if (started) return;
  started = true;
  const client = createClient();
  client.auth.onAuthStateChange((event, session) => {
    observeDriverAuth(event, session?.user.id ?? null);
  });
  const initialRevision = revision;
  try {
    const { data, error } = await client.auth.getSession();
    if (revision !== initialRevision) return;
    if (data.session) setOwner(data.session.user.id);
    else if (!error) setOwner(null);
    else if (!navigator.onLine) setOwner(localStorage.getItem(KEY));
  } catch {
    if (revision === initialRevision && !navigator.onLine) {
      try { setOwner(localStorage.getItem(KEY)); } catch { setOwner(null); }
    }
  }
}
export function useDriverIdentity(): string | null {
  useEffect(() => { void start(); }, []);
  return useSyncExternalStore(
    (listener) => { listeners.add(listener); return () => { listeners.delete(listener); }; },
    () => owner,
    () => null,
  );
}
export function loadDriverData<T>(id: string, url: string) {
  const atStart = revision;
  return readDriverSnapshot<T>({ owner: id, url, store: snapshotStore, fetcher: fetch,
    isCurrent: () => owner === id && revision === atStart });
}
export async function prepareAssignedJobs(id: string, jobs: { id: string }[]): Promise<void> {
  if (!navigator.onLine || owner !== id) return;
  const atStart = revision;
  const paths = jobs.slice(0, 80).map((job) => `/driver/jobs/${encodeURIComponent(job.id)}`);
  if ("serviceWorker" in navigator && process.env.NODE_ENV === "production") {
    void navigator.serviceWorker.ready.then((registration) => {
      if (owner === id && revision === atStart) registration.active?.postMessage({ type: "PREPARE_DRIVER_PAGES", paths });
    });
  }
  let index = 0;
  await Promise.all(Array.from({ length: 3 }, async () => {
    while (index < paths.length && owner === id && revision === atStart) {
      const path = paths[index++];
      await loadDriverData(id, `/api${path}`).catch(() => {});
    }
  }));
}
export function snapshotMessage(result: { cached: boolean; durable: boolean; savedAt: number }): string {
  if (result.cached) return `Offline: showing data saved ${new Date(result.savedAt).toLocaleString()}. Reconnect to check assignments.`;
  if (!result.durable) return "This phone cannot save driver data for offline reopening. Keep this page open.";
  return "";
}
