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

/**
 * `manualEntry` names what the person can type instead: "serial" on the POD
 * item scanner, "registration" on the walkaround cab QR scanner.
 */
export function cameraAccessErrorMessage(
  error: unknown,
  manualEntry = "serial",
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
      `in your browser settings, or enter the ${manualEntry} manually.`
    );
  }

  if (
    name === "NotFoundError" ||
    name === "DevicesNotFoundError"
  ) {
    return (
      `No usable camera was found. Enter the ${manualEntry} manually.`
    );
  }

  if (
    name === "NotReadableError" ||
    name === "TrackStartError"
  ) {
    return (
      "The camera could not be started. It may already be in " +
      `use by another app. You can enter the ${manualEntry} manually.`
    );
  }

  return (
    "Camera scanning is unavailable on this device or browser. " +
    `You can enter the ${manualEntry} manually.`
  );
}
