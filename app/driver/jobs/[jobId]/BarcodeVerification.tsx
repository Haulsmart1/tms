
"use client";

import {
  useMemo,
  useState,
} from "react";

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

type ScanResponse = {
  ok?: boolean;
  duplicate?: boolean;
  message?: string;
  error?: string;
};

export default function BarcodeVerification({
  jobId,
  stopId,
  items,
  scans,
  onChanged,
}: {
  jobId: string;
  stopId: string;
  items: JobItem[];
  scans: JobItemScan[];
  onChanged: () => Promise<void>;
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
          scans.map(
            (scan) =>
              `${scan.job_item_id}\u0000${scan.serial_number}`,
          ),
        ),
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
          (serial) =>
            verifiedKeys.has(
              `${item.id}\u0000${serial}`,
            ),
        ).length,
      0,
    );

  const [serial, setSerial] =
    useState("");

  const [busy, setBusy] =
    useState(false);

  const [message, setMessage] =
    useState("");

  const [error, setError] =
    useState("");

  if (expectedCount === 0) {
    return null;
  }

  async function verifySerial() {
    const value =
      serial.trim();

    if (!value) {
      setMessage("");
      setError(
        "Enter or scan a barcode / serial number.",
      );
      return;
    }

    setBusy(true);
    setMessage("");
    setError("");

    try {
      const response =
        await fetch(
          `/api/driver/jobs/${encodeURIComponent(jobId)}/stops/${encodeURIComponent(stopId)}/scans`,
          {
            method: "POST",
            headers: {
              "Content-Type":
                "application/json",
            },
            body: JSON.stringify({
              serial_number:
                value,
              scan_format:
                "manual",
            }),
          },
        );

      const body =
        (await response.json()) as ScanResponse;

      if (!response.ok) {
        throw new Error(
          body.error ||
            "Unable to verify this item.",
        );
      }

      setSerial("");

      setMessage(
        body.duplicate
          ? "Already verified on this job."
          : "Item verified.",
      );

      await onChanged();
    } catch (scanError) {
      setError(
        scanError instanceof Error
          ? scanError.message
          : "Unable to verify this item.",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="mt-5 border-t border-slate-100 pt-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="text-base font-black">
            Barcode verification
          </h3>

          <p className="mt-1 text-xs text-slate-500">
            Job-wide serialized freight verification.
          </p>
        </div>

        <div className="rounded-full bg-slate-100 px-3 py-1 text-xs font-black text-slate-700">
          {verifiedCount} /{" "}
          {expectedCount} verified
        </div>
      </div>

      <div className="mt-3 grid gap-2">
        {serializedItems.map(
          (item) => (
            <div
              key={item.id}
              className="rounded-xl border border-slate-200 bg-slate-50 p-3"
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

                    return (
                      <span
                        key={
                          expectedSerial
                        }
                        className={
                          verified
                            ? "rounded-lg bg-emerald-100 px-2 py-1 text-xs font-bold text-emerald-900"
                            : "rounded-lg bg-white px-2 py-1 text-xs font-bold text-slate-700"
                        }
                      >
                        {expectedSerial}
                        {verified
                          ? " ✓"
                          : ""}
                      </span>
                    );
                  },
                )}
              </div>
            </div>
          ),
        )}
      </div>

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
              void verifySerial();
            }
          }}
          className="mt-1 min-h-12 w-full rounded-xl border border-slate-300 bg-white px-3 text-base outline-none focus:border-blue-600"
          placeholder="Scan or enter serial number"
        />
      </label>

      <button
        type="button"
        disabled={busy}
        onClick={() =>
          void verifySerial()
        }
        className="mt-2 min-h-12 w-full rounded-xl bg-blue-700 px-4 text-sm font-black text-white disabled:opacity-50"
      >
        {busy
          ? "Checking..."
          : "Verify Item"}
      </button>

      <p className="mt-2 text-xs text-slate-500">
        Camera scanning will use the same server-side verification. Manual entry remains available as a fallback.
      </p>

      {message ? (
        <div className="mt-3 rounded-xl bg-emerald-50 p-3 text-sm font-bold text-emerald-900">
          {message}
        </div>
      ) : null}

      {error ? (
        <div className="mt-3 rounded-xl bg-red-50 p-3 text-sm font-bold text-red-800">
          {error}
        </div>
      ) : null}
    </section>
  );
}
