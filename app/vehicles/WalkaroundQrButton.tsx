"use client";

/*
  Prints the cab sticker for a vehicle's walkaround QR code. The server issues
  a fresh token on every click (POST /api/vehicles/[id]/walkaround-qr), which
  overwrites the stored hash and invalidates any earlier sticker, so a
  reissue while one already exists is confirmed first.

  The payload and the rendered QR image live only in this function's local
  variables and the print window's DOM: nothing is written to localStorage,
  sessionStorage or component state, so nothing survives the print window
  closing.
*/

import { useState } from "react";
import QRCode from "qrcode";
import Button from "../../components/Button";

const REISSUE_CONFIRM = "Printing a new code stops the old sticker working. Continue?";

/* No HTML injection: the registration is printed into a window built from a
   raw HTML string, so it must be escaped before it goes anywhere near a tag
   or attribute. */
function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function printDocument(qrDataUrl: string, registration: string): string {
  const safeRegistration = escapeHtml(registration);
  return `<!doctype html>
<html>
<head>
<meta charset="utf-8" />
<title>Cab QR code - ${safeRegistration}</title>
<style>
  body { font-family: Arial, Helvetica, sans-serif; text-align: center; color: #000; background: #fff; padding: 40px 20px; }
  img { width: 320px; height: 320px; }
  h1 { font-size: 34px; letter-spacing: 0.05em; margin: 20px 0 6px; }
  p { font-size: 14px; margin: 4px 0; }
</style>
</head>
<body>
  <img src="${qrDataUrl}" alt="Walkaround check QR code" />
  <h1>${safeRegistration}</h1>
  <p>Scan at the start of every shift. TMS Wizzard walkaround check.</p>
</body>
</html>`;
}

export default function WalkaroundQrButton({
  vehicleId,
  registration,
  hasExistingCode,
}: {
  vehicleId: string;
  registration: string;
  hasExistingCode: boolean;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function printCode() {
    if (hasExistingCode && !window.confirm(REISSUE_CONFIRM)) return;
    setBusy(true);
    setError("");
    try {
      const response = await fetch(`/api/vehicles/${vehicleId}/walkaround-qr`, { method: "POST" });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body?.error || "Unable to issue a QR code.");

      const payload = typeof body.payload === "string" ? body.payload : "";
      if (!payload) throw new Error("Unable to issue a QR code.");
      const printedRegistration =
        typeof body.registration === "string" && body.registration.trim() ? body.registration : registration;

      const qrDataUrl = await QRCode.toDataURL(payload, { errorCorrectionLevel: "M", margin: 2, width: 512 });

      const printWindow = window.open("", "_blank");
      if (!printWindow) throw new Error("Allow pop-ups for this site to print the QR code.");
      printWindow.document.write(printDocument(qrDataUrl, printedRegistration));
      printWindow.document.close();
      printWindow.focus();
      printWindow.print();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to issue a QR code.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="inline-flex flex-col items-start gap-1">
      <Button variant="secondary" size="sm" type="button" disabled={busy} onClick={() => void printCode()}>
        {busy ? "Preparing..." : "Print cab QR code"}
      </Button>
      {error ? <span className="text-xs text-danger-strong">{error}</span> : null}
    </div>
  );
}
