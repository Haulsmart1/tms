"use client";

import {
  ChangeEvent,
  CSSProperties,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createClient } from "../../lib/supabase/browser";
import { useTenant } from "../components/TenantProvider";
import TenantGate from "../components/TenantGate";
import PodLink from "../components/PodLink";

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

      setMessage(
        evidenceType === "photo"
          ? "POD photo evidence uploaded."
          : "POD document evidence uploaded."
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
      <main style={styles.page}>
        <div style={styles.shell}>
          <header style={styles.header}>
            <div>
              <p style={styles.eyebrow}>
                Delivery Evidence
              </p>

              <h1 style={styles.title}>
                Proof of Delivery
              </h1>

              <p style={styles.subtitle}>
                Capture recipients, photos and documents,
                then complete delivery stops with a full
                tenant-scoped POD record.
              </p>
            </div>
          </header>

          <section style={styles.summaryGrid}>
            <SummaryCard
              label="Delivery Stops"
              value={summary.total}
            />
            <SummaryCard
              label="Pending POD"
              value={summary.pending}
            />
            <SummaryCard
              label="Delivered"
              value={summary.delivered}
            />
            <SummaryCard
              label="Missing Evidence"
              value={summary.missingEvidence}
            />
          </section>

          {errorMessage ? (
            <div style={styles.error}>
              {errorMessage}
            </div>
          ) : null}

          {message ? (
            <div style={styles.success}>
              {message}
            </div>
          ) : null}

          <section style={styles.toolbar}>
            <input
              type="search"
              value={search}
              onChange={(event) =>
                setSearch(event.target.value)
              }
              placeholder="Search job, customer, address, postcode or recipient..."
              style={styles.search}
            />

            <select
              value={filter}
              onChange={(event) =>
                setFilter(
                  event.target.value as PodFilter
                )
              }
              style={styles.select}
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
          </section>

          {loading ? (
            <div style={styles.empty}>
              Loading POD records...
            </div>
          ) : filteredJobs.length === 0 ? (
            <div style={styles.empty}>
              No POD records match the current filter.
            </div>
          ) : (
            <div style={styles.jobList}>
              {filteredJobs.map((job) => (
                <section
                  key={job.id}
                  style={styles.jobCard}
                >
                  <div style={styles.jobHeader}>
                    <div>
                      <div style={styles.reference}>
                        {job.reference ||
                          "No job reference"}
                      </div>

                      <h2 style={styles.customer}>
                        {job.customers?.name ||
                          "No customer"}
                      </h2>

                      <div style={styles.jobMeta}>
                        Scheduled:{" "}
                        {formatDate(job.scheduled_date)}
                      </div>
                    </div>

                    <StatusBadge
                      value={job.status || "planned"}
                    />
                  </div>

                  <div style={styles.stopList}>
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
                          style={styles.stopCard}
                        >
                          <div
                            style={
                              styles.stopHeader
                            }
                          >
                            <div>
                              <div
                                style={
                                  styles.stopTitle
                                }
                              >
                                Stop{" "}
                                {stop.stop_order} ·{" "}
                                {formatLabel(
                                  stop.type
                                )}
                              </div>

                              <div
                                style={
                                  styles.address
                                }
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
                                <div
                                  style={
                                    styles.muted
                                  }
                                >
                                  Planned:{" "}
                                  {formatDateTime(
                                    stop.planned_at
                                  )}
                                </div>
                              ) : null}
                            </div>

                            <div
                              style={
                                styles.stopBadges
                              }
                            >
                              <StatusBadge
                                value={
                                  stop.pod_status ||
                                  "pending"
                                }
                              />

                              <span
                                style={
                                  styles.evidenceBadge
                                }
                              >
                                {evidenceCount} evidence
                              </span>
                            </div>
                          </div>

                          {stop.delivered_at ? (
                            <div
                              style={styles.delivered}
                            >
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
                            <div
                              style={
                                styles.deliveryBody
                              }
                            >
                              <div
                                style={
                                  styles.formGrid
                                }
                              >
                                <label
                                  style={
                                    styles.field
                                  }
                                >
                                  <span
                                    style={
                                      styles.label
                                    }
                                  >
                                    Recipient Name
                                  </span>

                                  <input
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
                                    style={
                                      styles.input
                                    }
                                  />
                                </label>

                                <label
                                  style={{
                                    ...styles.field,
                                    gridColumn:
                                      "1 / -1",
                                  }}
                                >
                                  <span
                                    style={
                                      styles.label
                                    }
                                  >
                                    POD Notes
                                  </span>

                                  <textarea
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
                                    style={{
                                      ...styles.input,
                                      resize:
                                        "vertical",
                                    }}
                                  />
                                </label>
                              </div>

                              <div
                                style={
                                  styles.uploadGrid
                                }
                              >
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

                              <div
                                style={
                                  styles.evidenceSection
                                }
                              >
                                <h3
                                  style={
                                    styles.evidenceTitle
                                  }
                                >
                                  POD Evidence
                                </h3>

                                {stop.pod_photo_url ||
                                stop.pod_document_url ? (
                                  <div
                                    style={
                                      styles.legacyBox
                                    }
                                  >
                                    <strong>
                                      Legacy POD
                                    </strong>

                                    <div
                                      style={
                                        styles.linkList
                                      }
                                    >
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
                                  <div
                                    style={
                                      styles.noEvidence
                                    }
                                  >
                                    No new POD evidence
                                    uploaded yet.
                                  </div>
                                ) : (
                                  <div
                                    style={
                                      styles.evidenceGrid
                                    }
                                  >
                                    {[
                                      ...photos,
                                      ...documents,
                                    ].map((item) => (
                                      <div
                                        key={
                                          item.id
                                        }
                                        style={
                                          styles.evidenceItem
                                        }
                                      >
                                        <div>
                                          <strong>
                                            {item.original_filename ||
                                              formatLabel(
                                                item.evidence_type
                                              )}
                                          </strong>

                                          <div
                                            style={
                                              styles.muted
                                            }
                                          >
                                            {formatLabel(
                                              item.evidence_type
                                            )}{" "}
                                            ·{" "}
                                            {formatFileSize(
                                              item.file_size_bytes
                                            )}
                                          </div>
                                        </div>

                                        <div
                                          style={
                                            styles.evidenceActions
                                          }
                                        >
                                          <PodLink
                                            value={
                                              item.storage_path
                                            }
                                            label="View"
                                          />

                                          <button
                                            type="button"
                                            onClick={() =>
                                              void deleteEvidence(
                                                item
                                              )
                                            }
                                            style={
                                              styles.deleteButton
                                            }
                                          >
                                            Delete
                                          </button>
                                        </div>
                                      </div>
                                    ))}
                                  </div>
                                )}
                              </div>

                              <div
                                style={
                                  styles.actions
                                }
                              >
                                <button
                                  type="button"
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
                                  style={
                                    styles.secondaryButton
                                  }
                                >
                                  {savingStopId ===
                                  stop.id
                                    ? "Saving..."
                                    : "SAVE POD DRAFT"}
                                </button>

                                <button
                                  type="button"
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
                                  style={{
                                    ...styles.primaryButton,
                                    opacity:
                                      stop.pod_status ===
                                      "delivered"
                                        ? 0.55
                                        : 1,
                                  }}
                                >
                                  {stop.pod_status ===
                                  "delivered"
                                    ? "Delivered"
                                    : savingStopId ===
                                        stop.id
                                      ? "Saving..."
                                      : "COMPLETE DELIVERY"}
                                </button>
                              </div>
                            </div>
                          ) : null}
                        </article>
                      );
                    })}
                  </div>
                </section>
              ))}
            </div>
          )}
        </div>
      </main>
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
  const inputRef = useRef<HTMLInputElement>(null);

  const buttonLabel =
    title === "Delivery Photos"
      ? "ADD DELIVERY PHOTOS"
      : "ADD DELIVERY DOCUMENTS";

  return (
    <div style={styles.uploadCard}>
      <div>
        <strong style={styles.uploadTitle}>
          {title}
        </strong>

        <div style={styles.uploadDescription}>
          {description}
        </div>
      </div>

      <input
        ref={inputRef}
        type="file"
        accept={accept}
        multiple={multiple}
        disabled={uploading}
        onChange={onChange}
        style={styles.hiddenFileInput}
      />

      <button
        type="button"
        disabled={uploading}
        onClick={() => inputRef.current?.click()}
        style={{
          ...styles.uploadButton,
          opacity: uploading ? 0.55 : 1,
          cursor: uploading
            ? "not-allowed"
            : "pointer",
        }}
      >
        {uploading
          ? "UPLOADING..."
          : buttonLabel}
      </button>
    </div>
  );
}

