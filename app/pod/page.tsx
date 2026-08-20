"use client";

import {
  ChangeEvent,
  useCallback,
  useEffect, useMemo, useRef, useState,
} from "react";
import { createClient } from "../../lib/supabase/browser";
import { useTenant } from "../components/TenantProvider";
import TenantGate from "../components/TenantGate";
import PodLink from "../components/PodLink";
import Badge, { type Tone } from "../../components/Badge";
import Button from "../../components/Button";
import Field from "../../components/Field";
import Stat from "../../components/Stat";
import Textarea from "../../components/Textarea";

const POD_BUCKET = "pod-files";
const MAX_FILE_SIZE = 15 * 1024 * 1024;

const DOCUMENT_MIME_TYPES = new Set([
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/heic",
]);

type CustomerRelation = {
  name: string | null;
} | null;

type JobStop = {
  id: string;
  tenant_id: string;
  stop_order: number;
  type: string;
  address_line: string;
  city: string | null;
  postcode: string | null;
  planned_at: string | null;
  status: string;
  pod_status: string | null;
  recipient_name: string | null;
  delivered_at: string | null;
  pod_notes: string | null;
  pod_photo_url: string | null;
  pod_document_url: string | null;
  pod_updated_at: string | null;
};

type Job = {
  id: string;
  tenant_id?: string;
  reference: string | null;
  status: string | null;
  scheduled_date: string | null;
  customers: CustomerRelation;
  job_stops: JobStop[];
};

type EvidenceType = "photo" | "document" | "signature";

type PodEvidence = {
  id: string;
  tenant_id: string;
  job_id: string;
  stop_id: string;
  evidence_type: EvidenceType;
  storage_path: string;
  original_filename: string | null;
  mime_type: string | null;
  file_size_bytes: number | null;
  created_by: string | null;
  created_at: string;
};

type PodForm = {
  recipient_name: string;
  pod_notes: string;
};

type PodFilter = "all" | "pending" | "delivered" | "missing_evidence";

