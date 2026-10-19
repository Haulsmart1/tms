"use client";

import {
  useMemo,
  useRef,
  useState,
} from "react";
import CameraBarcodeScanner from "./CameraBarcodeScanner";
import {
  type BarcodeSubmitResult,
  type CameraScanFormat,
} from "../../../../lib/driver/cameraBarcode";
import { checkQueuedScan } from "../../../../lib/driver/offlinePod";
import { enqueuePodScan } from "../../driverQueue";

type JobItem = {
  id: string;
  sku: string | null;
  description: string | null;
  quantity: number;
  serial_numbers: string[] | null;
  external_reference: string | null;
  notes: string | null;
};

type JobItemScan = {
  id: string;
  stop_id: string;
  job_item_id: string;
  serial_number: string;
  scan_format: string | null;
  scanned_by: string | null;
  scanned_at: string;
};

export default function BarcodeVerification({
  jobId,
  stopId,
  items,
  scans,
  allPendingScans,
  paused,
}: {
  jobId: string;
  stopId: string;
  items: JobItem[];
  scans: JobItemScan[];
  /** Scans queued on this phone for any stop of this job, not yet sent. */
  allPendingScans: { job_item_id: string; serial_number: string }[];
  /** Set when the queue has stopped sending (session gone). */
  paused: string | null;
}) {
  const serializedItems =
    useMemo(
      () =>
        items
          .map((item) => ({
            ...item,
            expectedSerials:
              Array.from(
                new Set(
                  (
                    item.serial_numbers ??
                    []
                  )
                    .map(
                      (value) =>
                        value.trim(),
                    )
                    .filter(Boolean),
                ),
              ),
          }))
          .filter(
            (item) =>
              item.expectedSerials
                .length > 0,
          ),
      [items],
    );

  const verifiedKeys =
    useMemo(
      () =>
        new Set(
          [...scans, ...allPendingScans].map(
            (scan) =>
              `${scan.job_item_id}\u0000${scan.serial_number}`,
          ),
        ),
      [scans, allPendingScans],
    );

  const serverRecordedKeys = useMemo(
    () => new Set(scans.map((scan) => `${scan.job_item_id}\u0000${scan.serial_number}`)),
    [scans],
  );

  const expectedCount =
    serializedItems.reduce(
      (total, item) =>
        total +
        item.expectedSerials.length,
      0,
    );

  const verifiedCount =
    serializedItems.reduce(
      (total, item) =>
        total +
        item.expectedSerials.filter(
          (expectedSerial) =>
            verifiedKeys.has(
              `${item.id}\u0000${expectedSerial}`,
            ),
        ).length,
      0,
    );

  const [serial, setSerial] =
    useState("");

  const [busy, setBusy] =
    useState(false);

  // State updates land after a render; two camera detections in one tick
  // would both see busy === false. The ref closes that gap.
  const busyRef = useRef(false);

  const [message, setMessage] =
    useState("");

  const [error, setError] =
    useState("");

  if (expectedCount === 0) {
    return null;
  }

  async function submitSerial(
    value: string,
    scanFormat:
      | "manual"
      | CameraScanFormat,
  ): Promise<BarcodeSubmitResult> {
    const submittedValue =
      scanFormat === "manual"
        ? value.trim()
        : value;

    if (!submittedValue) {
      const validationMessage =
        "Enter or scan a barcode / serial number.";

      setMessage("");
      setError(
        validationMessage,
      );

      return {
        ok: false,
        duplicate: false,
        message:
          validationMessage,
      };
    }

    if (busyRef.current) {
      return {
        ok: false,
        duplicate: false,
        message:
          "A barcode is already being verified.",
      };
    }

    busyRef.current = true;
    setBusy(true);
    setMessage("");
    setError("");

    try {
      // Matched on the phone by the scans route's own rules, then queued:
      // it is sent now if there is signal, or when signal returns.
      const check =
        checkQueuedScan({
          items,
          verified: [
            ...scans,
            ...allPendingScans,
          ],
          value: submittedValue,
          scanFormat,
        });

      if (
        scanFormat ===
        "manual"
      ) {
        setSerial("");
      }

      if (
        !check.ok &&
        check.duplicate
      ) {
        // Same answer the server gives a repeat scan: ok, but a duplicate.
        setMessage(check.message);

        return {
          ok: true,
          duplicate: true,
          message: check.message,
        };
      }

      if (!check.ok) {
        setError(check.message);

        return {
          ok: false,
          duplicate: false,
          message: check.message,
        };
      }

      await enqueuePodScan({
        jobId,
        stopId,
        jobItemId: check.jobItemId,
        serialNumber:
          check.serialNumber,
        scanFormat: check.scanFormat,
      });

      const outcome: BarcodeSubmitResult =
        {
          ok: true,
          duplicate: false,
          message: paused
            ? `Item verified. ${paused}`
            : "Item verified. It will send automatically.",
        };

      setMessage(outcome.message);

      return outcome;
    } catch (scanError) {
      const errorMessage =
        scanError instanceof Error
          ? scanError.message
          : "Unable to verify this item.";

      setError(
        errorMessage,
      );

      return {
        ok: false,
        duplicate: false,
        message:
          errorMessage,
      };
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }

  async function verifyManualSerial() {
    await submitSerial(
      serial,
      "manual",
    );
  }

  async function verifyCameraSerial(
    value: string,
    scanFormat: CameraScanFormat,
  ): Promise<BarcodeSubmitResult> {
    return submitSerial(
      value,
      scanFormat,
    );
  }

  return (
    <section className="mt-5 rounded-2xl border border-cyan-200 bg-cyan-50/40 p-4" aria-label="Item barcode verification" aria-busy={busy}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="mb-1 text-[10px] font-black uppercase tracking-widest text-cyan-800">01 / MATCH ITEMS</p>
          <h3 className="text-base font-black text-slate-950">
            Scan & match freight
          </h3>

          <p className="mt-1 text-xs leading-5 text-slate-600">
            Match every serial for this job before completing delivery.
          </p>
        </div>

        <div className="rounded-full border border-cyan-200 bg-white px-3 py-1.5 text-xs font-black text-cyan-900">
          {verifiedCount} /{" "}
          {expectedCount} matched
        </div>
      </div>

      <progress className="mt-3 h-2 w-full accent-cyan-700" value={verifiedCount} max={expectedCount} aria-label="Job serials matched on this phone or recorded by server" />
      <p className="mt-2 text-xs leading-5 text-slate-600">
        Matched includes scans waiting on this phone. Only “Server recorded” confirms a scan has reached TMS.
      </p>
      {paused ? <p className="mt-3 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm font-bold text-amber-900" role="status">Sending paused: {paused} Keep this phone’s saved evidence; do not clear site data.</p> : null}

      <div className="mt-3 grid gap-2">
        {serializedItems.map(
          (item) => (
            <div
              key={item.id}
              className="min-w-0 rounded-xl border border-slate-200 bg-white p-3"
            >
              <div className="font-bold">
                {item.description ||
                  item.sku ||
                  "Serialized item"}
              </div>

              {item.sku ? (
                <div className="mt-1 text-xs text-slate-500">
                  SKU: {item.sku}
                </div>
              ) : null}

              <div className="mt-2 flex flex-wrap gap-2">
                {item.expectedSerials.map(
                  (expectedSerial) => {
                    const verified =
                      verifiedKeys.has(
                        `${item.id}\u0000${expectedSerial}`,
                      );
                    const serverRecorded = serverRecordedKeys.has(`${item.id}\u0000${expectedSerial}`);

                    return (
                      <span
                        key={
                          expectedSerial
                        }
                        className={
                          verified
                            ? "max-w-full break-all rounded-lg border border-emerald-200 bg-emerald-50 px-2.5 py-2 text-xs font-bold text-emerald-900"
                            : "max-w-full break-all rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-2 text-xs font-bold text-slate-700"
                        }
                      >
                        {expectedSerial}
                        <span className="mt-1 block text-[10px] font-semibold">{serverRecorded ? "Server recorded" : verified ? "On phone · waiting to send" : "Awaiting scan"}</span>
                      </span>
                    );
                  },
                )}
              </div>
            </div>
          ),
        )}
      </div>

      <CameraBarcodeScanner
        disabled={busy}
        onScan={
          verifyCameraSerial
        }
      />

      <label className="mt-4 block">
        <span className="text-xs font-black uppercase tracking-wide text-slate-600">
          Barcode / serial
        </span>

        <input
          value={serial}
          disabled={busy}
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          maxLength={250}
          aria-describedby={`barcode-help-${stopId}`}
          autoComplete="off"
          onChange={(event) =>
            setSerial(
              event.target.value,
            )
          }
          onKeyDown={(event) => {
            if (
              event.key ===
              "Enter"
            ) {
              event.preventDefault();
              void verifyManualSerial();
            }
          }}
          className="mt-1 min-h-12 w-full rounded-xl border border-slate-400 bg-white px-3 text-base text-slate-950 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cyan-700"
          placeholder="Scan or enter serial number"
        />
      </label>

      <button
        type="button"
        disabled={busy}
        onClick={() =>
          void verifyManualSerial()
        }
        className="mt-2 min-h-12 w-full rounded-xl bg-cyan-800 px-4 text-sm font-black text-white disabled:opacity-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cyan-800"
      >
        {busy
          ? "Checking..."
          : "Verify Item"}
      </button>

      <p id={`barcode-help-${stopId}`} className="mt-2 text-xs leading-5 text-slate-600">
        Camera and manual entry are checked on this phone, then again by the server when sent.
      </p>

      <div role="status" aria-live="polite" className={message ? "mt-3 rounded-xl bg-emerald-50 p-3 text-sm font-bold text-emerald-900" : "sr-only"}>{message}</div>

      <div role="alert" className={error ? "mt-3 rounded-xl bg-red-50 p-3 text-sm font-bold text-red-800" : "sr-only"}>{error}</div>
    </section>
  );
}
