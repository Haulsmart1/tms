/*
  POD share links: opaque, stored, revocable (review POD-9, POD-25, M2).

  The old token was a stateless 7-day HMAC over base64 JSON: it could not be
  revoked short of rotating the secret for every tenant, and anyone holding it
  could read the tenant and job ids inside. A token is now 32 random bytes with
  no meaning of its own. Only its SHA-256 hash is stored, in pod_share_links
  (docs/sql/prodfix_60_pod_share_links.sql), next to the tenant, job, expiry and
  revocation time, and every page view or PDF download re-checks that row, the
  job and the tenant.

  Tokens issued in the old HMAC format are deliberately NOT honoured any more:
  they fail the format check below and read as an invalid link.

  Pure except for node:crypto; the store is lib/pod/shareStore.ts.
*/

import { createHash, randomBytes } from "node:crypto";

export const POD_SHARE_LIFETIME_SECONDS = 7 * 24 * 60 * 60;
const TOKEN_PREFIX = "pod_";
const TOKEN_RE = /^pod_[A-Za-z0-9_-]{43}$/;

export function generatePodShareToken(): string {
  return `${TOKEN_PREFIX}${randomBytes(32).toString("base64url")}`;
}

export function isWellFormedPodShareToken(token: unknown): token is string {
  return typeof token === "string" && TOKEN_RE.test(token);
}

export function hashPodShareToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

export type PodShareRow = {
  expires_at: string;
  revoked_at: string | null;
};

export type PodShareVerdict = { ok: true } | { ok: false; reason: "missing" | "revoked" | "expired" };

export function evaluatePodShare(row: PodShareRow | null | undefined, now: Date): PodShareVerdict {
  if (!row) return { ok: false, reason: "missing" };
  if (row.revoked_at) return { ok: false, reason: "revoked" };
  const expires = Date.parse(row.expires_at);
  if (!Number.isFinite(expires) || expires <= now.getTime()) return { ok: false, reason: "expired" };
  return { ok: true };
}

/** A shared POD is only served while its job is still completed. */
export function isShareableJobStatus(status: unknown): boolean {
  return status === "completed";
}
