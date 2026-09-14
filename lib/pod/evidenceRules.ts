/*
  What evidence may be uploaded, shared by the office and driver upload routes.

  Uploads go straight from the browser to storage through a signed upload URL
  (review POD-2: Vercel refuses request bodies over 4.5 MB, so file bytes must
  not pass through a route handler). The route that issues the URL checks the
  declared type and size; the route that records the row re-checks the stored
  object's real size and leading bytes.
*/

import { validatePodPhotoContent } from "../driver/pod";

export const MAX_POD_EVIDENCE_BYTES = 15 * 1024 * 1024;

export const POD_PHOTO_MIME_TYPES = ["image/jpeg", "image/png", "image/webp", "image/heic"] as const;

export const POD_DOCUMENT_MIME_TYPES = [
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ...POD_PHOTO_MIME_TYPES,
] as const;

export type PodEvidenceType = "photo" | "document";

export type EvidenceCheck = { ok: true } | { ok: false; status: 400 | 413 | 415; message: string };

export function validateEvidenceMetadata(input: {
  evidenceType: unknown;
  mimeType: unknown;
  size: unknown;
}): EvidenceCheck {
  if (input.evidenceType !== "photo" && input.evidenceType !== "document") {
    return { ok: false, status: 400, message: "Unknown evidence type." };
  }
  const size = typeof input.size === "number" ? input.size : Number.NaN;
  if (!Number.isFinite(size) || size <= 0) {
    return { ok: false, status: 400, message: "The file is empty." };
  }
  if (size > MAX_POD_EVIDENCE_BYTES) {
    return { ok: false, status: 413, message: "The file exceeds the 15 MB POD upload limit." };
  }
  const allowed: readonly string[] = input.evidenceType === "photo" ? POD_PHOTO_MIME_TYPES : POD_DOCUMENT_MIME_TYPES;
  if (typeof input.mimeType !== "string" || !allowed.includes(input.mimeType)) {
    return {
      ok: false,
      status: 415,
      message: input.evidenceType === "photo" ? "Use a JPEG, PNG, WebP or HEIC photo." : "Use a PDF, Word document or photo.",
    };
  }
  return { ok: true };
}

function startsWith(bytes: Uint8Array, signature: number[]): boolean {
  return bytes.length >= signature.length && signature.every((value, index) => bytes[index] === value);
}

/** Leading-bytes check for a stored object against its declared type. */
export function validateEvidenceContent(bytes: Uint8Array, mimeType: string): EvidenceCheck {
  if ((POD_PHOTO_MIME_TYPES as readonly string[]).includes(mimeType)) {
    return validatePodPhotoContent({ bytes, mimeType });
  }
  const ok =
    (mimeType === "application/pdf" && startsWith(bytes, [0x25, 0x50, 0x44, 0x46])) ||
    (mimeType === "application/msword" && startsWith(bytes, [0xd0, 0xcf, 0x11, 0xe0])) ||
    (mimeType === "application/vnd.openxmlformats-officedocument.wordprocessingml.document" && startsWith(bytes, [0x50, 0x4b, 0x03, 0x04]));
  return ok ? { ok: true } : { ok: false, status: 415, message: "The uploaded file does not match its declared type." };
}
