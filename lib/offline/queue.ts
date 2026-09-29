/*
  The driver app's offline queue, as pure state. Items are sent strictly in
  order (a break must not reach the server before the check that started the
  shift), so only the head is ever offered. Storage (IndexedDB) lives in
  lib/offline/idbStore.ts and is kept thin so this logic stays testable.

  Built for shift and walkaround events; written generically so POD saves can
  reuse it later.
*/

import { nextBackoffMs } from "../driver/gpsRetry";

export type QueueItem<T> = {
  id: string;
  payload: T;
  attempts: number;
  nextAttemptAt: number;
  lastError: string | null;
};

export type SendOutcome = { kind: "sent" } | { kind: "retry"; error: string } | { kind: "rejected"; error: string };

export function enqueue<T>(queue: readonly QueueItem<T>[], id: string, payload: T, now: number): QueueItem<T>[] {
  if (queue.some((i) => i.id === id)) return [...queue];
  return [...queue, { id, payload, attempts: 0, nextAttemptAt: now, lastError: null }];
}

export function nextDue<T>(queue: readonly QueueItem<T>[], now: number): QueueItem<T> | null {
  const head = queue[0];
  return head && head.nextAttemptAt <= now ? head : null;
}

export function applyOutcome<T>(
  queue: readonly QueueItem<T>[],
  id: string,
  outcome: SendOutcome,
  now: number,
): { queue: QueueItem<T>[]; rejected: QueueItem<T> | null } {
  const item = queue.find((i) => i.id === id);
  if (!item) return { queue: [...queue], rejected: null };
  const rest = queue.filter((i) => i.id !== id);

  if (outcome.kind === "sent") return { queue: rest, rejected: null };
  if (outcome.kind === "rejected") return { queue: rest, rejected: { ...item, lastError: outcome.error } };

  const retried = { ...item, attempts: item.attempts + 1, nextAttemptAt: now + nextBackoffMs(item.attempts), lastError: outcome.error };
  return { queue: queue.map((i) => (i.id === id ? retried : i)), rejected: null };
}

/** `status` is the HTTP status, or null when the request never got an answer. */
export function classifySyncFailure(status: number | null): "retry" | "stop" | "rejected" {
  if (status === null) return "retry";
  if (status === 401 || status === 403) return "stop";
  if (status === 408 || status === 425 || status === 429 || status >= 500) return "retry";
  return "rejected";
}
