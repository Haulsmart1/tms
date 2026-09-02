"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import {
  BrowserMultiFormatOneDReader,
  type IScannerControls,
} from "@zxing/browser";
import {
  CAMERA_SCAN_FORMAT,
  cameraAccessErrorMessage,
  createCameraDecodeGate,
  stopMediaTracks,
  type BarcodeSubmitResult,
  type CameraScanFormat,
} from "../../../../lib/driver/cameraBarcode";

type ScannerState =
  | "idle"
  | "starting"
  | "scanning"
  | "submitting"
  | "success"
  | "error";

type Props = {
  disabled?: boolean;
  onScan: (
    serialNumber: string,
    scanFormat: CameraScanFormat,
  ) => Promise<BarcodeSubmitResult>;
};

export default function CameraBarcodeScanner({
  disabled = false,
  onScan,
}: Props) {
  const videoRef =
    useRef<HTMLVideoElement | null>(
      null,
    );

  const controlsRef =
    useRef<IScannerControls | null>(
      null,
    );

  const decodeGateRef =
    useRef(
      createCameraDecodeGate(),
    );

  const onScanRef =
    useRef(onScan);

  const [open, setOpen] =
    useState(false);

  const [scanCycle, setScanCycle] =
    useState(0);

  const [state, setState] =
    useState<ScannerState>("idle");

  const [statusMessage, setStatusMessage] =
    useState("");

  const [lastSerial, setLastSerial] =
    useState("");

  useEffect(() => {
    onScanRef.current = onScan;
  }, [onScan]);

  const stopCamera =
    useCallback(() => {
      const controls =
        controlsRef.current;

      controlsRef.current = null;

      try {
        controls?.stop();
      } catch {
        // Camera tracks are also stopped below.
      }

      const video =
        videoRef.current;

      if (!video) {
        return;
      }

      const stream =
        video.srcObject;

      if (
        stream &&
        "getTracks" in stream
      ) {
        stopMediaTracks(
          stream as MediaStream,
        );
      }

      video.srcObject = null;
    }, []);

  useEffect(() => {
    if (!open) {
      return;
    }

    let cancelled = false;

    decodeGateRef.current.reset();
    setStatusMessage("");
    setLastSerial("");
    setState("starting");

    async function beginScanning() {
      if (
        !navigator.mediaDevices ||
        typeof navigator.mediaDevices
          .getUserMedia !== "function"
      ) {
        if (!cancelled) {
          setState("error");
          setStatusMessage(
            "Camera scanning is unavailable on this browser. Enter the serial manually.",
          );
        }

        return;
      }

      const video =
        videoRef.current;

      if (!video) {
        if (!cancelled) {
          setState("error");
          setStatusMessage(
            "The camera preview could not be started. Enter the serial manually.",
          );
        }

        return;
      }

      const reader =
        new BrowserMultiFormatOneDReader(
          undefined,
          {
            delayBetweenScanAttempts: 300,
          },
        );

      try {
        const controls =
          await reader.decodeFromConstraints(
            {
              audio: false,
              video: {
                facingMode: {
                  ideal:
                    "environment",
                },
              },
            },
            video,
            (
              result,
              _error,
              callbackControls,
            ) => {
              if (
                cancelled ||
                !result ||
                !decodeGateRef.current
                  .tryLock()
              ) {
                return;
              }

              const decodedValue =
                result.getText();

              callbackControls.stop();

              const activeStream =
                video.srcObject;

              if (
                activeStream &&
                "getTracks" in activeStream
              ) {
                stopMediaTracks(
                  activeStream as MediaStream,
                );
              }

              video.srcObject = null;

              setLastSerial(
                decodedValue,
              );
              setState(
                "submitting",
              );
              setStatusMessage(
                "Barcode detected. Verifying item...",
              );

              void (async () => {
                try {
                  const outcome =
                    await onScanRef.current(
                      decodedValue,
                      CAMERA_SCAN_FORMAT,
                    );

                  if (cancelled) {
                    return;
                  }

                  setState(
                    outcome.ok
                      ? "success"
                      : "error",
                  );

                  setStatusMessage(
                    outcome.message,
                  );
                } catch (
                  scanError
                ) {
                  if (cancelled) {
                    return;
                  }

                  setState("error");
                  setStatusMessage(
                    scanError instanceof
                      Error
                      ? scanError.message
                      : "Unable to verify this item.",
                  );
                }
              })();
            },
          );

        if (cancelled) {
          controls.stop();
          return;
        }

        controlsRef.current =
          controls;

        setState(
          decodeGateRef.current
            .isLocked()
            ? "submitting"
            : "scanning",
        );
      } catch (cameraError) {
        if (cancelled) {
          return;
        }

        stopCamera();

        setState("error");
        setStatusMessage(
          cameraAccessErrorMessage(
            cameraError,
          ),
        );
      }
    }

    void beginScanning();

    return () => {
      cancelled = true;
      stopCamera();
    };
  }, [
    open,
    scanCycle,
    stopCamera,
  ]);

  function closeScanner() {
    stopCamera();
    setOpen(false);
    setState("idle");
    setStatusMessage("");
    setLastSerial("");
  }

  function scanAgain() {
    stopCamera();
    decodeGateRef.current.reset();
    setStatusMessage("");
    setLastSerial("");
    setScanCycle(
      (current) =>
        current + 1,
    );
  }

  if (!open) {
    return (
      <button
        type="button"
        disabled={disabled}
        onClick={() => {
          setState("starting");
          setOpen(true);
        }}
        className="mt-2 min-h-12 w-full rounded-xl border border-blue-700 bg-white px-4 text-sm font-black text-blue-800 disabled:opacity-50"
      >
        Scan with camera
      </button>
    );
  }

  const canScanAgain =
    state === "success" ||
    state === "error";

  return (
    <div className="mt-3 rounded-2xl border border-slate-300 bg-slate-950 p-3 text-white">
      <div className="flex items-center justify-between gap-3">
        <div>
          <div className="text-sm font-black">
            Camera barcode scanner
          </div>

          <div className="mt-1 text-xs text-slate-300">
            Point the rear camera at the Code 128 barcode.
          </div>
        </div>

        <button
          type="button"
          onClick={closeScanner}
          className="min-h-10 rounded-lg border border-slate-600 px-3 text-xs font-black text-white"
        >
          Close
        </button>
      </div>

      <div className="mt-3 overflow-hidden rounded-xl bg-black">
        <video
          ref={videoRef}
          autoPlay
          muted
          playsInline
          className="aspect-[4/3] w-full object-cover"
        />
      </div>

      <div
        className="mt-3 rounded-xl bg-slate-900 p-3 text-sm"
        role="status"
        aria-live="polite"
      >
        {state === "starting"
          ? "Starting camera..."
          : null}

        {state === "scanning"
          ? "Scanning for a barcode..."
          : null}

        {state === "submitting"
          ? statusMessage ||
            "Verifying item..."
          : null}

        {state === "success"
          ? statusMessage
          : null}

        {state === "error"
          ? statusMessage
          : null}

        {lastSerial ? (
          <div className="mt-2 break-all font-mono text-xs text-slate-300">
            Detected: {lastSerial}
          </div>
        ) : null}
      </div>

      {canScanAgain ? (
        <button
          type="button"
          disabled={disabled}
          onClick={scanAgain}
          className="mt-3 min-h-12 w-full rounded-xl bg-blue-600 px-4 text-sm font-black text-white disabled:opacity-50"
        >
          Scan again
        </button>
      ) : null}

      <p className="mt-3 text-xs text-slate-300">
        If camera access is unavailable, close the scanner and enter the serial manually.
      </p>
    </div>
  );
}
