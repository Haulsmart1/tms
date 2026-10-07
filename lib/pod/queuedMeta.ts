/*
  The three fields an offline-queued POD request carries (driver app queue,
  app/driver/driverQueue.ts). A body with none of them comes from a page that
  sends directly, and the routes treat it exactly as before. Pure.
*/

import { isUuid } from "../uuid";

export type QueuedMeta = {
  /** Phone-generated id of this queued item. */
  clientId: string | null;
  /** Client id of the start check of the shift open on the phone when the item was queued. */
  shiftClientId: string | null;
  /** Phone clock, as sent. Whether to trust it is lib/pod/recordedTime.ts's decision. */
  recordedAt: string | null;
};

export function parseQueuedMeta(body: unknown): QueuedMeta | null {
  if (!body || typeof body !== "object") return null;
  const b = body as Record<string, unknown>;
  if (b.clientId === undefined && b.shiftClientId === undefined && b.recordedAt === undefined) return null;
  return {
    clientId: typeof b.clientId === "string" && isUuid(b.clientId) ? b.clientId : null,
    shiftClientId: typeof b.shiftClientId === "string" && isUuid(b.shiftClientId) ? b.shiftClientId : null,
    recordedAt: typeof b.recordedAt === "string" ? b.recordedAt : null,
  };
}

/**
  True when the body tried to name a client id but it was not a UUID. Routes
  answer 400 "Invalid clientId." for this rather than treating the request as
  unqueued, which would lose the idempotency the id exists for.
*/
export function hasInvalidClientId(body: unknown, meta: QueuedMeta | null): boolean {
  if (!body || typeof body !== "object") return false;
  return (body as Record<string, unknown>).clientId !== undefined && (meta === null || meta.clientId === null);
}
