/** Read snapshots are separate from the mutation queue. Never infer assignments
 * from queued POD work. A successful server read replaces the whole snapshot. */
import type { DriverEvent } from "../shifts/events";
export type Snapshot<T> = { owner: string; url: string; savedAt: number; data: T; reflectedAt?: number; accepted?: { event: DriverEvent; sentAt: number }[] };
export interface SnapshotStore {
  get<T>(owner: string, url: string): Promise<Snapshot<T> | undefined>;
  put<T>(snapshot: Snapshot<T>): Promise<void>;
  remove(owner: string, url: string): Promise<void>;
}
export const MAX_SNAPSHOT_AGE = 48 * 60 * 60 * 1000;
export function isDriverRead(url: string): boolean {
  return url === "/api/driver/me" || url === "/api/driver/shift" || /^\/api\/driver\/jobs\/[^/?]+$/.test(url);
}
export class DriverReadError extends Error {
  constructor(message: string, public status = 0) { super(message); }
}
export async function readDriverSnapshot<T>(options: {
  owner: string;
  url: string;
  store: SnapshotStore;
  fetcher: typeof fetch;
  isCurrent: () => boolean;
  now?: () => number;
}): Promise<{ data: T; cached: boolean; savedAt: number; durable: boolean; reflectedAt?: number; reflectedEventIds?: string[] }> {
  const { owner, url, store, fetcher, isCurrent } = options;
  const now = options.now ?? Date.now;
  const requestedAt = now();
  if (!owner || !isDriverRead(url)) throw new DriverReadError("Sign in to load driver data.");
  const check = () => { if (!isCurrent()) throw new DriverReadError("Driver account changed.", 401); };
  try {
    const response = await fetcher(url, { cache: "no-store", signal: AbortSignal.timeout(12_000) });
    check();
    if (!response.ok) {
      if (response.status < 500) {
        await store.remove(owner, url).catch(() => {});
        throw new DriverReadError("Driver data is no longer available. Please reconnect or sign in again.", response.status);
      }
      throw new Error("Server unavailable");
    }
    const data = await response.json() as T;
    check();
    const savedAt = requestedAt;
    let durable = true;
    try { await store.put({ owner, url, savedAt, data }); } catch { durable = false; }
    check();
    return { data, cached: false, savedAt, durable };
  } catch (error) {
    check();
    if (error instanceof DriverReadError) throw error;
    const snapshot = await store.get<T>(owner, url).catch(() => undefined);
    check();
    if (!snapshot || snapshot.owner !== owner || snapshot.url !== url || now() - snapshot.savedAt > MAX_SNAPSHOT_AGE || snapshot.savedAt > now()) {
      throw new DriverReadError("No saved data on this phone. Connect to load it first.");
    }
    return { data: snapshot.data, cached: true, savedAt: snapshot.savedAt, durable: true, reflectedAt: snapshot.reflectedAt,
      reflectedEventIds: snapshot.accepted?.map((item) => item.event.clientId) };
  }
}

/** A crash can occur after the accepted projection commits but before the
 * queue row is deleted. Do not project that same event a second time. */
export function unreflectedEvents<T extends { clientId: string }>(events: T[], reflectedIds: string[] = []): T[] {
  const reflected = new Set(reflectedIds);
  return events.filter((event) => !reflected.has(event.clientId));
}
