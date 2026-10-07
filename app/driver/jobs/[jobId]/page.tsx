"use client";

import Link from "next/link";
import BarcodeVerification from "./BarcodeVerification";
import { preparePodPhoto } from "./downscaleImage";
import {
  type ChangeEvent,
  use,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import {
  errorFromBody,
  readJsonSafe,
} from "../../../../lib/pod/uploadClient";
import { checkQueuedCompletion } from "../../../../lib/driver/offlinePod";
import { pendingPodByStop, type PendingPod } from "../../../../lib/offline/driverSync";
import { JOB_GATE_MESSAGES } from "../../../../lib/walkaround/jobGate";
import {
  dismissRejected,
  enqueuePodComplete,
  enqueuePodPhoto,
  getQueueSnapshot,
  getServerQueueSnapshot,
  subscribe,
} from "../../driverQueue";
import { useDriverShift } from "../../useDriverShift";

type PodEvidence = {
  id: string;
  stop_id: string;
  evidence_type: string;
  storage_path: string;
  original_filename: string | null;
  mime_type: string | null;
  file_size_bytes: number | null;
  created_at: string;
};

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

type Stop = {
  id: string;
  stop_order: number;
  type: string;
  address_line: string;
  city: string | null;
  postcode: string | null;
  planned_at: string | null;
  status: string | null;
  pod_status: string | null;
  recipient_name: string | null;
  collected_at: string | null;
  delivered_at: string | null;
  pod_notes: string | null;
  pod_updated_at: string | null;
  pod_photo_url: string | null;
  evidence: PodEvidence[];
};

type Job = {
  id: string;
  reference: string | null;
  customer_reference: string | null;
  external_reference: string | null;
  status: string | null;
  job_date: string | null;
  scheduled_date: string | null;
  priority: string | null;
  notes: string | null;
  pod_status: string | null;
  completed_at: string | null;
  items: JobItem[];
  scans: JobItemScan[];
  stops: Stop[];
};

export default function DriverJobPage({
  params,
}: {
  params: Promise<{ jobId: string }>;
}) {
  const { jobId } = use(params);

  const [job, setJob] =
    useState<Job | null>(null);

  const [loading, setLoading] =
    useState(true);

  const [message, setMessage] =
    useState("");

  /* The full-page loader shows on the FIRST load only (review POD-11).
     Refreshing after an upload or scan used to swap the whole page for
     "Loading job...", which unmounted every stop card: the typed recipient
     name and notes were lost and the camera scanner closed after each scan.
     A refresh now keeps the job on screen and updates it in place. */
  const hasJob = useRef(false);

  const loadJob =
    useCallback(async () => {
      if (!hasJob.current) {
        setLoading(true);
      }

      try {
        const response =
          await fetch(
            `/api/driver/jobs/${encodeURIComponent(jobId)}`,
            {
              cache: "no-store",
            },
          );

        const body =
          await readJsonSafe(response);

        if (
          !response.ok ||
          !body.job
        ) {
          throw new Error(
            errorFromBody(
              body,
              response.status,
              "Unable to load this job.",
            ),
          );
        }

        setJob(body.job as Job);
        hasJob.current = true;
        setMessage("");
      } catch (error) {
        if (!hasJob.current) {
          setJob(null);
        }

        setMessage(
          error instanceof Error
            ? error.message
            : "Unable to load this job.",
        );
      } finally {
        setLoading(false);
      }
    }, [jobId]);

  useEffect(() => {
    void loadJob();
  }, [loadJob]);

  /* Offline POD: photos, scans and completions go through the driver queue
     (app/driver/driverQueue.ts). These hooks sit above the early returns
     below because hooks cannot be conditional. */
  const queue = useSyncExternalStore(
    subscribe,
    getQueueSnapshot,
    getServerQueueSnapshot,
  );

  const shift = useDriverShift();

  const pendingByStop = useMemo(
    () => pendingPodByStop(queue.pending, jobId),
    [queue.pending, jobId],
  );

  const jobRejections = useMemo(
    () => queue.rejected.filter((r) => r.jobId === jobId),
    [queue.rejected, jobId],
  );

  const shiftClientId =
    shift.state?.openShift?.clientId ?? null;

  /* Refuse at the doorstep what the server's walkaround gate would refuse:
     shifts apply to this driver and the phone's own view says no shift is
     open. With no view yet (still loading, or offline with nothing known)
     the item is queued and the server decides. */
  const gateMessage =
    !shift.forbidden &&
    shift.state &&
    !shift.state.openShift
      ? JOB_GATE_MESSAGES.noShift
      : null;

  // Re-read the job once queued POD items for it have been sent (or refused).
  const pendingForJob = useMemo(
    () =>
      [...pendingByStop.values()].reduce(
        (n, p) => n + p.photos + p.scans.length + (p.completion ? 1 : 0),
        0,
      ),
    [pendingByStop],
  );

  const lastPending = useRef(pendingForJob);

  const [sendTick, setSendTick] =
    useState(0);

  useEffect(() => {
    if (pendingForJob < lastPending.current) {
      setSendTick((tick) => tick + 1);
    }

    lastPending.current = pendingForJob;
  }, [pendingForJob]);

  useEffect(() => {
    if (sendTick === 0) {
      return;
    }

    // Debounced, so a burst of sends costs one request.
    const timer = setTimeout(
      () => void loadJob(),
      600,
    );

    return () => clearTimeout(timer);
  }, [sendTick, loadJob]);

  if (loading && !job) {
    return (
      <main className="min-h-screen bg-slate-100 px-4 py-6 text-slate-950 [color-scheme:light]">
        <div className="mx-auto max-w-2xl">
          Loading job...
        </div>
      </main>
    );
  }

  if (!job) {
    return (
      <main className="min-h-screen bg-slate-100 px-4 py-6 text-slate-950 [color-scheme:light]">
        <div className="mx-auto max-w-2xl">
          <Link
            href="/driver/dashboard"
            className="text-sm font-bold text-blue-700"
          >
            ← Back to jobs
          </Link>

          <div className="mt-4 rounded-2xl border border-red-200 bg-white p-5 shadow-sm">
            <h1 className="text-xl font-black">
              Job unavailable
            </h1>

            <p className="mt-2 text-sm text-slate-600">
              {message}
            </p>
          </div>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-slate-100 px-3 py-4 text-slate-950 [color-scheme:light] sm:px-5 sm:py-6">
      <div className="mx-auto max-w-2xl">
        <Link
          href="/driver/dashboard"
          className="inline-flex min-h-11 items-center text-sm font-black text-blue-700"
        >
          ← Today's jobs
        </Link>

        {message ? (
          <div className="mt-2 rounded-xl bg-amber-50 p-3 text-sm font-bold text-amber-900">
            {message}
          </div>
        ) : null}

        {jobRejections.map((r) => {
          const refusedStop = job.stops.find(
            (s) => s.id === r.stopId,
          );

          return (
            <div
              key={r.id}
              className="mt-2 rounded-xl bg-red-50 p-3 text-sm font-bold text-red-900"
            >
              Not sent, tell the office
              {refusedStop
                ? ` (stop ${refusedStop.stop_order})`
                : ""}
              : {r.message}
              <button
                type="button"
                className="ml-2 underline"
                onClick={() =>
                  dismissRejected(r.id)
                }
              >
                Dismiss
              </button>
            </div>
          );
        })}

        <section className="mt-2 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <div className="text-xs font-black uppercase tracking-wider text-blue-700">
                Driver Job
              </div>

              <h1 className="mt-1 text-2xl font-black">
                {job.reference || "Job"}
              </h1>
            </div>

            <StatusBadge
              value={
                job.status ||
                "Pending"
              }
            />
          </div>

          <div className="mt-4 grid grid-cols-2 gap-3">
            <Info
              label="Date"
              value={formatDate(
                job.job_date ||
                  job.scheduled_date,
              )}
            />

            <Info
              label="POD"
              value={
                job.pod_status ||
                "Pending"
              }
            />

            <Info
              label="Customer Ref"
              value={
                job.customer_reference
              }
            />

            <Info
              label="Priority"
              value={job.priority}
            />
          </div>

          {job.notes ? (
            <div className="mt-4 rounded-xl bg-slate-50 p-3 text-sm text-slate-700">
              <div className="mb-1 text-xs font-black uppercase tracking-wide text-slate-500">
                Job notes
              </div>

              {job.notes}
            </div>
          ) : null}
        </section>

        <section className="mt-4">
          <h2 className="px-1 text-lg font-black">
            Route
          </h2>

          <div className="mt-3 grid gap-3">
            {job.stops.map(
              (stop) => (
                <StopCard
                  key={stop.id}
                  jobId={job.id}
                  stop={stop}
                  items={job.items}
                  scans={job.scans}
                  pending={
                    pendingByStop.get(stop.id) ??
                    null
                  }
                  allStops={job.stops}
                  allPending={pendingByStop}
                  shiftClientId={shiftClientId}
                  gateMessage={gateMessage}
                  refusedCount={
                    jobRejections.filter(
                      (r) =>
                        r.stopId === stop.id,
                    ).length
                  }
                />
              ),
            )}
          </div>
        </section>

        {job.stops.length === 0 ? (
          <div className="mt-4 rounded-2xl border border-slate-200 bg-white p-5 text-sm text-slate-600">
            No stops are attached to this job.
          </div>
        ) : null}
      </div>
    </main>
  );
}

function StopCard({
  jobId,
  stop,
  items,
  scans,
  pending,
  allStops,
  allPending,
  shiftClientId,
  gateMessage,
  refusedCount,
}: {
  jobId: string;
  stop: Stop;
  items: JobItem[];
  scans: JobItemScan[];
  /** This stop's POD items still queued on the phone. */
  pending: PendingPod | null;
  allStops: Stop[];
  /** Queued POD items for every stop of this job. */
  allPending: Map<string, PendingPod>;
  shiftClientId: string | null;
  /** Set when the walkaround gate would refuse a POD (no open shift). */
  gateMessage: string | null;
  /** Refused queue items for this stop still listed at the top of the page. */
  refusedCount: number;
}) {
  const isCollection =
    stop.type === "collection";

  const isDelivery =
    stop.type === "delivery";

  const delivered =
    stop.pod_status === "delivered";

  const queuedCompletion =
    Boolean(pending?.completion);

  /* Once the queue has sent the completion it leaves the queue, but the job
     is only re-read a moment later. Keep the form hidden in that gap so a
     second tap cannot queue a completion the server would refuse. A refused
     completion adds a refusal for this stop, and then the form comes back. */
  const [handedOff, setHandedOff] =
    useState(false);

  const wasQueued = useRef(false);

  const refusedWhileQueued =
    useRef(refusedCount);

  useEffect(() => {
    if (queuedCompletion) {
      wasQueued.current = true;
      refusedWhileQueued.current =
        refusedCount;
      return;
    }

    if (wasQueued.current) {
      wasQueued.current = false;

      if (
        refusedCount <=
        refusedWhileQueued.current
      ) {
        setHandedOff(true);
      }
    }
  }, [queuedCompletion, refusedCount]);

  // A fresh read of the job replaces every stop object: the server now knows.
  useEffect(() => {
    setHandedOff(false);
  }, [stop]);

  const waitingToSend =
    !delivered &&
    (queuedCompletion || handedOff);

  const queuedPhotos =
    pending?.photos ?? 0;

  const [recipientName, setRecipientName] =
    useState(
      stop.recipient_name ?? "",
    );

  const [podNotes, setPodNotes] =
    useState(
      stop.pod_notes ?? "",
    );

  const [busy, setBusy] =
    useState(false);

  const [message, setMessage] =
    useState("");

  const [error, setError] =
    useState("");

  const cameraInputRef =
    useRef<HTMLInputElement>(null);

  const photoInputRef =
    useRef<HTMLInputElement>(null);

  useEffect(() => {
    setRecipientName(
      (current) =>
        stop.recipient_name ?? current,
    );

    setPodNotes(
      (current) =>
        stop.pod_notes ?? current,
    );
  }, [
    stop.recipient_name,
    stop.pod_notes,
  ]);

  const fullAddress = [
    stop.address_line,
    stop.city,
    stop.postcode,
  ]
    .filter(Boolean)
    .join(", ");

  const navigationUrl =
    `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(fullAddress)}`;

  async function uploadPhoto(
    event:
      ChangeEvent<HTMLInputElement>,
  ) {
    const file =
      event.target.files?.[0];

    event.target.value = "";

    if (!file) {
      return;
    }

    if (gateMessage) {
      setMessage("");
      setError(gateMessage);
      return;
    }

    setBusy(true);
    setError("");
    setMessage("");

    try {
      // Shrunk on the phone, then queued: it is sent now if there is signal,
      // or when signal returns. Queued shift events ahead of it go first.
      const photo =
        await preparePodPhoto(file);

      await enqueuePodPhoto({
        jobId,
        stopId: stop.id,
        shiftClientId,
        blob: photo.blob,
        mimeType: photo.mimeType,
        filename: photo.filename,
      });

      setMessage(
        navigator.onLine
          ? "POD photo saved. Sending now."
          : "POD photo saved. It will send when you have signal.",
      );
    } catch (uploadError) {
      setError(
        uploadError instanceof Error
          ? uploadError.message
          : "Unable to save POD photo.",
      );
    } finally {
      setBusy(false);
    }
  }

  async function completeDelivery() {
    if (gateMessage) {
      setMessage("");
      setError(gateMessage);
      return;
    }

    setBusy(true);
    setError("");
    setMessage("");

    try {
      // The doorstep checks the server runs, with queued photos and scans
      // counted as if they had already been sent.
      const verified = [
        ...scans,
        ...[...allPending.values()].flatMap(
          (p) => p.scans,
        ),
      ];

      const otherOutstandingDeliveryStops =
        allStops.filter(
          (s) =>
            s.type === "delivery" &&
            s.id !== stop.id &&
            s.pod_status !== "delivered" &&
            !allPending.get(s.id)?.completion,
        ).length;

      const check =
        checkQueuedCompletion({
          recipientName,
          podNotes,
          evidenceCount:
            stop.evidence.length +
            queuedPhotos,
          legacyPhotoUrl:
            stop.pod_photo_url,
          items,
          verified,
          otherOutstandingDeliveryStops,
        });

      if (!check.ok) {
        setError(check.message);
        return;
      }

      await enqueuePodComplete({
        jobId,
        stopId: stop.id,
        shiftClientId,
        recipientName,
        podNotes,
      });

      setMessage(
        navigator.onLine
          ? "Delivery saved. Sending now."
          : "Delivery saved. It will send when you have signal.",
      );
    } catch (completeError) {
      setError(
        completeError instanceof Error
          ? completeError.message
          : "Unable to save delivery.",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <article className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
      <div className="flex items-center justify-between gap-3 border-b border-slate-100 px-4 py-3">
        <div className="flex items-center gap-3">
          <div
            className={
              isCollection
                ? "flex h-10 w-10 items-center justify-center rounded-full bg-blue-100 font-black text-blue-800"
                : "flex h-10 w-10 items-center justify-center rounded-full bg-emerald-100 font-black text-emerald-800"
            }
          >
            {isCollection
              ? "C"
              : "D"}
            {stop.stop_order}
          </div>

          <div>
            <div className="text-sm font-black capitalize">
              {stop.type}
            </div>

            <div className="text-xs text-slate-500">
              Stop {stop.stop_order}
            </div>
          </div>
        </div>

        <StatusBadge
          value={
            stop.pod_status ||
            stop.status ||
            "Pending"
          }
        />
      </div>

      <div className="p-4">
        <div className="text-base font-bold">
          {stop.address_line}
        </div>

        <div className="mt-1 text-sm leading-6 text-slate-600">
          {stop.city || ""}
          {stop.city &&
          stop.postcode
            ? ", "
            : ""}
          {stop.postcode || ""}
        </div>

        <a
          href={navigationUrl}
          target="_blank"
          rel="noreferrer"
          className="mt-4 flex min-h-12 w-full items-center justify-center rounded-xl bg-slate-950 px-4 text-sm font-black text-white"
        >
          Open Navigation
        </a>

        <div className="mt-4 grid grid-cols-2 gap-3">
          <Info
            label="Planned"
            value={formatDateTime(
              stop.planned_at,
            )}
          />

          <Info
            label="POD"
            value={
              stop.pod_status ||
              "Pending"
            }
          />
        </div>

        {/* Scans are taken at delivery stops that are still open (review POD-20). */}
        {refusedCount > 0 ? (
          <div className="mt-4 rounded-xl bg-red-50 p-3 text-sm font-bold text-red-900">
            {refusedCount === 1
              ? "1 item for this stop was not sent."
              : `${refusedCount} items for this stop were not sent.`}{" "}
            See the top of the page and tell the office.
          </div>
        ) : null}

        {isDelivery && !delivered && !waitingToSend ? (
          <BarcodeVerification
            jobId={jobId}
            stopId={stop.id}
            items={items}
            scans={scans}
            allPendingScans={[
              ...allPending.values(),
            ].flatMap((p) => p.scans)}
          />
        ) : null}

        {isDelivery ? (
          <div className="mt-5 border-t border-slate-100 pt-5">
            <h3 className="text-base font-black">
              Proof of Delivery
            </h3>

            {delivered ? (
              <div className="mt-3 rounded-xl bg-emerald-50 p-4">
                <div className="font-black text-emerald-900">
                  Delivery complete
                </div>

                <div className="mt-2 text-sm text-emerald-900">
                  Recipient:{" "}
                  {stop.recipient_name ||
                    "Not recorded"}
                </div>

                {stop.pod_notes ? (
                  <div className="mt-1 text-sm text-emerald-900">
                    Notes:{" "}
                    {stop.pod_notes}
                  </div>
                ) : null}

                <div className="mt-1 text-sm text-emerald-900">
                  Completed:{" "}
                  {formatDateTime(
                    stop.delivered_at,
                  )}
                </div>
              </div>
            ) : waitingToSend ? (
              <div className="mt-3 rounded-xl bg-amber-50 p-4 text-sm font-bold text-amber-900">
                {queuedCompletion ? (
                  <>
                    Delivered, waiting to send
                    {queuedPhotos
                      ? ` (${queuedPhotos} photo${queuedPhotos === 1 ? "" : "s"} queued)`
                      : ""}
                    . It will send automatically when you have signal.
                  </>
                ) : (
                  "Delivered, sent. Updating..."
                )}

                {pending?.completion ? (
                  <div className="mt-2 font-normal">
                    Recipient:{" "}
                    {pending.completion
                      .recipientName ||
                      "Not recorded"}
                  </div>
                ) : null}
              </div>
            ) : (
              <>
                <label className="mt-3 block">
                  <span className="text-xs font-black uppercase tracking-wide text-slate-600">
                    Recipient name
                  </span>

                  <input
                    value={recipientName}
                    maxLength={200}
                    disabled={busy}
                    onChange={(event) =>
                      setRecipientName(
                        event.target.value,
                      )
                    }
                    className="mt-1 min-h-12 w-full rounded-xl border border-slate-300 bg-white px-3 text-base text-slate-950 outline-none focus:border-blue-600"
                    placeholder="Name of person receiving goods"
                  />
                </label>

                <label className="mt-4 block">
                  <span className="text-xs font-black uppercase tracking-wide text-slate-600">
                    POD notes
                  </span>

                  <textarea
                    value={podNotes}
                    maxLength={4000}
                    disabled={busy}
                    onChange={(event) =>
                      setPodNotes(
                        event.target.value,
                      )
                    }
                    className="mt-1 min-h-24 w-full rounded-xl border border-slate-300 bg-white p-3 text-base text-slate-950 outline-none focus:border-blue-600"
                    placeholder="Optional delivery notes"
                  />
                </label>

                <div className="mt-4">
                  <div className="text-xs font-black uppercase tracking-wide text-slate-600">
                    POD photos
                  </div>

                  <div className="mt-2 grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() =>
                        cameraInputRef.current?.click()
                      }
                      className="min-h-12 rounded-xl bg-blue-700 px-3 text-sm font-black text-white disabled:opacity-50"
                    >
                      Take Photo
                    </button>

                    <button
                      type="button"
                      disabled={busy}
                      onClick={() =>
                        photoInputRef.current?.click()
                      }
                      className="min-h-12 rounded-xl border border-blue-700 bg-white px-3 text-sm font-black text-blue-700 disabled:opacity-50"
                    >
                      Upload Photo
                    </button>
                  </div>

                  <input
                    ref={cameraInputRef}
                    type="file"
                    accept="image/jpeg,image/png,image/webp,image/heic"
                    capture="environment"
                    className="hidden"
                    onChange={(event) =>
                      void uploadPhoto(
                        event,
                      )
                    }
                  />

                  <input
                    ref={photoInputRef}
                    type="file"
                    accept="image/jpeg,image/png,image/webp,image/heic"
                    className="hidden"
                    onChange={(event) =>
                      void uploadPhoto(
                        event,
                      )
                    }
                  />
                </div>

                <button
                  type="button"
                  disabled={busy}
                  onClick={() =>
                    void completeDelivery()
                  }
                  className="mt-4 min-h-14 w-full rounded-xl bg-emerald-700 px-4 text-base font-black text-white disabled:opacity-50"
                >
                  {busy
                    ? "Please wait..."
                    : "Complete Delivery"}
                </button>
              </>
            )}

            <div className="mt-4">
              <div className="text-xs font-black uppercase tracking-wide text-slate-600">
                Evidence
              </div>

              {stop.evidence.length >
              0 ? (
                <div className="mt-2 grid gap-2">
                  {stop.evidence.map(
                    (item) => (
                      <div
                        key={item.id}
                        className="rounded-xl bg-slate-50 p-3 text-sm"
                      >
                        <div className="font-bold">
                          {item.original_filename ||
                            "POD photo"}
                        </div>

                        <div className="mt-1 text-xs text-slate-500">
                          {formatDateTime(
                            item.created_at,
                          )}
                        </div>
                      </div>
                    ),
                  )}
                </div>
              ) : stop.pod_photo_url ? (
                <div className="mt-2 rounded-xl bg-slate-50 p-3 text-sm">
                  Legacy POD photo recorded
                </div>
              ) : queuedPhotos === 0 ? (
                <div className="mt-2 text-sm text-slate-500">
                  No POD photo uploaded yet.
                </div>
              ) : null}

              {queuedPhotos > 0 &&
              !waitingToSend ? (
                <div className="mt-2 rounded-xl bg-amber-50 p-3 text-sm font-bold text-amber-900">
                  {queuedPhotos} photo
                  {queuedPhotos === 1
                    ? ""
                    : "s"}{" "}
                  waiting to send
                </div>
              ) : null}
            </div>

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
          </div>
        ) : null}

        {stop.collected_at ? (
          <div className="mt-3 text-xs font-semibold text-slate-500">
            Collected:{" "}
            {formatDateTime(
              stop.collected_at,
            )}
          </div>
        ) : null}
      </div>
    </article>
  );
}

function StatusBadge({
  value,
}: {
  value: string;
}) {
  return (
    <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-black capitalize text-slate-700">
      {value.replaceAll(
        "_",
        " ",
      )}
    </span>
  );
}

function Info({
  label,
  value,
}: {
  label: string;
  value:
    | string
    | null
    | undefined;
}) {
  return (
    <div>
      <div className="text-[10px] font-black uppercase tracking-wide text-slate-500">
        {label}
      </div>

      <div className="mt-1 break-words text-sm font-bold">
        {value || "-"}
      </div>
    </div>
  );
}

function formatDate(
  value:
    | string
    | null
    | undefined,
) {
  if (!value) {
    return "Not set";
  }

  const date =
    new Date(
      `${value}T00:00:00`,
    );

  return Number.isNaN(
    date.getTime(),
  )
    ? value
    : date.toLocaleDateString(
        "en-GB",
      );
}

function formatDateTime(
  value:
    | string
    | null
    | undefined,
) {
  if (!value) {
    return "Not set";
  }

  const date =
    new Date(value);

  return Number.isNaN(
    date.getTime(),
  )
    ? value
    : date.toLocaleString(
        "en-GB",
      );
}
