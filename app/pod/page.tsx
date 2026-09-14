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
import MessageBanner from "../../components/MessageBanner";
import Skeleton from "../../components/Skeleton";
import Stat from "../../components/Stat";
import Textarea from "../../components/Textarea";
import { shouldShowSkeleton } from "../../lib/loading/skeletonVisibility";
import { chunk, fetchAllPages, type PageResponse } from "../../lib/jobs/fetchPages";
import { saveStopPod } from "../../lib/pod/savePod";
import {
  errorFromBody,
  readJsonSafe,
  uploadEvidenceViaSignedUrl,
} from "../../lib/pod/uploadClient";

/* Hard ceiling for the POD job list. Past it the page says so instead of
   silently losing rows at Supabase's 1000-row cap (review POD-13). */
const POD_JOBS_MAX_ROWS = 5000;

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
  collected_at: string | null;
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
  external_reference: string | null;
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
  // Stays true across refetches so a token refresh cannot flash a skeleton over
  // POD rows already on screen. See lib/loading/skeletonVisibility.ts.
  const [hasLoaded, setHasLoaded] = useState(false);
  const [dataTenantId, setDataTenantId] = useState<string | null | undefined>(undefined);

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
      setDataTenantId(activeTenantId);
      setLoading(false);
      setHasLoaded(true);
      return;
    }

    setLoading(true);
    clearMessages();

    try {
      const jobsPage = await fetchAllPages<Job>(
        (from, to) =>
        supabase
          .from("jobs")
          .select(`
            id,
            tenant_id,
            reference,
            external_reference,
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
              collected_at,
              delivered_at,
              pod_notes,
              pod_photo_url,
              pod_document_url,
              pod_updated_at
            )
          `, { count: "exact" })
          .eq("tenant_id", activeTenantId)
          .order("created_at", { ascending: false })
          .range(from, to) as unknown as PromiseLike<PageResponse<Job>>,
        { pageSize: 500, maxRows: POD_JOBS_MAX_ROWS }
      );

      // Evidence only for the jobs on screen, paged, so a busy tenant's
      // older stops never lose their evidence to the row cap.
      const evidenceRows: PodEvidence[] = [];

      for (const jobIds of chunk(jobsPage.rows.map((job) => job.id), 150)) {
        const evidencePage = await fetchAllPages<PodEvidence>(
          (from, to) =>
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
              .in("job_id", jobIds)
              .order("created_at", { ascending: false })
              .range(from, to) as unknown as PromiseLike<PageResponse<PodEvidence>>,
          { pageSize: 1000, maxRows: 1_000_000 }
        );

        evidenceRows.push(...evidencePage.rows);
      }

      if (jobsPage.truncated) {
        setErrorMessage(
          `Only the newest ${jobsPage.rows.length} of ${jobsPage.total ?? "more"} jobs are loaded. Older jobs are not shown.`
        );
      }

      const normalizedJobs = jobsPage.rows.map(
        (job) => ({
          ...job,
          job_stops: [...(job.job_stops ?? [])].sort(
            (a, b) => a.stop_order - b.stop_order
          ),
        })
      );

      setJobs(normalizedJobs);
      setEvidence(evidenceRows);

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
      setDataTenantId(activeTenantId);
    } catch (error) {
      setErrorMessage(
        error instanceof Error ? error.message : "Unable to load POD records."
      );
    } finally {
      setLoading(false);
      setHasLoaded(true);
    }
  }, [activeTenantId, clearMessages, supabase]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  /* One region, one flag: the job list is the only thing here that renders
     tenant data. The filter <select> feeds a form control, which
     skeletonVisibility excludes. */
  const showSkeleton = shouldShowSkeleton({
    tenantStatus: tenant.status,
    fetching: loading,
    hasData: hasLoaded,
    activeTenantId,
    dataTenantId,
  });

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
    files: File[],
    job: Job,
    stop: JobStop,
    evidenceType: Exclude<EvidenceType, "signature">
  ) {
    if (files.length === 0) {
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

      for (const file of files) {
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

        // The server picks the storage path and records the row after
        // checking the stored file (review POD-2, POD-10, POD-17).
        await uploadEvidenceViaSignedUrl({
          fetchImpl: fetch,
          storage: supabase.storage.from(POD_BUCKET),
          uploadUrlEndpoint: "/api/pod/evidence/upload-url",
          recordEndpoint: "/api/pod/evidence",
          file,
          filename: file.name,
          mimeType: file.type,
          extraBody: {
            tenantId: activeTenantId,
            jobId: job.id,
            stopId: stop.id,
            evidenceType,
          },
        });
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
      // Server route: removes the row and the storage object, which the
      // bucket refuses to delete for signed-in clients (review POD-17).
      const response = await fetch(
        `/api/pod/evidence/${encodeURIComponent(item.id)}?tenantId=${encodeURIComponent(activeTenantId)}`,
        { method: "DELETE" }
      );

      const body = await readJsonSafe(response);

      if (!response.ok) {
        throw new Error(
          errorFromBody(body, response.status, "Unable to delete POD evidence.")
        );
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
    markComplete: boolean
  ) {
    if (!activeTenantId || stop.tenant_id !== activeTenantId) {
      setErrorMessage("This stop does not belong to the active tenant.");
      return;
    }

    const isCollection = stop.type === "collection";
    const isDelivery = stop.type === "delivery";

    if (!isCollection && !isDelivery) {
      setErrorMessage("This stop type does not support POD.");
      return;
    }

    const form = forms[stop.id] ?? {
      recipient_name: "",
      pod_notes: "",
    };

    clearMessages();

    if (markComplete && !form.recipient_name.trim()) {
      setErrorMessage(
        isCollection
          ? "Collection contact is required before marking the stop collected."
          : "Recipient name is required before completing delivery."
      );
      return;
    }

    if (markComplete && !hasPodEvidence(stop)) {
      setErrorMessage(
        isCollection
          ? "Upload at least one collection photo or document before marking the stop collected."
          : "Upload at least one POD photo or document before completing delivery."
      );
      return;
    }

    setSavingStopId(stop.id);

    try {
      // One shared save for both consoles (review POD-12, POD-14).
      await saveStopPod(supabase, {
        tenantId: activeTenantId,
        jobId: job.id,
        stopId: stop.id,
        stopType: stop.type,
        recipientName: form.recipient_name,
        podNotes: form.pod_notes,
        markComplete,
      });

      setMessage(
        markComplete
          ? isCollection
            ? "Collection POD completed and stop marked collected."
            : "POD completed and delivery stop marked delivered."
          : isCollection
            ? "Collection POD draft saved."
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
  async function createShare(
    job: Job
  ) {
    if (!activeTenantId) {
      throw new Error(
        "No active tenant is selected."
      );
    }

    const response = await fetch(
      "/api/pod/share",
      {
        method: "POST",
        headers: {
          "Content-Type":
            "application/json",
        },
        body: JSON.stringify({
          jobId: job.id,
          tenantId:
            activeTenantId,
        }),
      }
    );

    const result =
      (await response.json()) as {
        shareUrl?: string;
        pdfUrl?: string;
        reference?: string | null;
        isCambridge?: boolean;
        contactName?: string | null;
        contactEmail?: string | null;
        contactPhone?: string | null;
        error?: string;
      };

    if (
      !response.ok ||
      !result.shareUrl ||
      !result.pdfUrl
    ) {
      throw new Error(
        result.error ||
          "Unable to create POD share."
      );
    }

    return {
      shareUrl:
        result.shareUrl,
      pdfUrl:
        result.pdfUrl,
      reference:
        result.reference ?? job.reference,
      isCambridge:
        result.isCambridge ?? false,
      contactName:
        result.contactName ?? null,
      contactEmail:
        result.contactEmail ?? null,
      contactPhone:
        result.contactPhone ?? null,
    };
  }

  async function viewSharedPod(
    job: Job
  ) {
    clearMessages();

    try {
      const share =
        await createShare(job);

      window.open(
        share.shareUrl,
        "_blank",
        "noopener,noreferrer"
      );
    } catch (error) {
      setErrorMessage(
        error instanceof Error
          ? error.message
          : "Unable to open shared POD."
      );
    }
  }

  async function downloadPodPdf(
    job: Job
  ) {
    clearMessages();

    try {
      const share =
        await createShare(job);

      window.open(
        share.pdfUrl,
        "_blank",
        "noopener,noreferrer"
      );
    } catch (error) {
      setErrorMessage(
        error instanceof Error
          ? error.message
          : "Unable to generate POD PDF."
      );
    }
  }

  async function copyPodShareLink(
    job: Job
  ) {
    clearMessages();

    try {
      const share =
        await createShare(job);

      await navigator.clipboard.writeText(
        share.shareUrl
      );

      setMessage(
        "Secure POD link copied. It expires automatically."
      );
    } catch (error) {
      setErrorMessage(
        error instanceof Error
          ? error.message
          : "Unable to copy POD share link."
      );
    }
  }
  /* Withdraw every live share link for a job (review POD-9). */
  async function revokePodShares(
    job: Job
  ) {
    clearMessages();

    if (!activeTenantId) {
      setErrorMessage("No active tenant is selected.");
      return;
    }

    const confirmed = window.confirm(
      "Withdraw every POD link already shared for this job? Anyone holding one will no longer be able to open it."
    );

    if (!confirmed) {
      return;
    }

    try {
      const response = await fetch("/api/pod/share/revoke", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jobId: job.id, tenantId: activeTenantId }),
      });

      const body = await readJsonSafe(response);

      if (!response.ok) {
        throw new Error(
          errorFromBody(body, response.status, "Unable to withdraw POD links.")
        );
      }

      const revoked = typeof body.revoked === "number" ? body.revoked : 0;

      setMessage(
        revoked === 0
          ? "There were no live POD links for this job."
          : `Withdrew ${revoked} POD ${revoked === 1 ? "link" : "links"}.`
      );
    } catch (error) {
      setErrorMessage(
        error instanceof Error
          ? error.message
          : "Unable to withdraw POD links."
      );
    }
  }

  async function emailPod(
    job: Job
  ) {
    clearMessages();

    try {
      const share =
        await createShare(job);

      const recipient =
        window.prompt(
          "Email POD to (an address saved on the customer, or your own):",
          share.contactEmail ?? ""
        );

      if (!recipient?.trim()) {
        return;
      }

      const response = await fetch(
        "/api/pod/share/email",
        {
          method: "POST",
          headers: {
            "Content-Type":
              "application/json",
          },
          body: JSON.stringify({
            jobId: job.id,
            tenantId:
              activeTenantId,
            to:
              recipient.trim(),
          }),
        }
      );

      const result =
        (await response.json()) as {
          recipient?: string;
          error?: string;
        };

      if (!response.ok) {
        throw new Error(
          result.error ||
            "Unable to email POD."
        );
      }

      setMessage(
        `POD emailed successfully to ${result.recipient ?? recipient.trim()}.`
      );
    } catch (error) {
      setErrorMessage(
        error instanceof Error
          ? error.message
          : "Unable to email POD."
      );
    }
  }

  function normalizeWhatsAppPhone(
    value: string | null
  ) {
    if (!value) {
      return "";
    }

    const trimmed =
      value.trim();

    if (!trimmed) {
      return "";
    }

    let digits =
      trimmed.replace(
        /\D/g,
        ""
      );

    if (
      trimmed.startsWith("0") &&
      digits.startsWith("0")
    ) {
      digits =
        `44${digits.slice(1)}`;
    }

    return digits;
  }

  async function whatsappPod(
    job: Job
  ) {
    clearMessages();

    try {
      const share =
        await createShare(job);

      const reference =
        share.reference ||
        job.reference ||
        "POD";

      const text =
        `Proof of Delivery for ${reference} is now available: ${share.shareUrl}`;

      const phone =
        normalizeWhatsAppPhone(
          share.contactPhone
        );

      const url =
        phone
          ? `https://wa.me/${phone}?text=${encodeURIComponent(
              text
            )}`
          : `https://wa.me/?text=${encodeURIComponent(
              text
            )}`;

      window.open(
        url,
        "_blank",
        "noopener,noreferrer"
      );
    } catch (error) {
      setErrorMessage(
        error instanceof Error
          ? error.message
          : "Unable to create WhatsApp POD message."
      );
    }
  }

  async function pingCambridge(
    job: Job
  ) {
    clearMessages();

    if (!activeTenantId) {
      setErrorMessage(
        "No active tenant is selected."
      );
      return;
    }

    try {
      const response = await fetch(
        "/api/pod/share/email",
        {
          method: "POST",
          headers: {
            "Content-Type":
              "application/json",
          },
          body: JSON.stringify({
            jobId: job.id,
            tenantId:
              activeTenantId,
            useCustomerContact:
              true,
          }),
        }
      );

      const result =
        (await response.json()) as {
          recipient?: string;
          error?: string;
        };

      if (!response.ok) {
        throw new Error(
          result.error ||
            "Unable to notify Cambridge."
        );
      }

      setMessage(
        `Cambridge POD notification sent to ${result.recipient ?? "the Cambridge contact"}.`
      );
    } catch (error) {
      setErrorMessage(
        error instanceof Error
          ? error.message
          : "Unable to notify Cambridge."
      );
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

          <MessageBanner tone="danger">{errorMessage}</MessageBanner>

          <MessageBanner tone="success">{message}</MessageBanner>

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

          {showSkeleton ? (
            <div aria-busy>
              <span className="sr-only" role="status">
                Loading POD records
              </span>

              {[0, 1, 2, 3, 4, 5].map((index) => (
                <section
                  key={`pod-skeleton-${index}`}
                  className="mb-2 rounded-lg border border-line bg-surface px-3 py-2.5 shadow-sm"
                >
                  <div className="grid gap-3 md:grid-cols-[minmax(145px,1.1fr)_minmax(180px,1.5fr)_100px_115px_160px_auto] md:items-center">
                    <Skeleton w="12ch" h="0.875rem" />
                    <Skeleton w="16ch" h="0.875rem" />
                    <Skeleton w="6ch" h="1.375rem" pill />
                    <Skeleton w="7ch" h="0.875rem" />
                    <Skeleton w="10ch" h="0.875rem" />
                    <Skeleton w="5rem" h="2rem" />
                  </div>
                </section>
              ))}
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

                          {stop.collected_at ? (
                            <div className="mt-3 rounded-lg border border-success-border bg-success-tint p-2.5 text-sm font-medium text-success-strong">
                              Collected{" "}
                              {formatDateTime(stop.collected_at)}
                              {stop.recipient_name
                                ? ` by ${stop.recipient_name}`
                                : ""}
                            </div>
                          ) : null}
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
                          {stop.collected_at ? (
                            <div className="mt-3 rounded-lg border border-success-border bg-success-tint p-2.5 text-sm font-medium text-success-strong">
                              Collected{" "}
                              {formatDateTime(stop.collected_at)}
                              {stop.recipient_name
                                ? ` by ${stop.recipient_name}`
                                : ""}
                            </div>
                          ) : null}
                          {stop.delivered_at ? (
                            <div className="mt-3 rounded-lg border border-line bg-surface p-3">
                              <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-3">
                                Share POD
                              </div>

                              <div className="flex flex-wrap gap-2">
                                <Button
                                  variant="secondary"
                                  size="sm"
                                  onClick={() =>
                                    void viewSharedPod(
                                      job
                                    )
                                  }
                                >
                                  VIEW POD
                                </Button>

                                <Button
                                  variant="secondary"
                                  size="sm"
                                  onClick={() =>
                                    void downloadPodPdf(
                                      job
                                    )
                                  }
                                >
                                  DOWNLOAD PDF
                                </Button>

                                <Button
                                  variant="secondary"
                                  size="sm"
                                  onClick={() =>
                                    void copyPodShareLink(
                                      job
                                    )
                                  }
                                >
                                  COPY LINK
                                </Button>
                                <Button
                                  variant="secondary"
                                  size="sm"
                                  onClick={() =>
                                    void revokePodShares(
                                      job
                                    )
                                  }
                                >
                                  WITHDRAW LINKS
                                </Button>
                                <Button
                                  variant="secondary"
                                  size="sm"
                                  onClick={() =>
                                    void emailPod(
                                      job
                                    )
                                  }
                                >
                                  EMAIL POD
                                </Button>

                                <Button
                                  variant="secondary"
                                  size="sm"
                                  onClick={() =>
                                    void whatsappPod(
                                      job
                                    )
                                  }
                                >
                                  WHATSAPP
                                </Button>

                                {job.external_reference?.startsWith(
                                  "CAMBRIDGE-RMA-"
                                ) ? (
                                  <Button
                                    variant="secondary"
                                    size="sm"
                                    onClick={() =>
                                      void pingCambridge(
                                        job
                                      )
                                    }
                                  >
                                    PING CAMBRIDGE
                                  </Button>
                                ) : null}
                              </div>
                            </div>
                          ) : null}

                          {(stop.type === "collection" ||
                          stop.type === "delivery") ? (
                            <div className="mt-4 grid gap-4">
                              <div className="grid gap-3 sm:grid-cols-2">
                                <Field
                                  id={`pod-${stop.id}-recipient`}
                                  label={stop.type === "collection" ? "Collection Contact" : "Recipient Name"}
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
                                  placeholder={stop.type === "collection" ? "Who released or handed over the load?" : "Who received the delivery?"}
                                />

                                <Textarea
                                  id={`pod-${stop.id}-notes`}
                                  label={stop.type === "collection" ? "Collection Notes" : "POD Notes"}
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
                                  placeholder={stop.type === "collection" ? "Collection notes, condition, quantities or other collection information..." : "Delivery notes, condition, quantities or other POD information..."}
                                />
                              </div>

                              <div className="grid gap-3 sm:grid-cols-2">
                                <EvidenceUpload
                                  title={stop.type === "collection" ? "Collection Photos" : "Delivery Photos"}
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
                                    const selectedFiles = Array.from(
                                      event.currentTarget.files ?? []
                                    );

                                    event.currentTarget.value = "";

                                    void uploadFiles(
                                      selectedFiles,
                                      job,
                                      stop,
                                      "photo"
                                    );
                                  }}
                                />

                                <EvidenceUpload
                                  title={stop.type === "collection" ? "Collection Documents" : "Delivery Documents"}
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
                                    const selectedFiles = Array.from(
                                      event.currentTarget.files ?? []
                                    );

                                    event.currentTarget.value = "";

                                    void uploadFiles(
                                      selectedFiles,
                                      job,
                                      stop,
                                      "document"
                                    );
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
                                    : stop.type === "collection" ? "SAVE COLLECTION DRAFT" : "SAVE POD DRAFT"}
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
                                      : stop.type === "collection" ? "MARK COLLECTED" : "COMPLETE DELIVERY"}
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
            "hover:bg-surface-hover",
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
    normalized === "collected" ||
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