function SummaryCard({
  label,
  value,
}: {
  label: string;
  value: number;
}) {
  return (
    <div style={styles.summaryCard}>
      <div style={styles.summaryValue}>
        {value}
      </div>
      <div style={styles.summaryLabel}>
        {label}
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

  let background = "#e2e8f0";
  let color = "#334155";

  if (
    normalized === "delivered" ||
    normalized === "completed"
  ) {
    background = "#dcfce7";
    color = "#166534";
  } else if (
    normalized === "pending" ||
    normalized === "planned"
  ) {
    background = "#fef3c7";
    color = "#92400e";
  }

  return (
    <span
      style={{
        ...styles.statusBadge,
        background,
        color,
      }}
    >
      {formatLabel(value)}
    </span>
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

const styles: Record<string, CSSProperties> = {
  page: {
    minHeight: "100vh",
    padding: 30,
    background: "#f1f5f9",
  },

  shell: {
    maxWidth: 1500,
    margin: "0 auto",
    display: "grid",
    gap: 22,
  },

  header: {
    padding: 28,
    borderRadius: 18,
    background:
      "linear-gradient(135deg, #0f172a 0%, #1e293b 100%)",
    color: "white",
  },

  eyebrow: {
    margin: "0 0 6px",
    fontSize: 12,
    textTransform: "uppercase",
    letterSpacing: "0.12em",
    color: "#93c5fd",
    fontWeight: 900,
  },

  title: {
    margin: 0,
    fontSize: 36,
  },

  subtitle: {
    margin: "8px 0 0",
    color: "#cbd5e1",
    maxWidth: 760,
    lineHeight: 1.5,
  },

  summaryGrid: {
    display: "grid",
    gridTemplateColumns:
      "repeat(auto-fit, minmax(180px, 1fr))",
    gap: 14,
  },

  summaryCard: {
    padding: 18,
    borderRadius: 14,
    background: "white",
    border: "1px solid #e2e8f0",
  },

  summaryValue: {
    fontSize: 30,
    fontWeight: 900,
    color: "#0f172a",
  },

  summaryLabel: {
    marginTop: 4,
    color: "#64748b",
    fontWeight: 700,
  },

  toolbar: {
    display: "flex",
    gap: 12,
    flexWrap: "wrap",
    padding: 16,
    background: "white",
    borderRadius: 14,
    border: "1px solid #e2e8f0",
  },

  search: {
    flex: "1 1 360px",
    padding: "11px 12px",
    border: "1px solid #cbd5e1",
    borderRadius: 9,
    fontSize: 14,
  },

  select: {
    minWidth: 190,
    padding: "11px 12px",
    border: "1px solid #cbd5e1",
    borderRadius: 9,
    background: "white",
  },

  error: {
    padding: 14,
    borderRadius: 10,
    background: "#fee2e2",
    color: "#991b1b",
    fontWeight: 700,
  },

  success: {
    padding: 14,
    borderRadius: 10,
    background: "#dcfce7",
    color: "#166534",
    fontWeight: 700,
  },

  empty: {
    padding: 36,
    borderRadius: 14,
    background: "white",
    color: "#64748b",
    textAlign: "center",
    border: "1px solid #e2e8f0",
  },

  jobList: {
    display: "grid",
    gap: 18,
  },

  jobCard: {
    padding: 22,
    borderRadius: 16,
    background: "white",
    border: "1px solid #e2e8f0",
    boxShadow: "0 8px 24px rgba(15,23,42,0.06)",
  },

  jobHeader: {
    display: "flex",
    justifyContent: "space-between",
    gap: 16,
    alignItems: "flex-start",
    marginBottom: 18,
  },

  reference: {
    fontSize: 13,
    color: "#2563eb",
    fontWeight: 900,
  },

  customer: {
    margin: "4px 0",
    fontSize: 21,
    color: "#0f172a",
  },

  jobMeta: {
    color: "#64748b",
    fontSize: 13,
  },

  stopList: {
    display: "grid",
    gap: 14,
  },

  stopCard: {
    padding: 18,
    borderRadius: 14,
    border: "1px solid #e2e8f0",
    background: "#f8fafc",
  },

  stopHeader: {
    display: "flex",
    justifyContent: "space-between",
    gap: 12,
    alignItems: "flex-start",
    flexWrap: "wrap",
  },

  stopTitle: {
    fontWeight: 900,
    color: "#0f172a",
  },

  address: {
    marginTop: 4,
    color: "#334155",
  },

  muted: {
    marginTop: 4,
    color: "#64748b",
    fontSize: 12,
  },

  stopBadges: {
    display: "flex",
    gap: 8,
    flexWrap: "wrap",
  },

  statusBadge: {
    display: "inline-flex",
    padding: "6px 10px",
    borderRadius: 999,
    fontSize: 12,
    fontWeight: 900,
  },

  evidenceBadge: {
    display: "inline-flex",
    padding: "6px 10px",
    borderRadius: 999,
    background: "#dbeafe",
    color: "#1d4ed8",
    fontSize: 12,
    fontWeight: 900,
  },

  delivered: {
    marginTop: 12,
    padding: 10,
    borderRadius: 9,
    background: "#dcfce7",
    color: "#166534",
    fontWeight: 700,
  },

  deliveryBody: {
    display: "grid",
    gap: 16,
    marginTop: 16,
  },

  formGrid: {
    display: "grid",
    gridTemplateColumns:
      "repeat(auto-fit, minmax(240px, 1fr))",
    gap: 12,
  },

  field: {
    display: "grid",
    gap: 6,
  },

  label: {
    fontSize: 12,
    color: "#334155",
    fontWeight: 800,
  },

  input: {
    width: "100%",
    boxSizing: "border-box",
    border: "1px solid #cbd5e1",
    borderRadius: 9,
    padding: "11px 12px",
    background: "white",
    color: "#0f172a",
  },

  uploadGrid: {
    display: "grid",
    gridTemplateColumns:
      "repeat(auto-fit, minmax(260px, 1fr))",
    gap: 12,
  },

  uploadCard: {
    display: "grid",
    gap: 12,
    padding: 18,
    minHeight: 140,
    alignContent: "space-between",
    borderRadius: 4,
    background: "#ffffff",
    border: "2px solid #b1b4b6",
  },

  uploadTitle: {
    display: "block",
    fontSize: 15,
    fontWeight: 900,
    color: "#0b0c0c",
    marginBottom: 5,
  },

  uploadDescription: {
    color: "#505a5f",
    fontSize: 13,
    lineHeight: 1.4,
  },

  uploadButton: {
    width: "100%",
    minHeight: 50,
    padding: "12px 16px",
    border: "2px solid #0b0c0c",
    borderRadius: 4,
    background: "#ffffff",
    color: "#0b0c0c",
    fontSize: 14,
    fontWeight: 900,
    letterSpacing: "0.02em",
    textAlign: "center",
    boxShadow: "0 2px 0 #929191",
  },

  hiddenFileInput: {
    display: "none",
  },

  uploading: {
    color: "#2563eb",
    fontWeight: 700,
    fontSize: 12,
  },

  evidenceSection: {
    display: "grid",
    gap: 10,
  },

  evidenceTitle: {
    margin: 0,
    fontSize: 15,
    color: "#0f172a",
  },

  evidenceGrid: {
    display: "grid",
    gap: 8,
  },

  evidenceItem: {
    display: "flex",
    justifyContent: "space-between",
    gap: 12,
    alignItems: "center",
    padding: 12,
    borderRadius: 10,
    background: "white",
    border: "1px solid #e2e8f0",
    flexWrap: "wrap",
  },

  evidenceActions: {
    display: "flex",
    gap: 10,
    alignItems: "center",
  },

  legacyBox: {
    padding: 12,
    borderRadius: 10,
    background: "#fffbeb",
    border: "1px solid #fde68a",
  },

  linkList: {
    display: "flex",
    gap: 12,
    flexWrap: "wrap",
    marginTop: 7,
  },

  noEvidence: {
    padding: 12,
    borderRadius: 10,
    background: "white",
    border: "1px dashed #cbd5e1",
    color: "#64748b",
  },

  actions: {
    display: "flex",
    gap: 16,
    flexWrap: "wrap",
    justifyContent: "space-between",
    alignItems: "center",
    paddingTop: 20,
    marginTop: 8,
    borderTop: "2px solid #b1b4b6",
  },

  primaryButton: {
    minWidth: 220,
    minHeight: 52,
    padding: "12px 22px",
    border: "2px solid #005a30",
    borderRadius: 4,
    background: "#00703c",
    color: "#ffffff",
    fontSize: 15,
    fontWeight: 900,
    letterSpacing: "0.02em",
    cursor: "pointer",
    textAlign: "center",
    boxShadow: "0 2px 0 #003d21",
  },

  secondaryButton: {
    minWidth: 180,
    minHeight: 52,
    padding: "12px 22px",
    border: "2px solid #0b0c0c",
    borderRadius: 4,
    background: "#f3f2f1",
    color: "#0b0c0c",
    fontSize: 15,
    fontWeight: 900,
    letterSpacing: "0.02em",
    cursor: "pointer",
    textAlign: "center",
    boxShadow: "0 2px 0 #929191",
  },

  deleteButton: {
    padding: "6px 9px",
    borderRadius: 8,
    border: "1px solid #fecaca",
    background: "#fff1f2",
    color: "#be123c",
    fontWeight: 800,
    cursor: "pointer",
  },
};