import { isUuid } from "../uuid";

/* What document_delivery_log.share_reference may hold.

   Review finding M-3 (2026-09-22): both share-link designs store only a hash
   of their token, and then the two email routes wrote the FULL share URL,
   token included, into the delivery log. The log is readable by every member
   of the tenant, so the hashing was cosmetic for any link that was emailed.

   A reference is a pointer to the share row, never the credential:
     pod_share:<sha256 hex>        the pod_share_links.token_hash column
     quotation_share:<uuid>        the quotation_share_links.id column
     tracking_share:<sha256 hex>   the stop_tracking_links.token_hash column
   sendLoggedDocumentEmail runs assertOpaqueShareReference before it inserts,
   so a caller that regresses to passing the URL fails loudly instead of
   leaking. */

const SHA256_HEX = /^[0-9a-f]{64}$/;

const HASH_REFERENCE = /^(pod_share|tracking_share):[0-9a-f]{64}$/;

/* An allowlist, not a blocklist: only the shapes the builders below produce
   may be stored, so a new token or URL format can never slip through. */
export function assertOpaqueShareReference(reference: string | null | undefined): string | null {
  if (reference == null) return null;
  const quotation = /^quotation_share:(.+)$/.exec(reference);
  if (HASH_REFERENCE.test(reference) || (quotation && isUuid(quotation[1]))) return reference;
  throw new Error(
    "share_reference must be an opaque row reference, not a share URL or token",
  );
}

export function podShareReference(tokenHash: string): string {
  if (!SHA256_HEX.test(tokenHash)) {
    throw new Error("podShareReference expects the stored token hash");
  }
  return `pod_share:${tokenHash}`;
}

export function quotationShareReference(shareLinkId: string): string {
  if (!isUuid(shareLinkId)) {
    throw new Error("quotationShareReference expects the share link uuid");
  }
  return `quotation_share:${shareLinkId}`;
}

export function trackingShareReference(tokenHash: string): string {
  if (!SHA256_HEX.test(tokenHash)) {
    throw new Error("trackingShareReference expects the stored token hash");
  }
  return `tracking_share:${tokenHash}`;
}
