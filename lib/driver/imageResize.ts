/*
  Sizing rules for downscaling a POD photo on the phone before upload
  (review POD-2). A 50 MP camera writes 6 to 12 MB JPEGs; a POD needs a legible
  photo, not a print master, and drivers are on mobile data. The browser
  helper in app/driver/jobs/[jobId]/downscaleImage.ts applies these.
*/

export const POD_UPLOAD_MAX_EDGE = 2000;
export const POD_UPLOAD_JPEG_QUALITY = 0.8;
/** A JPEG already inside the size box and under this is sent as it is. */
export const POD_UPLOAD_KEEP_ORIGINAL_BYTES = 1_500_000;

export function targetImageSize(
  width: number,
  height: number,
  maxEdge = POD_UPLOAD_MAX_EDGE,
): { width: number; height: number; resized: boolean } {
  if (!(width > 0) || !(height > 0)) return { width: 0, height: 0, resized: false };
  const longest = Math.max(width, height);
  if (longest <= maxEdge) return { width: Math.round(width), height: Math.round(height), resized: false };
  const scale = maxEdge / longest;
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
    resized: true,
  };
}

export function shouldKeepOriginal(input: { mimeType: string; size: number; width: number; height: number }): boolean {
  return (
    input.mimeType === "image/jpeg" &&
    input.size <= POD_UPLOAD_KEEP_ORIGINAL_BYTES &&
    Math.max(input.width, input.height) <= POD_UPLOAD_MAX_EDGE
  );
}

export function jpegFilename(name: string | null | undefined): string {
  const base = String(name ?? "").trim().replace(/\.[a-zA-Z0-9]{1,5}$/, "");
  return `${base || "pod-photo"}.jpg`;
}
