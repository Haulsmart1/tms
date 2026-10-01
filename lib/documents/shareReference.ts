import { isUuid } from "../uuid";

/* What document_delivery_log.share_reference may hold.

   Review finding M-3 (2026-09-22): both share-link designs store only a hash
   of their token, and then the two email routes wrote the FULL share URL,
   token included, into the delivery log. The log is readable by every member
   of the tenant, so the hashing was cosmetic for any link that was emailed.

   A reference is a pointer to the share row, never the credential:
     pod_share:<sha256 hex>        the pod_share_links.token_hash column
     quotation_share:<uuid>        the quotation_share_links.id column
   sendLoggedDocumentEmail runs assertOpaqueShareReference before it inserts,
   so a caller that regresses to passing the URL fails loudly instead of
   leaking. */

const SHA256_HEX = /^[0-9a-f]{64}$/;

// pod_ plus 43 base64url characters is the shape generatePodShareToken mints.
const LOOKS_LIKE_POD_TOKEN = /^pod_[A-Za-z0-9_-]{43}$/;

export function assertOpaqueShareReference(reference: string | null | undefined): string | null {
  if (reference == null) return null;
  if (
    reference.includes("://") ||
    reference.includes("/share/") ||
    LOOKS_LIKE_POD_TOKEN.test(reference)
  ) {
    throw new Error(
      "share_reference must be an opaque row reference, not a share URL or token",
    );
  }
  return reference;
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
