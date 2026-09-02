"use client";

export const CAMERA_SCAN_FORMAT =
  "code_128" as const;

export type CameraScanFormat =
  typeof CAMERA_SCAN_FORMAT;

export type BarcodeSubmitResult = {
  ok: boolean;
  duplicate: boolean;
  message: string;
};

type ScanResponse = {
  ok?: boolean;
  duplicate?: boolean;
  message?: string;
  error?: string;
};

export type FetchLike = (
  input: string,
  init?: RequestInit,
) => Promise<Response>;

export type MediaStreamLike = {
  getTracks: () => Array<{
    stop: () => void;
  }>;
};

export type CameraDecodeGate = {
  tryLock: () => boolean;
  reset: () => void;
  isLocked: () => boolean;
};

export function createCameraDecodeGate():
  CameraDecodeGate {
  let locked = false;

  return {
    tryLock() {
      if (locked) {
        return false;
      }

      locked = true;
      return true;
    },

    reset() {
      locked = false;
    },

    isLocked() {
      return locked;
    },
  };
}

export function stopMediaTracks(
  stream:
    | MediaStreamLike
    | null
    | undefined,
): void {
  if (!stream) {
    return;
  }

  for (const track of stream.getTracks()) {
    track.stop();
  }
}

export function cameraAccessErrorMessage(
  error: unknown,
): string {
  const name =
    error &&
    typeof error === "object" &&
    "name" in error &&
    typeof error.name === "string"
      ? error.name
      : "";

  if (
    name === "NotAllowedError" ||
    name === "SecurityError"
  ) {
    return (
      "Camera permission was denied. Allow camera access " +
      "in your browser settings, or enter the serial manually."
    );
  }

  if (
    name === "NotFoundError" ||
    name === "DevicesNotFoundError"
  ) {
    return (
      "No usable camera was found. Enter the serial manually."
    );
  }

  if (
    name === "NotReadableError" ||
    name === "TrackStartError"
  ) {
    return (
      "The camera could not be started. It may already be in " +
      "use by another app. You can enter the serial manually."
    );
  }

  return (
    "Camera scanning is unavailable on this device or browser. " +
    "You can enter the serial manually."
  );
}

export async function submitBarcodeScan(
  fetcher: FetchLike,
  endpoint: string,
  serialNumber: string,
  scanFormat: string,
): Promise<BarcodeSubmitResult> {
  const response =
    await fetcher(endpoint, {
      method: "POST",
      headers: {
        "Content-Type":
          "application/json",
      },
      body: JSON.stringify({
        serial_number:
          serialNumber,
        scan_format:
          scanFormat,
      }),
    });

  let body: ScanResponse = {};

  try {
    body =
      (await response.json()) as ScanResponse;
  } catch {
    body = {};
  }

  if (!response.ok) {
    throw new Error(
      body.error ||
        "Unable to verify this item.",
    );
  }

  const duplicate =
    body.duplicate === true;

  return {
    ok: true,
    duplicate,
    message:
      body.message ||
      (duplicate
        ? "Already verified on this job."
        : "Item verified."),
  };
}
