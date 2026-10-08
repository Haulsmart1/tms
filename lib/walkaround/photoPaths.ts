/*
  Pure rules for recording a walkaround defect photo (the two photo routes
  under app/api/driver/walkaround/photos). The cap is checked when the upload
  URL is issued and again when the photo is recorded, because several uploads
  can be started before any of them is recorded.
*/

import { POD_PHOTO_MIME_TYPES, validateEvidenceContent, type EvidenceCheck } from "../pod/evidenceRules";

export const MAX_PHOTOS_PER_DEFECT = 5;

/** The largest walkaround defect photo, checked on the declared size and again on the stored bytes. */
export const MAX_WALKAROUND_PHOTO_BYTES = 10 * 1024 * 1024;

/** Accepted photo types and the extension the server gives each one's path. */
export const WALKAROUND_PHOTO_EXTENSIONS: Readonly<Record<string, string>> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/heic": "heic",
};

/**
  The declared type of a stored photo, read back from the extension the
  upload-url route chose for its path. Null for any other extension.
*/
export function walkaroundPhotoMimeType(path: string): string | null {
  const ext = path.slice(path.lastIndexOf(".") + 1).toLowerCase();
  const found = Object.entries(WALKAROUND_PHOTO_EXTENSIONS).find(([, e]) => e === ext);
  return found ? found[0] : null;
}

/*
  The stored object's real size and leading bytes against its declared photo
  type (security scan S-18: the bucket's MIME list only sees the type the
  client declares). Photo types only: the POD document types are refused.
*/
export function validateWalkaroundPhotoBytes(bytes: Uint8Array, mimeType: string | null): EvidenceCheck {
  if (!mimeType || !(POD_PHOTO_MIME_TYPES as readonly string[]).includes(mimeType)) {
    return { ok: false, status: 415, message: "Use a JPEG, PNG, WebP or HEIC photo." };
  }
  if (bytes.byteLength === 0 || bytes.byteLength > MAX_WALKAROUND_PHOTO_BYTES) {
    return { ok: false, status: 413, message: "The photo is empty or larger than 10 MB." };
  }
  return validateEvidenceContent(bytes, mimeType);
}

/** True when `path` sits in the folder the upload-url route builds for this check: <tenant>/<check>/<defect client id>/<file>. */
export function isCheckPhotoPath(path: string, tenantId: string, checkId: string, defectClientId: string): boolean {
  const prefix = `${tenantId}/${checkId}/${defectClientId}/`;
  if (!path.startsWith(prefix) || path.includes("..")) return false;
  const file = path.slice(prefix.length);
  return file.length > 0 && !file.includes("/");
}

/** The record route's 409 when another photo was recorded at the same moment. The driver queue retries it. */
export const PHOTO_RACE_MESSAGE = "Try again.";

export type PhotoAppendDecision = "already" | "full" | "append";

/** What to do with `path` given the paths already on the defect. A repeat is idempotent, even at the cap. */
export function photoAppendDecision(current: readonly string[], path: string): PhotoAppendDecision {
  if (current.includes(path)) return "already";
  if (current.length >= MAX_PHOTOS_PER_DEFECT) return "full";
  return "append";
}

/*
  A Postgres text[] literal for a PostgREST equality filter, so an update only
  applies when photo_paths is still exactly what was read. Every element is
  quoted, so commas, braces and spaces in a path cannot change its meaning.
*/
export function postgresTextArray(values: readonly string[]): string {
  const escape = (v: string) => v.replaceAll("\\", "\\\\").replaceAll('"', '\\"');
  const quoted = values.map((v) => '"' + escape(v) + '"');
  return `{${quoted.join(",")}}`;
}
