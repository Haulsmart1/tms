/*
  Customer tracking links: the same design as POD share links
  (lib/pod/shareLinks.ts). A token is 32 random bytes with no meaning of its
  own; only its SHA-256 hash is stored, in stop_tracking_links
  (docs/sql/tracking_01_links_and_eta_cache.sql), with expiry and revocation,
  and every view re-checks the row, the stop and the job.

  Pure except for node:crypto; the store is lib/tracking/linkStore.ts.
*/

import { createHash, randomBytes } from "node:crypto";

const TOKEN_PREFIX = "trk_";
const TOKEN_RE = /^trk_[A-Za-z0-9_-]{43}$/;
const DAY_MS = 24 * 60 * 60 * 1000;
const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

export function generateTrackingToken(): string {
  return `${TOKEN_PREFIX}${randomBytes(32).toString("base64url")}`;
}

export function isWellFormedTrackingToken(token: unknown): token is string {
  return typeof token === "string" && TOKEN_RE.test(token);
}

export function hashTrackingToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

/**
  When a new link expires. With a planned date: the end of that day plus two
  more, taken at UTC midnight (at most an hour after London midnight in
  summer), but never less than 24 hours from now. With none: 7 days.
*/
export function trackingLinkExpiry(plannedDate: string | null, now: Date): string {
  const match = plannedDate ? DATE_RE.exec(plannedDate) : null;
  if (!match) return new Date(now.getTime() + 7 * DAY_MS).toISOString();
  const end = Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]) + 3);
  return new Date(Math.max(end, now.getTime() + DAY_MS)).toISOString();
}

export type TrackingLinkRow = { expires_at: string; revoked_at: string | null };

export function evaluateTrackingLink(row: TrackingLinkRow | null, now: Date): boolean {
  if (!row || row.revoked_at) return false;
  const expires = Date.parse(row.expires_at);
  return !Number.isNaN(expires) && expires > now.getTime();
}