export default function PodPage() {
  const supabase = useMemo(() => createClient(), []);
  const tenant = useTenant();

  const [jobs, setJobs] = useState<Job[]>([]);
  const [evidence, setEvidence] = useState<PodEvidence[]>([]);
  const [forms, setForms] = useState<Record<string, PodForm>>({});

  const [message, setMessage] = useState("");
  const [errorMessage, setErrorMessage] = useState("");
  const [savingStopId, setSavingStopId] = useState<string | null>(null);
  const [uploadingKey, setUploadingKey] = useState("");
  const [loading, setLoading] = useState(true);

  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<PodFilter>("all");
  const [expandedJobId, setExpandedJobId] = useState<string | null>(null);

  const activeTenantId = tenant.activeTenantId;

  const evidenceByStop = useMemo(() => {
    const grouped = new Map<string, PodEvidence[]>();

    for (const item of evidence) {
      const current = grouped.get(item.stop_id) ?? [];
      current.push(item);
      grouped.set(item.stop_id, current);
    }

    return grouped;
  }, [evidence]);

  const clearMessages = useCallback(() => {
    setMessage("");
    setErrorMessage("");
  }, []);

  const loadData = useCallback(async () => {
    if (!activeTenantId) {
      setJobs([]);
      setEvidence([]);
      setForms({});
      setLoading(false);
      return;
    }

    setLoading(true);
    clearMessages();

    try {
      const [jobsResult, evidenceResult] = await Promise.all([
        supabase
          .from("jobs")
          .select(`
            id,
            tenant_id,
            reference,
            status,
            scheduled_date,
            customers (
              name
            ),
            job_stops (
              id,
              tenant_id,
              stop_order,
              type,
              address_line,
              city,
              postcode,
              planned_at,
              status,
              pod_status,
              recipient_name,
              delivered_at,
              pod_notes,
              pod_photo_url,
              pod_document_url,
              pod_updated_at
            )
          `)
          .eq("tenant_id", activeTenantId)
          .order("created_at", { ascending: false }),

        supabase
          .from("pod_evidence")
          .select(`
            id,
            tenant_id,
            job_id,
            stop_id,
            evidence_type,
            storage_path,
            original_filename,
            mime_type,
            file_size_bytes,
            created_by,
            created_at
          `)
          .eq("tenant_id", activeTenantId)
          .order("created_at", { ascending: false }),
      ]);

      if (jobsResult.error) {
        throw jobsResult.error;
      }

      if (evidenceResult.error) {
        throw evidenceResult.error;
      }

      const normalizedJobs = ((jobsResult.data ?? []) as unknown as Job[]).map(
        (job) => ({
          ...job,
          job_stops: [...(job.job_stops ?? [])].sort(
            (a, b) => a.stop_order - b.stop_order
          ),
        })
      );

      setJobs(normalizedJobs);
      setEvidence((evidenceResult.data ?? []) as PodEvidence[]);

      const nextForms: Record<string, PodForm> = {};

      for (const job of normalizedJobs) {
        for (const stop of job.job_stops) {
          nextForms[stop.id] = {
            recipient_name: stop.recipient_name ?? "",
            pod_notes: stop.pod_notes ?? "",
          };
        }
      }

      setForms(nextForms);
    } catch (error) {
      setErrorMessage(
        error instanceof Error ? error.message : "Unable to load POD records."
      );
    } finally {
      setLoading(false);
    }
  }, [activeTenantId, clearMessages, supabase]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  function updateForm(
    stopId: string,
    field: keyof PodForm,
    value: string
  ) {
    setForms((current) => ({
      ...current,
      [stopId]: {
        recipient_name: current[stopId]?.recipient_name ?? "",
        pod_notes: current[stopId]?.pod_notes ?? "",
        [field]: value,
      },
    }));
  }

  function getJobForStop(stopId: string) {
    return jobs.find((job) =>
      job.job_stops.some((stop) => stop.id === stopId)
    );
  }

  function getStopEvidence(stop: JobStop) {
    return evidenceByStop.get(stop.id) ?? [];
  }

  function hasPodEvidence(stop: JobStop) {
    return (
      getStopEvidence(stop).length > 0 ||
      Boolean(stop.pod_photo_url) ||
      Boolean(stop.pod_document_url)
    );
  }

  async function uploadFiles(
    files: FileList | null,
    job: Job,
    stop: JobStop,
    evidenceType: Exclude<EvidenceType, "signature">
  ) {
    if (!files || files.length === 0) {
      return;
    }

    if (!activeTenantId || stop.tenant_id !== activeTenantId) {
      setErrorMessage("This stop does not belong to the active tenant.");
      return;
    }

    clearMessages();
    const uploadKey = `${stop.id}-${evidenceType}`;
    setUploadingKey(uploadKey);

    try {
      const {
        data: { user },
        error: userError,
      } = await supabase.auth.getUser();

      if (userError) {
        throw userError;
      }

      if (!user) {
        throw new Error("You must be signed in to upload POD evidence.");
      }

      for (const file of Array.from(files)) {
        if (file.size > MAX_FILE_SIZE) {
          throw new Error(
            `${file.name} is larger than the 15 MB POD upload limit.`
          );
        }

        if (
          evidenceType === "photo" &&
          !file.type.startsWith("image/")
        ) {
          throw new Error(`${file.name} is not an image.`);
        }

        if (
          evidenceType === "document" &&
          file.type &&
          !DOCUMENT_MIME_TYPES.has(file.type)
        ) {
          throw new Error(
            `${file.name} is not an allowed POD document type.`
          );
        }

        const safeName = file.name.replace(
          /[^a-zA-Z0-9.\-_]/g,
          "_"
        );

        const folder =
          evidenceType === "photo" ? "photos" : "documents";

        const storagePath =
          `${activeTenantId}/${job.id}/${stop.id}/${folder}/` +
          `${Date.now()}-${crypto.randomUUID()}-${safeName}`;

        const { error: uploadError } = await supabase.storage
          .from(POD_BUCKET)
          .upload(storagePath, file, {
            upsert: false,
            contentType: file.type || undefined,
          });

        if (uploadError) {
          throw uploadError;
        }

        const { error: evidenceError } = await supabase
          .from("pod_evidence")
          .insert({
            tenant_id: activeTenantId,
            job_id: job.id,
            stop_id: stop.id,
            evidence_type: evidenceType,
            storage_path: storagePath,
            original_filename: file.name,
            mime_type: file.type || null,
            file_size_bytes: file.size,
            created_by: user.id,
          });

        if (evidenceError) {
          await supabase.storage
            .from(POD_BUCKET)
            .remove([storagePath]);

          throw evidenceError;
        }
      }

      const uploadedCount = files.length;

      setMessage(
        `${uploadedCount} ${
          evidenceType === "photo"
            ? uploadedCount === 1
              ? "photo"
              : "photos"
            : uploadedCount === 1
              ? "document"
              : "documents"
        } uploaded successfully.`
      );

      await loadData();
    } catch (error) {
      setErrorMessage(
        error instanceof Error
          ? error.message
          : "Unable to upload POD evidence."
      );
    } finally {
      setUploadingKey("");
    }
  }

  async function deleteEvidence(item: PodEvidence) {
    if (!activeTenantId || item.tenant_id !== activeTenantId) {
      return;
    }

    const confirmed = window.confirm(
      `Delete ${item.original_filename ?? "this POD evidence"}?`
    );

    if (!confirmed) {
      return;
    }

    clearMessages();

    try {
      const { error: storageError } = await supabase.storage
        .from(POD_BUCKET)
        .remove([item.storage_path]);

      if (storageError) {
        throw storageError;
      }

      const { error: rowError } = await supabase
        .from("pod_evidence")
        .delete()
        .eq("id", item.id)
        .eq("tenant_id", activeTenantId);

      if (rowError) {
        throw rowError;
      }

      setMessage("POD evidence deleted.");
      await loadData();
    } catch (error) {
      setErrorMessage(
        error instanceof Error
          ? error.message
          : "Unable to delete POD evidence."
      );
    }
  }

  async function savePod(
    job: Job,
    stop: JobStop,
    markDelivered: boolean
  ) {
    if (!activeTenantId || stop.tenant_id !== activeTenantId) {
      setErrorMessage("This stop does not belong to the active tenant.");
      return;
    }

    const form = forms[stop.id] ?? {
      recipient_name: "",
      pod_notes: "",
    };

    clearMessages();

    if (markDelivered && !form.recipient_name.trim()) {
      setErrorMessage(
        "Recipient name is required before completing delivery."
      );
      return;
    }

    if (markDelivered && !hasPodEvidence(stop)) {
      setErrorMessage(
        "Upload at least one POD photo or document before completing delivery."
      );
      return;
    }

    setSavingStopId(stop.id);

    try {
      const updatePayload: Record<string, unknown> = {
        recipient_name: form.recipient_name.trim() || null,
        pod_notes: form.pod_notes.trim() || null,
        pod_updated_at: new Date().toISOString(),
      };

      if (markDelivered) {
        updatePayload.delivered_at = new Date().toISOString();
        updatePayload.pod_status = "delivered";
        updatePayload.status = "completed";
      }

      const { error: stopError } = await supabase
        .from("job_stops")
        .update(updatePayload)
        .eq("id", stop.id)
        .eq("tenant_id", activeTenantId)
        .eq("job_id", job.id);

      if (stopError) {
        throw stopError;
      }

      if (markDelivered) {
        const { data: deliveryStops, error: deliveryError } =
          await supabase
            .from("job_stops")
            .select("id, pod_status")
            .eq("tenant_id", activeTenantId)
            .eq("job_id", job.id)
            .eq("type", "delivery");

        if (deliveryError) {
          throw deliveryError;
        }

        const allDelivered =
          (deliveryStops ?? []).length > 0 &&
          (deliveryStops ?? []).every(
            (deliveryStop) =>
              deliveryStop.pod_status === "delivered"
          );

        if (allDelivered) {
          const { error: jobError } = await supabase
            .from("jobs")
            .update({ status: "completed" })
            .eq("id", job.id)
            .eq("tenant_id", activeTenantId);

          if (jobError) {
            throw jobError;
          }
        }
      }

      setMessage(
        markDelivered
          ? "POD completed and delivery stop marked delivered."
          : "POD draft saved."
      );

      await loadData();
    } catch (error) {
      setErrorMessage(
        error instanceof Error
          ? error.message
          : "Unable to save POD."
      );
    } finally {
      setSavingStopId(null);
    }
  }

  const summary = useMemo(() => {
    const deliveryStops = jobs.flatMap((job) =>
      job.job_stops.filter((stop) => stop.type === "delivery")
    );

    const delivered = deliveryStops.filter(
      (stop) => stop.pod_status === "delivered"
    ).length;

    const pending = deliveryStops.length - delivered;

    const missingEvidence = deliveryStops.filter(
      (stop) =>
        stop.pod_status !== "delivered" &&
        !hasPodEvidence(stop)
    ).length;

    return {
      total: deliveryStops.length,
      delivered,
      pending,
      missingEvidence,
    };
  }, [jobs, evidenceByStop]);

  const filteredJobs = useMemo(() => {
    const query = search.trim().toLowerCase();

    return jobs
      .map((job) => {
        const customerName = job.customers?.name ?? "";

        const matchesSearch =
          !query ||
          [
            job.reference,
            customerName,
            ...job.job_stops.flatMap((stop) => [
              stop.address_line,
              stop.city,
              stop.postcode,
              stop.recipient_name,
            ]),
          ]
            .filter(Boolean)
            .some((value) =>
              String(value).toLowerCase().includes(query)
            );

        if (!matchesSearch) {
          return null;
        }

        const matchingStops = job.job_stops.filter((stop) => {
          if (stop.type !== "delivery") {
            return filter === "all";
          }

          if (filter === "delivered") {
            return stop.pod_status === "delivered";
          }

          if (filter === "pending") {
            return stop.pod_status !== "delivered";
          }

          if (filter === "missing_evidence") {
            return (
              stop.pod_status !== "delivered" &&
              !hasPodEvidence(stop)
            );
          }

          return true;
        });

        if (filter !== "all" && matchingStops.length === 0) {
          return null;
        }

        return {
          ...job,
          job_stops:
            filter === "all" ? job.job_stops : matchingStops,
        };
      })
      .filter((job): job is Job => job !== null);
  }, [filter, jobs, search, evidenceByStop]);

  return (
    <TenantGate>
      <div className="ds min-h-screen bg-canvas font-sans text-ink">
        <main className="mx-auto max-w-[1480px] px-6 py-8">
          <header>
            <div className="text-kicker uppercase text-ink-3">
              Delivery Evidence
            </div>

            <h1 className="mb-1 mt-0.5 text-xl font-semibold tracking-tight text-ink">
              Proof of Delivery
            </h1>

            <p className="mb-4 text-sm text-ink-3">
              Capture recipients, photos and documents, then complete delivery
              stops with a full tenant-scoped POD record.
            </p>
          </header>

          <section
            aria-label="POD summary"
            className="mb-4 grid grid-cols-2 gap-2.5 lg:grid-cols-4"
          >
            <Stat
              label="Delivery Stops"
              value={String(summary.total)}
            />
            <Stat
              label="Pending POD"
              value={String(summary.pending)}
              subTone={summary.pending > 0 ? "warning" : undefined}
              sub={summary.pending > 0 ? "awaiting POD" : undefined}
            />
            <Stat
              label="Delivered"
              value={String(summary.delivered)}
              subTone="positive"
              sub={summary.delivered > 0 ? "delivered" : undefined}
            />
            <Stat
              label="Missing Evidence"
              value={String(summary.missingEvidence)}
              subTone="danger"
              sub={summary.missingEvidence > 0 ? "needs evidence" : undefined}
            />
          </section>

          {errorMessage ? (
            <div className="mb-4 rounded-lg border border-danger-border bg-danger-tint p-3 text-sm text-danger-strong">
              {errorMessage}
            </div>
          ) : null}

          {message ? (
            <div className="mb-4 rounded-lg border border-success-border bg-success-tint p-3 text-sm text-success-strong">
              {message}
            </div>
          ) : null}

          <section className="mb-4 flex flex-wrap items-center gap-3">
            <input
              type="search"
              value={search}
              onChange={(event) =>
                setSearch(event.target.value)
              }
              placeholder="Search job, customer, address, postcode or recipient..."
              className="h-10 min-w-0 flex-1 basis-72 rounded-md border border-ink-3 bg-surface px-3 text-base text-ink placeholder:text-ink-3"
            />

            <label className="flex items-center gap-2">
              <span className="text-sm font-medium text-ink-2">Filter</span>
              <select
                value={filter}
                onChange={(event) =>
                  setFilter(
                    event.target.value as PodFilter
                  )
                }
                className="h-10 w-full min-w-0 rounded-md border border-ink-3 bg-surface px-3 text-base text-ink"
              >
                <option value="all">
                  All POD
                </option>
                <option value="pending">
                  Pending
                </option>
                <option value="delivered">
                  Delivered
                </option>
                <option value="missing_evidence">
                  Missing Evidence
                </option>
              </select>
            </label>
          </section>

          {loading ? (
            <div className="rounded-lg border border-line bg-surface p-8 text-center text-sm text-ink-3">
              Loading POD records...
            </div>
          ) : filteredJobs.length === 0 ? (
            <div className="rounded-lg border border-line bg-surface p-8 text-center text-sm text-ink-3">
              No POD records match the current filter.
            </div>
          ) : (
            <div>
              {filteredJobs.map((job) => (
                <section
                  key={job.id}
                  className="mb-2 rounded-lg border border-line bg-surface px-3 py-2.5 shadow-sm"
                >
                  <div className="grid gap-3 md:grid-cols-[minmax(145px,1.1fr)_minmax(180px,1.5fr)_100px_115px_160px_auto] md:items-center">
                    <div className="min-w-0">
                      <div className="truncate font-mono text-sm font-semibold text-ink">
                        {job.reference || "No job reference"}
                      </div>
                    </div>

                    <div className="min-w-0">
                      <div className="truncate text-sm font-medium text-ink">
                        {job.customers?.name || "No customer"}
                      </div>
                    </div>

                    <div className="text-xs text-ink-3">
                      {formatDate(job.scheduled_date)}
                    </div>

                    <div>
                      <StatusBadge
                        value={job.status || "planned"}
                      />
                    </div>

                    <div className="text-xs font-medium text-ink-2">
                      Photos{" "}
                      {evidence.filter(
                        (item) =>
                          item.job_id === job.id &&
                          item.evidence_type === "photo"
                      ).length}
                      {" · "}Docs{" "}
                      {evidence.filter(
                        (item) =>
                          item.job_id === job.id &&
                          item.evidence_type === "document"
                      ).length}
                    </div>

                    <div className="flex justify-start md:justify-end">
                      <Button
                        type="button"
                        variant="secondary"
                        size="sm"
                        onClick={() =>
                          setExpandedJobId((current) =>
                            current === job.id
                              ? null
                              : job.id
                          )
                        }
                      >
                        {expandedJobId === job.id
                          ? "Hide"
                          : "View"}
                      </Button>
                    </div>
                  </div>

                  {expandedJobId === job.id ? (
                    <div className="mt-3 border-t border-line pt-3">
                    {job.job_stops.map((stop) => {
                      const form =
                        forms[stop.id] ?? {
                          recipient_name: "",
                          pod_notes: "",
                        };

                      const stopEvidence =
                        getStopEvidence(stop);

                      const photos =
                        stopEvidence.filter(
                          (item) =>
                            item.evidence_type ===
                            "photo"
                        );

                      const documents =
                        stopEvidence.filter(
                          (item) =>
                            item.evidence_type ===
                            "document"
                        );

                      const evidenceCount =
                        stopEvidence.length +
                        (stop.pod_photo_url ? 1 : 0) +
                        (stop.pod_document_url
                          ? 1
                          : 0);

                      return (
                        <article
                          key={stop.id}
                          data-stop-card
                          className="mb-3 rounded-lg border border-line bg-surface-2 p-3"
                        >
                          <div className="flex flex-wrap items-start justify-between gap-3">
                            <div className="min-w-0">
                              {/* stress hooks for tests/pod-layout.spec.mjs; values are historical anchors, not semantics */}
                              <div
                                data-stress="vehicle"
                                className="text-sm font-semibold text-ink"
                              >
                                Stop{" "}
                                {stop.stop_order} ·{" "}
                                {formatLabel(
                                  stop.type
                                )}
                              </div>

                              <div
                                data-stress="name"
                                className="mt-1 break-words text-sm text-ink-2"
                              >
                                {[
                                  stop.address_line,
                                  stop.city,
                                  stop.postcode,
                                ]
                                  .filter(Boolean)
                                  .join(", ")}
                              </div>

                              {stop.planned_at ? (
                                <div className="mt-1 text-xs text-ink-3">
                                  Planned:{" "}
                                  {formatDateTime(
                                    stop.planned_at
                                  )}
                                </div>
                              ) : null}
                            </div>

                            <div className="flex flex-wrap gap-2">
                              <StatusBadge
                                value={
                                  stop.pod_status ||
                                  "pending"
                                }
                              />

                              <Badge tone="info">
                                {evidenceCount} evidence
                              </Badge>
                            </div>
                          </div>

                          {stop.delivered_at ? (
                            <div className="mt-3 rounded-lg border border-success-border bg-success-tint p-2.5 text-sm font-medium text-success-strong">
                              Delivered{" "}
                              {formatDateTime(
                                stop.delivered_at
                              )}
                              {stop.recipient_name
                                ? ` to ${stop.recipient_name}`
                                : ""}
                            </div>
                          ) : null}

                          {stop.type ===
                          "delivery" ? (
                            <div className="mt-4 grid gap-4">
                              <div className="grid gap-3 sm:grid-cols-2">
                                <Field
                                  id={`pod-${stop.id}-recipient`}
                                  label="Recipient Name"
                                  value={
                                    form.recipient_name
                                  }
                                  onChange={(
                                    event
                                  ) =>
                                    updateForm(
                                      stop.id,
                                      "recipient_name",
                                      event.target
                                        .value
                                    )
                                  }
                                  placeholder="Who received the delivery?"
                                />

                                <Textarea
                                  id={`pod-${stop.id}-notes`}
                                  label="POD Notes"
                                  wrapperClassName="sm:col-span-2"
                                  value={
                                    form.pod_notes
                                  }
                                  onChange={(
                                    event
                                  ) =>
                                    updateForm(
                                      stop.id,
                                      "pod_notes",
                                      event.target
                                        .value
                                    )
                                  }
                                  rows={3}
                                  placeholder="Delivery notes, condition, quantities or other POD information..."
                                />
                              </div>

                              <div className="grid gap-3 sm:grid-cols-2">
                                <EvidenceUpload
                                  title="Delivery Photos"
                                  description="Upload one or more photos."
                                  accept="image/*"
                                  multiple
                                  uploading={
                                    uploadingKey ===
                                    `${stop.id}-photo`
                                  }
                                  onChange={(
                                    event
                                  ) => {
                                    void uploadFiles(
                                      event.target
                                        .files,
                                      job,
                                      stop,
                                      "photo"
                                    );
                                    event.target.value =
                                      "";
                                  }}
                                />

                                <EvidenceUpload
                                  title="Delivery Documents"
                                  description="PDF, Word or image documents."
                                  accept=".pdf,.doc,.docx,.jpg,.jpeg,.png,.webp,.heic"
                                  multiple
                                  uploading={
                                    uploadingKey ===
                                    `${stop.id}-document`
                                  }
                                  onChange={(
                                    event
                                  ) => {
                                    void uploadFiles(
                                      event.target
                                        .files,
                                      job,
                                      stop,
                                      "document"
                                    );
                                    event.target.value =
                                      "";
                                  }}
                                />
                              </div>

                              <div className="grid gap-2.5">
                                <div className="flex flex-wrap items-center justify-between gap-2">
                                  <h3 className="m-0 text-sm font-semibold text-ink">
                                    POD Evidence Viewer
                                  </h3>

                                  <div className="flex flex-wrap gap-2">
                                    <Badge tone="info">
                                      {photos.length} photo{photos.length === 1 ? "" : "s"}
                                    </Badge>

                                    <Badge tone="info">
                                      {documents.length} document{documents.length === 1 ? "" : "s"}
                                    </Badge>

                                    <Badge tone="neutral">
                                      {evidenceCount} total
                                    </Badge>
                                  </div>
                                </div>

                                {stop.pod_photo_url ||
                                stop.pod_document_url ? (
                                  <div className="rounded-lg border border-warning-border bg-warning-tint p-3 text-sm text-warning-strong">
                                    <strong>
                                      Legacy POD
                                    </strong>

                                    <div className="mt-1.5 flex flex-wrap gap-3">
                                      {stop.pod_photo_url ? (
                                        <PodLink
                                          value={
                                            stop.pod_photo_url
                                          }
                                          label="View legacy photo"
                                        />
                                      ) : null}

                                      {stop.pod_document_url ? (
                                        <PodLink
                                          value={
                                            stop.pod_document_url
                                          }
                                          label="View legacy document"
                                        />
                                      ) : null}
                                    </div>
                                  </div>
                                ) : null}

                                {photos.length ===
                                  0 &&
                                documents.length ===
                                  0 ? (
                                  <div className="rounded-lg border border-dashed border-line-strong bg-surface p-3 text-sm text-ink-3">
                                    No new POD evidence
                                    uploaded yet.
                                  </div>
                                ) : (
                                  <div className="grid gap-2">
                                    {[
                                      ...photos,
                                      ...documents,
                                    ].map((item) => (
                                      <div
                                        key={
                                          item.id
                                        }
                                        className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-line bg-surface p-3"
                                      >
                                        <div className="min-w-0">
                                          <strong className="break-words text-sm text-ink">
                                            {item.original_filename ||
                                              formatLabel(
                                                item.evidence_type
                                              )}
                                          </strong>

                                          <div className="mt-0.5 text-xs text-ink-3">
                                            {formatLabel(
                                              item.evidence_type
                                            )}{" "}
                                            ·{" "}
                                            {formatFileSize(
                                              item.file_size_bytes
                                            )}{" "}
                                            · Uploaded{" "}
                                            {formatDateTime(
                                              item.created_at
                                            )}
                                          </div>
                                        </div>

                                        <div className="flex items-center gap-2.5">
                                          <PodLink
                                            value={
                                              item.storage_path
                                            }
                                            label={
                                              item.mime_type?.startsWith("image/") ||
                                              item.mime_type === "application/pdf"
                                                ? "Preview"
                                                : "Open / Download"
                                            }
                                          />

                                          <Button
                                            variant="danger"
                                            size="sm"
                                            onClick={() =>
                                              void deleteEvidence(
                                                item
                                              )
                                            }
                                          >
                                            Delete
                                          </Button>
                                        </div>
                                      </div>
                                    ))}
                                  </div>
                                )}
                              </div>

                              <div className="flex flex-wrap items-center justify-between gap-4 border-t border-line pt-4">
                                <Button
                                  variant="secondary"
                                  disabled={
                                    savingStopId ===
                                    stop.id
                                  }
                                  onClick={() =>
                                    void savePod(
                                      job,
                                      stop,
                                      false
                                    )
                                  }
                                >
                                  {savingStopId ===
                                  stop.id
                                    ? "Saving..."
                                    : "SAVE POD DRAFT"}
                                </Button>

                                <Button
                                  disabled={
                                    savingStopId ===
                                      stop.id ||
                                    stop.pod_status ===
                                      "delivered"
                                  }
                                  onClick={() =>
                                    void savePod(
                                      job,
                                      stop,
                                      true
                                    )
                                  }
                                >
                                  {stop.pod_status ===
                                  "delivered"
                                    ? "Delivered"
                                    : savingStopId ===
                                        stop.id
                                      ? "Saving..."
                                      : "COMPLETE DELIVERY"}
                                </Button>
                              </div>
                            </div>
                          ) : null}
                        </article>
                      );
                    })}
                    </div>
                  ) : null}
                </section>
              ))}
            </div>
          )}
        </main>
      </div>
    </TenantGate>
  );
}

function EvidenceUpload({
  title,
  description,
  accept,
  multiple,
  uploading,
  onChange,
}: {
  title: string;
  description: string;
  accept: string;
  multiple: boolean;
  uploading: boolean;
  onChange: (
    event: ChangeEvent<HTMLInputElement>
  ) => void;
}) {
  const buttonLabel =
    title === "Delivery Photos"
      ? "ADD DELIVERY PHOTOS"
      : "ADD DELIVERY DOCUMENTS";

  return (
    <div className="grid min-h-[140px] content-between gap-3 rounded-lg border border-line bg-surface p-4">
      <div>
        <strong className="mb-1 block text-sm font-semibold text-ink">
          {title}
        </strong>

        <div className="text-xs text-ink-3">
          {description}
        </div>
      </div>

      <div className="relative w-full">
        <div
          aria-hidden="true"
          className={[
            "inline-flex w-full items-center justify-center rounded-md border border-line-strong",
            "bg-surface px-3 py-2 text-xs font-semibold text-ink transition",
            "hover:bg-surface-2",
            uploading
              ? "cursor-not-allowed opacity-50"
              : "cursor-pointer",
          ].join(" ")}
        >
          {uploading
            ? "UPLOADING..."
            : buttonLabel}
        </div>

        <input
          type="file"
          accept={accept}
          multiple={multiple}
          disabled={uploading}
          onChange={onChange}
          aria-label={buttonLabel}
          className={[
            "absolute inset-0 z-10 h-full w-full opacity-0",
            uploading
              ? "cursor-not-allowed"
              : "cursor-pointer",
          ].join(" ")}
        />
      </div>
    </div>
  );
}

function StatusBadge({
  value,
}: {
  value: string;
}) {
  const normalized = value.toLowerCase();

  let tone: Tone = "neutral";

  if (
    normalized === "delivered" ||
    normalized === "completed"
  ) {
    tone = "success";
  } else if (
    normalized === "pending" ||
    normalized === "planned"
  ) {
    tone = "warning";
  }

  return (
    <Badge tone={tone}>
      {formatLabel(value)}
    </Badge>
  );
}

function formatLabel(value: string) {
  return value
    .replaceAll("_", " ")
    .replace(/\b\w/g, (character) =>
      character.toUpperCase()
    );
}

function formatDate(value: string | null) {
  if (!value) {
    return "—";
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return date.toLocaleDateString("en-GB");
}

function formatDateTime(value: string | null) {
  if (!value) {
    return "—";
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return date.toLocaleString("en-GB");
}

function formatFileSize(value: number | null) {
  if (value === null || value === undefined) {
    return "Unknown size";
  }

  if (value < 1024) {
    return `${value} B`;
  }

  if (value < 1024 * 1024) {
    return `${(value / 1024).toFixed(1)} KB`;
  }

  return `${(
    value /
    (1024 * 1024)
  ).toFixed(1)} MB`;
}
