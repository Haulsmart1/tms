export const MAX_POD_PHOTO_SIZE_BYTES =
  15 * 1024 * 1024;

const ALLOWED_POD_PHOTO_MIME_TYPES =
  new Set([
    "image/jpeg",
    "image/png",
    "image/webp",
    "image/heic",
  ]);

type ValidationErrorStatus =
  | 400
  | 413
  | 415;

type ValidationError = {
  ok: false;
  status: ValidationErrorStatus;
  message: string;
};

type PhotoValidationResult =
  | {
      ok: true;
    }
  | ValidationError;

export function validatePodPhotoMetadata({
  size,
  mimeType,
}: {
  size: number;
  mimeType: string | null | undefined;
}): PhotoValidationResult {
  if (size <= 0) {
    return {
      ok: false,
      status: 400,
      message:
        "The uploaded photo is empty.",
    };
  }

  if (
    size >
    MAX_POD_PHOTO_SIZE_BYTES
  ) {
    return {
      ok: false,
      status: 413,
      message:
        "The POD photo exceeds the 15 MB limit.",
    };
  }

  if (
    !mimeType ||
    !ALLOWED_POD_PHOTO_MIME_TYPES.has(
      mimeType,
    )
  ) {
    return {
      ok: false,
      status: 415,
      message:
        "Use a JPEG, PNG, WebP or HEIC photo.",
    };
  }

  return {
    ok: true,
  };
}

type CompletionValidationResult =
  | {
      ok: true;
      recipientName: string;
      podNotes: string | null;
    }
  | {
      ok: false;
      status: 400;
      message: string;
    };

export function validatePodCompletion({
  recipientName,
  podNotes,
  evidenceCount,
  legacyPhotoUrl,
}: {
  recipientName: unknown;
  podNotes: unknown;
  evidenceCount: number;
  legacyPhotoUrl:
    | string
    | null
    | undefined;
}): CompletionValidationResult {
  const normalizedRecipient =
    typeof recipientName === "string"
      ? recipientName.trim()
      : "";

  const normalizedNotes =
    typeof podNotes === "string"
      ? podNotes.trim()
      : "";

  if (!normalizedRecipient) {
    return {
      ok: false,
      status: 400,
      message:
        "Recipient name is required.",
    };
  }

  if (
    normalizedRecipient.length >
    200
  ) {
    return {
      ok: false,
      status: 400,
      message:
        "Recipient name is too long.",
    };
  }

  if (
    normalizedNotes.length >
    4000
  ) {
    return {
      ok: false,
      status: 400,
      message:
        "POD notes are too long.",
    };
  }

  const hasLegacyPhoto =
    typeof legacyPhotoUrl ===
      "string" &&
    legacyPhotoUrl.trim().length > 0;

  if (
    evidenceCount <= 0 &&
    !hasLegacyPhoto
  ) {
    return {
      ok: false,
      status: 400,
      message:
        "Upload at least one POD photo before completing this delivery.",
    };
  }

  return {
    ok: true,
    recipientName:
      normalizedRecipient,
    podNotes:
      normalizedNotes || null,
  };
}

export function areAllDeliveryStopsDelivered(
  stops: ReadonlyArray<{
    pod_status:
      | string
      | null;
  }>,
): boolean {
  return (
    stops.length > 0 &&
    stops.every(
      (stop) =>
        stop.pod_status ===
        "delivered",
    )
  );
}
export function validatePodPhotoContent({
  bytes,
  mimeType,
}: {
  bytes: Uint8Array;
  mimeType: string;
}): PhotoValidationResult {
  const jpeg =
    bytes.length >= 3 &&
    bytes[0] === 0xff &&
    bytes[1] === 0xd8 &&
    bytes[2] === 0xff;

  const png =
    bytes.length >= 8 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47 &&
    bytes[4] === 0x0d &&
    bytes[5] === 0x0a &&
    bytes[6] === 0x1a &&
    bytes[7] === 0x0a;

  const webp =
    bytes.length >= 12 &&
    ascii(bytes, 0, 4) === "RIFF" &&
    ascii(bytes, 8, 12) === "WEBP";

  const heicBrands =
    new Set([
      "heic",
      "heix",
      "hevc",
      "hevx",
      "mif1",
      "msf1",
    ]);

  const heic =
    bytes.length >= 12 &&
    ascii(bytes, 4, 8) === "ftyp" &&
    heicBrands.has(
      ascii(bytes, 8, 12),
    );

  const matchesMime =
    (mimeType === "image/jpeg" && jpeg) ||
    (mimeType === "image/png" && png) ||
    (mimeType === "image/webp" && webp) ||
    (mimeType === "image/heic" && heic);

  if (!matchesMime) {
    return {
      ok: false,
      status: 415,
      message:
        "The uploaded file does not match its declared image type.",
    };
  }

  return {
    ok: true,
  };
}

function ascii(
  bytes: Uint8Array,
  start: number,
  end: number,
): string {
  return String.fromCharCode(
    ...bytes.slice(start, end),
  );
}
