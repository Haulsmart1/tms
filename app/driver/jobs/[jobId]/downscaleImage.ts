/*
  Browser-only: shrink a POD photo before upload (review POD-2). Rules live in
  lib/driver/imageResize.ts. If the browser cannot decode the file (HEIC on
  most non-Apple browsers), the original is uploaded unchanged and the server
  still accepts it.
*/

import {
  POD_UPLOAD_JPEG_QUALITY,
  jpegFilename,
  shouldKeepOriginal,
  targetImageSize,
} from "../../../../lib/driver/imageResize";

export type PreparedPhoto = {
  blob: Blob;
  filename: string;
  mimeType: string;
};

function guessMimeType(file: File): string {
  if (file.type) return file.type;
  return /\.hei[cf]$/i.test(file.name) ? "image/heic" : "";
}

export async function preparePodPhoto(file: File): Promise<PreparedPhoto> {
  const mimeType = guessMimeType(file);
  const original: PreparedPhoto = { blob: file, filename: file.name || "pod-photo", mimeType };

  if (typeof createImageBitmap !== "function" || typeof document === "undefined") {
    return original;
  }

  let bitmap: ImageBitmap | null = null;

  try {
    bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });

    if (shouldKeepOriginal({ mimeType, size: file.size, width: bitmap.width, height: bitmap.height })) {
      return original;
    }

    const target = targetImageSize(bitmap.width, bitmap.height);

    if (target.width === 0) {
      return original;
    }

    const canvas = document.createElement("canvas");
    canvas.width = target.width;
    canvas.height = target.height;

    const context = canvas.getContext("2d");

    if (!context) {
      return original;
    }

    context.drawImage(bitmap, 0, 0, target.width, target.height);

    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, "image/jpeg", POD_UPLOAD_JPEG_QUALITY),
    );

    if (!blob || (mimeType === "image/jpeg" && blob.size >= file.size)) {
      return original;
    }

    return { blob, filename: jpegFilename(file.name), mimeType: "image/jpeg" };
  } catch {
    return original;
  } finally {
    bitmap?.close();
  }
}
