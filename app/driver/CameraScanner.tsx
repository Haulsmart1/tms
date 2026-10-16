"use client";
/*
  The rear-camera scanner shared by the driver pages (fixed light palette,
  like /driver/jobs/[jobId]). `mode` picks the decoder: Code 128 barcodes for
  POD item serials (jobs/[jobId]/CameraBarcodeScanner.tsx wraps this), QR for
  the walkaround cab code. It decodes one code, stops the camera and hands
  the text to `onScan`, whose answer it shows; "Scan again" restarts it.
*/

import { useCallback, useEffect, useRef, useState } from "react";
import { BrowserMultiFormatOneDReader, BrowserQRCodeReader, type IScannerControls } from "@zxing/browser";
import { cameraAccessErrorMessage, createCameraDecodeGate, stopMediaTracks } from "../../lib/driver/cameraBarcode";

export type ScanAnswer = { ok: boolean; message: string };

export type ScannerCopy = {
  /** The button that opens the camera. */
  open: string;
  title: string;
  /** Under the title, e.g. "Point the rear camera at the Code 128 barcode." */
  aim: string;
  scanning: string;
  /** Shown while onScan runs. */
  checking: string;
  /** What can be typed instead, for the camera error messages ("serial", "registration"). */
  manualEntry: string;
  footer: string;
};

type ScannerState = "idle" | "starting" | "scanning" | "submitting" | "success" | "error";

type Props = {
  mode: "barcode" | "qr";
  copy: ScannerCopy;
  disabled?: boolean;
  onScan: (text: string) => Promise<ScanAnswer>;
};

function createReader(mode: Props["mode"]) {
  const options = { delayBetweenScanAttempts: 300 };
  return mode === "qr" ? new BrowserQRCodeReader(undefined, options) : new BrowserMultiFormatOneDReader(undefined, options);
}

