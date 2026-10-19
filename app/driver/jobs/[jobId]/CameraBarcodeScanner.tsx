"use client";
/*
  The POD item serial scanner: the shared camera scanner (app/driver/CameraScanner.tsx)
  in Code 128 mode, with the serial-specific wording.
*/

import { useCallback } from "react";
import { CAMERA_SCAN_FORMAT, type BarcodeSubmitResult, type CameraScanFormat } from "../../../../lib/driver/cameraBarcode";
import CameraScanner, { type ScannerCopy } from "../../CameraScanner";

type Props = {
  disabled?: boolean;
  onScan: (serialNumber: string, scanFormat: CameraScanFormat) => Promise<BarcodeSubmitResult>;
};

const COPY: ScannerCopy = {
  open: "Open camera scanner",
  title: "Match item barcode",
  aim: "Point the rear camera at the Code 128 barcode.",
  scanning: "Scanning for a barcode...",
  checking: "Barcode detected. Verifying item...",
  manualEntry: "serial",
  footer: "Match the item’s Code 128 serial, not the job reference. If the camera is unavailable, close this scanner and enter the serial manually below.",
};

export default function CameraBarcodeScanner({ disabled = false, onScan }: Props) {
  const handleScan = useCallback((text: string) => onScan(text, CAMERA_SCAN_FORMAT), [onScan]);
  return <CameraScanner mode="barcode" copy={COPY} disabled={disabled} onScan={handleScan} />;
}
