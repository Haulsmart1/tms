"use client";

import Link from "next/link";
import {
  use,
  useCallback,
  useEffect,
  useState,
} from "react";

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
  stops: Stop[];
};

type JobResponse = {
  job?: Job;
  error?: string;
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

  const loadJob = useCallback(async () => {
    setLoading(true);

    try {
      const response = await fetch(
        `/api/driver/jobs/${encodeURIComponent(jobId)}`,
        {
          cache: "no-store",
        },
      );

      const body =
        (await response.json()) as JobResponse;

      if (!response.ok || !body.job) {
        throw new Error(
          body.error ||
            "Unable to load this job.",
        );
      }

      setJob(body.job);
      setMessage("");
    } catch (error) {
      setJob(null);
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

  if (loading) {
    return (
      <main className="min-h-screen bg-slate-100 px-4 py-6 text-slate-950">
        <div className="mx-auto max-w-2xl">
          Loading job...
        </div>
      </main>
    );
  }

  if (!job) {
    return (
      <main className="min-h-screen bg-slate-100 px-4 py-6 text-slate-950">
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
    <main className="min-h-screen bg-slate-100 px-3 py-4 text-slate-950 sm:px-5 sm:py-6">
      <div className="mx-auto max-w-2xl">
        <Link
          href="/driver/dashboard"
          className="inline-flex min-h-11 items-center text-sm font-black text-blue-700"
        >
          ← Today's jobs
        </Link>

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
              value={job.status || "Pending"}
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
              value={job.pod_status || "Pending"}
            />

            <Info
              label="Customer Ref"
              value={job.customer_reference}
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
            {job.stops.map((stop) => (
              <StopCard
                key={stop.id}
                stop={stop}
              />
            ))}
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
  stop,
}: {
  stop: Stop;
}) {
  const isCollection =
    stop.type === "collection";

  const fullAddress = [
    stop.address_line,
    stop.city,
    stop.postcode,
  ]
    .filter(Boolean)
    .join(", ");

  const navigationUrl =
    `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(fullAddress)}`;

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
            {isCollection ? "C" : "D"}
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
          {stop.city && stop.postcode
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
            value={stop.pod_status || "Pending"}
          />
        </div>

        {stop.recipient_name ? (
          <div className="mt-3 rounded-xl bg-slate-50 p-3 text-sm">
            <span className="font-black">
              Recipient:
            </span>{" "}
            {stop.recipient_name}
          </div>
        ) : null}

        {stop.pod_notes ? (
          <div className="mt-3 rounded-xl bg-slate-50 p-3 text-sm">
            <span className="font-black">
              POD notes:
            </span>{" "}
            {stop.pod_notes}
          </div>
        ) : null}

        {stop.collected_at ||
        stop.delivered_at ? (
          <div className="mt-3 text-xs font-semibold text-slate-500">
            {isCollection
              ? "Collected"
              : "Delivered"}
            :{" "}
            {formatDateTime(
              stop.collected_at ||
                stop.delivered_at,
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
      {value.replaceAll("_", " ")}
    </span>
  );
}

function Info({
  label,
  value,
}: {
  label: string;
  value: string | null | undefined;
}) {
  return (
    <div>
      <div className="text-[10px] font-black uppercase tracking-wide text-slate-500">
        {label}
      </div>

      <div className="mt-1 break-words text-sm font-bold">
        {value || "—"}
      </div>
    </div>
  );
}

function formatDate(
  value: string | null | undefined,
) {
  if (!value) {
    return "Not set";
  }

  const date =
    new Date(`${value}T00:00:00`);

  return Number.isNaN(date.getTime())
    ? value
    : date.toLocaleDateString("en-GB");
}

function formatDateTime(
  value: string | null | undefined,
) {
  if (!value) {
    return "Not set";
  }

  const date = new Date(value);

  return Number.isNaN(date.getTime())
    ? value
    : date.toLocaleString("en-GB");
}