export default function CameraScanner({ mode, copy, disabled = false, onScan }: Props) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const controlsRef = useRef<IScannerControls | null>(null);
  const decodeGateRef = useRef(createCameraDecodeGate());
  const onScanRef = useRef(onScan);
  const copyRef = useRef(copy);
  const [open, setOpen] = useState(false);
  const [scanCycle, setScanCycle] = useState(0);
  const [state, setState] = useState<ScannerState>("idle");
  const [statusMessage, setStatusMessage] = useState("");
  const [lastText, setLastText] = useState("");

  useEffect(() => {
    onScanRef.current = onScan;
    copyRef.current = copy;
  }, [onScan, copy]);

  const stopCamera = useCallback(() => {
    const controls = controlsRef.current;
    controlsRef.current = null;
    try {
      controls?.stop();
    } catch {
      // Camera tracks are also stopped below.
    }
    const video = videoRef.current;
    if (!video) return;
    const stream = video.srcObject;
    if (stream && "getTracks" in stream) stopMediaTracks(stream as MediaStream);
    video.srcObject = null;
  }, []);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    const manual = copyRef.current.manualEntry;

    decodeGateRef.current.reset();
    setStatusMessage("");
    setLastText("");
    setState("starting");

    async function beginScanning() {
      if (!navigator.mediaDevices || typeof navigator.mediaDevices.getUserMedia !== "function") {
        if (!cancelled) {
          setState("error");
          setStatusMessage(`Camera scanning is unavailable on this browser. Enter the ${manual} manually.`);
        }
        return;
      }
      const video = videoRef.current;
      if (!video) {
        if (!cancelled) {
          setState("error");
          setStatusMessage(`The camera preview could not be started. Enter the ${manual} manually.`);
        }
        return;
      }

      try {
        const controls = await createReader(mode).decodeFromConstraints(
          { audio: false, video: { facingMode: { ideal: "environment" } } },
          video,
          (result, _error, callbackControls) => {
            if (cancelled || !result || !decodeGateRef.current.tryLock()) return;
            const decoded = result.getText();
            callbackControls.stop();
            const activeStream = video.srcObject;
            if (activeStream && "getTracks" in activeStream) stopMediaTracks(activeStream as MediaStream);
            video.srcObject = null;

            setLastText(decoded);
            setState("submitting");
            setStatusMessage(copyRef.current.checking);

            void (async () => {
              try {
                const outcome = await onScanRef.current(decoded);
                if (cancelled) return;
                setState(outcome.ok ? "success" : "error");
                setStatusMessage(outcome.message);
              } catch (scanError) {
                if (cancelled) return;
                setState("error");
                setStatusMessage(scanError instanceof Error ? scanError.message : "Unable to check this code.");
              }
            })();
          },
        );
        if (cancelled) {
          controls.stop();
          return;
        }
        controlsRef.current = controls;
        setState(decodeGateRef.current.isLocked() ? "submitting" : "scanning");
      } catch (cameraError) {
        if (cancelled) return;
        stopCamera();
        setState("error");
        setStatusMessage(cameraAccessErrorMessage(cameraError, manual));
      }
    }

    void beginScanning();
    return () => {
      cancelled = true;
      stopCamera();
    };
  }, [open, scanCycle, stopCamera, mode]);

  function closeScanner() {
    stopCamera();
    setOpen(false);
    setState("idle");
    setStatusMessage("");
    setLastText("");
  }

  function scanAgain() {
    stopCamera();
    decodeGateRef.current.reset();
    setStatusMessage("");
    setLastText("");
    setScanCycle((current) => current + 1);
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
        className="mt-2 min-h-12 w-full rounded-xl border border-teal-700 bg-teal-700 px-4 text-sm font-bold text-white shadow-sm transition hover:border-teal-800 hover:bg-teal-800 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-teal-200 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {copy.open}
      </button>
    );
  }

  const canScanAgain = state === "success" || state === "error";

  return (
    <div className="mt-3 rounded-2xl border border-slate-200 bg-[#10243a] p-4 text-white shadow-lg">
      <div className="flex items-center justify-between gap-3">
        <div>
          <div className="text-sm font-bold tracking-wide">{copy.title}</div>
          <div className="mt-1 text-xs text-slate-300">{copy.aim}</div>
        </div>
        <button type="button" onClick={closeScanner} className="min-h-10 rounded-lg border border-slate-500 px-3 text-xs font-bold text-white transition hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-300">
          Close
        </button>
      </div>

      <div className="mt-3 overflow-hidden rounded-xl bg-black">
        <video ref={videoRef} autoPlay muted playsInline aria-label="Live camera preview for barcode scanning" className="aspect-[4/3] w-full object-cover" />
      </div>

      <div className={`mt-3 rounded-xl p-3 text-sm leading-relaxed ${state === "success" ? "bg-emerald-950 text-emerald-100" : state === "error" ? "bg-rose-950 text-rose-100" : "bg-slate-900 text-slate-100"}`} role="status" aria-live="polite" aria-busy={state === "starting" || state === "submitting"}>
        {state === "starting" ? "Starting camera..." : null}
        {state === "scanning" ? copy.scanning : null}
        {state === "submitting" ? statusMessage || copy.checking : null}
        {state === "success" || state === "error" ? statusMessage : null}
        {lastText ? <div className="mt-2 break-all font-mono text-xs text-slate-300">Detected: {lastText}</div> : null}
      </div>

      {canScanAgain ? (
        <button
          type="button"
          disabled={disabled}
          onClick={scanAgain}
          className="mt-3 min-h-12 w-full rounded-xl bg-teal-500 px-4 text-sm font-bold text-slate-950 shadow-sm transition hover:bg-teal-400 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-teal-200 disabled:cursor-not-allowed disabled:opacity-50"
        >
          Scan again
        </button>
      ) : null}

      <p className="mt-3 text-xs text-slate-300">{copy.footer}</p>
    </div>
  );
}
