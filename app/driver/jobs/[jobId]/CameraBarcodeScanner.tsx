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
  open: "Scan with camera",
  title: "Camera barcode scanner",
  aim: "Point the rear camera at the Code 128 barcode.",
  scanning: "Scanning for a barcode...",
  checking: "Barcode detected. Verifying item...",
  manualEntry: "serial",
  footer: "If camera access is unavailable, close the scanner and enter the serial manually.",
};

export default function CameraBarcodeScanner({ disabled = false, onScan }: Props) {
  const handleScan = useCallback((text: string) => onScan(text, CAMERA_SCAN_FORMAT), [onScan]);
  return <CameraScanner mode="barcode" copy={COPY} disabled={disabled} onScan={handleScan} />;
}
