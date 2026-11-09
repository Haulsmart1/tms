"use client";

import {
  type ChangeEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import Button from "../../components/Button";
import Field from "../../components/Field";
import { createClient } from "../../lib/supabase/browser";
import PodLink from "../components/PodLink";
import SendTrackingLinkDialog from "./SendTrackingLinkDialog";
import { useTenant } from "../components/TenantProvider";
import { initialStopPodForm } from "../../lib/pod/consolePod";
import { isStopLocked } from "../../lib/jobs/stopDiff";
import { isDeferredDelivery } from "../../lib/pod/deferredEvidence";
import {
  errorFromBody,
  readJsonSafe,
  uploadEvidenceViaSignedUrl,
} from "../../lib/pod/uploadClient";

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

type EvidenceType = "photo" | "document";

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
  created_at: string;
};

export type Stop = {
  id: string;
  stop_order: number;
  type: "collection" | "delivery";
  address_line: string;
  city: string | null;
  postcode: string | null;
  contact_name: string | null;
  contact_phone: string | null;
  contact_email: string | null;
  status: string | null;
  pod_status: string | null;
  recipient_name: string | null;
  delivered_at: string | null;
  collected_at?: string | null;
  pod_notes: string | null;
  pod_photo_url: string | null;
  pod_document_url?: string | null;
  /** Set by the driver routes (tracking_02): pod_time_untrusted, pod_late_sync. */
  pod_flags?: string[] | null;
};

export type PodFormState = {
  recipient_name: string;
  pod_notes: string;
  pod_photo_url: string;
};

type Props = {
  jobId: string;
  tenantId: string;
  stop: Stop;
  podForm: PodFormState | undefined;
  onPodFieldChange: (
    stopId: string,
    field: keyof PodFormState,
    value: string
  ) => void;
  onMarkDelivered: (stopId: string, deferEvidence?: boolean) => Promise<boolean>;
  onMarkCollected: (stopId: string) => Promise<boolean>;
};

export default function StopCard({
  jobId,
  tenantId,
  stop,
  podForm,
  onPodFieldChange,
  onMarkDelivered,
  onMarkCollected,
}: Props) {
  const supabase = useMemo(() => createClient(), []);
  const tenant = useTenant();

  const [evidence, setEvidence] = useState<PodEvidence[]>([]);
  const [uploading, setUploading] = useState<EvidenceType | "">("");
  const [evidenceError, setEvidenceError] = useState("");
  const [evidenceMessage, setEvidenceMessage] = useState("");
  const [trackingOpen, setTrackingOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [addPhotoLater, setAddPhotoLater] = useState(false);
  const saveInFlight = useRef(false);

  const cameraInputRef = useRef<HTMLInputElement>(null);
  const photoInputRef = useRef<HTMLInputElement>(null);
  const documentInputRef = useRef<HTMLInputElement>(null);

  const activeTenantId = tenant.activeTenantId;

  const form: PodFormState = podForm ?? initialStopPodForm(stop);
  const locked = isStopLocked(stop);
  const deferredDelivery = isDeferredDelivery(stop);
  const hasEvidence = evidence.length > 0 || Boolean(stop.pod_photo_url || stop.pod_document_url);

  const tenantMatches =
    Boolean(activeTenantId) && activeTenantId === tenantId;

  const loadEvidence = useCallback(async () => {
    if (!activeTenantId || activeTenantId !== tenantId) {
      setEvidence([]);
      return;
    }

    const { data, error } = await supabase
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
        created_at
      `)
      .eq("tenant_id", activeTenantId)
      .eq("job_id", jobId)
      .eq("stop_id", stop.id)
      .order("created_at", { ascending: false });

    if (error) {
      setEvidenceError(error.message);
      return;
    }

    setEvidence((data ?? []) as PodEvidence[]);
  }, [
    activeTenantId,
    jobId,
    stop.id,
    supabase,
    tenantId,
  ]);

  useEffect(() => {
    void loadEvidence();
  }, [loadEvidence]);

  function clearMessages() {
    setEvidenceError("");
    setEvidenceMessage("");
  }

  async function uploadFiles(
    files: File[],
    evidenceType: EvidenceType
  ) {
    if (!files.length) {
      return;
    }

    if (!activeTenantId || activeTenantId !== tenantId) {
      setEvidenceError(
        "This job does not belong to the active tenant."
      );
      return;
    }

    clearMessages();
    setUploading(evidenceType);

    try {
      const {
        data: { user },
        error: userError,
      } = await supabase.auth.getUser();

      if (userError) {
        throw userError;
      }

      if (!user) {
        throw new Error(
          "You must be signed in to upload POD evidence."
        );
      }

      for (const file of files) {
        if (file.size > MAX_FILE_SIZE) {
          throw new Error(
            `${file.name} exceeds the 15 MB POD upload limit.`
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
        // checking the stored file (review POD-10, POD-17).
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
            jobId,
            stopId: stop.id,
            evidenceType,
          },
        });
      }

      setEvidenceMessage(
        locked ? "Evidence saved. Delivery remains complete." : evidenceType === "photo"
          ? stop.type === "delivery"
            ? "Photo saved. You can now mark delivered."
            : "POD photo uploaded successfully."
          : stop.type === "delivery"
            ? "POD document saved. You can now mark delivered."
            : "POD document uploaded successfully."
      );

      await loadEvidence();
    } catch (error) {
      setEvidenceError(
        error instanceof Error
          ? error.message
          : "Unable to upload POD evidence."
      );
    } finally {
      setUploading("");
    }
  }

  async function deleteEvidence(item: PodEvidence) {
    if (!activeTenantId || activeTenantId !== tenantId) {
      setEvidenceError(
        "This job does not belong to the active tenant."
      );
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

      setEvidenceMessage("POD evidence deleted.");
      await loadEvidence();
    } catch (error) {
      setEvidenceError(
        error instanceof Error
          ? error.message
          : "Unable to delete POD evidence."
      );
    }
  }

  async function handleMarkComplete() {
    if (saveInFlight.current || uploading || locked) return;
    clearMessages();

    if (!tenantMatches) {
      setEvidenceError(
        "This job does not belong to the active tenant."
      );
      return;
    }

    if (!form.recipient_name.trim()) {
      setEvidenceError(
        stop.type === "collection" ? "Enter the name of the person the goods were collected from."
          : "Recipient name is required before marking this delivery complete."
      );
      return;
    }

    if (stop.type === "delivery" && !hasEvidence && !addPhotoLater) {
      setEvidenceError(
        "Add one delivery photo or POD document, or tick Add photo later to save this delivery now."
      );
      return;
    }

    saveInFlight.current = true;
    setSaving(true);
    try {
      const saved = await (stop.type === "collection" ? onMarkCollected(stop.id) : onMarkDelivered(stop.id, addPhotoLater && !hasEvidence));
      if (!saved) setEvidenceError("Unable to save. Check the job message and try again.");
    } catch (error) {
      setEvidenceError(error instanceof Error ? error.message : "Unable to save this stop.");
    } finally {
      saveInFlight.current = false;
      setSaving(false);
    }
  }

  const busy = Boolean(uploading) || saving;

  return (
    <div className="rounded-md border border-line bg-surface-2 p-3.5">
      <div className="text-sm">
        <span className="font-semibold text-ink">
          {stop.stop_order}. {stop.type}
        </span>{" "}
        <span className="text-ink-2">
          {stop.address_line}
          {stop.city ? `, ${stop.city}` : ""}
          {stop.postcode ? `, ${stop.postcode}` : ""}
        </span>
      </div>

      {stop.contact_name || stop.contact_phone || stop.contact_email ? (
        <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-sm text-ink">
          {stop.contact_name ? (
            <span>Contact: {stop.contact_name}</span>
          ) : null}

          {stop.contact_phone ? (
            <span>
              Tel:{" "}
              <a
                href={`tel:${stop.contact_phone}`}
                className="font-medium underline underline-offset-2"
              >
                {stop.contact_phone}
              </a>
            </span>
          ) : null}

          {stop.contact_email ? (
            <span>
              Email:{" "}
              <a
                href={`mailto:${stop.contact_email}`}
                className="font-medium underline underline-offset-2"
              >
                {stop.contact_email}
              </a>
            </span>
          ) : null}
        </div>
      ) : null}

      <div className="mt-1.5 text-xs text-ink-3">
        Stop status: {stop.status || "-"} · POD:{" "}
        {stop.pod_status || "pending"}
      </div>

      {stop.type === "collection" && stop.collected_at ? (
        <div className="mt-1.5 text-sm font-semibold text-ink">
          Collected at: {new Date(stop.collected_at).toLocaleString("en-GB")}
        </div>
      ) : null}

      {stop.delivered_at ? (
        <div className="mt-1.5 text-xs text-ink-3">
          Delivered at:{" "}
          {new Date(
            stop.delivered_at
          ).toLocaleString("en-GB")}
          {stop.pod_flags?.includes("pod_time_untrusted") ? (
            <span
              className="ml-1.5 rounded border border-warning-border bg-warning-tint px-1 text-xs text-warning-strong"
            >
              Time not trusted
              <span className="sr-only">
                : this delivery was saved with no signal and the phone&apos;s clock could not be trusted, so the time shown is when the server received it.
              </span>
            </span>
          ) : null}
          {stop.pod_flags?.includes("pod_late_sync") ? (
            <span
              className="ml-1.5 rounded border border-warning-border bg-warning-tint px-1 text-xs text-warning-strong"
            >
              Synced late
              <span className="sr-only">
                : the phone saved this delivery offline and it reached the server more than 15 minutes later, so the time shown is the phone&apos;s.
              </span>
            </span>
          ) : null}
        </div>
      ) : null}

      {stop.recipient_name ? (
        <div className="mt-1.5 text-sm text-ink">
          {stop.type === "collection" ? "Collected from" : "Recipient"}: {stop.recipient_name}
        </div>
      ) : null}

      {stop.pod_notes ? (
        <div className="mt-1.5 text-sm text-ink">
          Notes: {stop.pod_notes}
        </div>
      ) : null}

      {stop.pod_photo_url ? (
        <div className="mt-2">
          <PodLink
            value={stop.pod_photo_url}
            label="View legacy POD"
          />
        </div>
      ) : null}

      {stop.pod_document_url ? (
        <div className="mt-2">
          <PodLink value={stop.pod_document_url} label="View POD document" />
        </div>
      ) : null}

      {evidence.length > 0 ? (
        <div className="mt-3 grid gap-2">
          <div className="text-xs font-semibold uppercase tracking-wide text-ink-3">
            POD Evidence
          </div>

          {evidence.map((item) => (
            <div
              key={item.id}
              className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-line bg-surface p-2.5"
            >
              <div className="min-w-0">
                <div className="break-words text-sm font-medium text-ink">
                  {item.original_filename ||
                    (item.evidence_type === "photo"
                      ? "POD photo"
                      : "POD document")}
                </div>

                <div className="mt-0.5 text-xs text-ink-3">
                  {item.evidence_type === "photo"
                    ? "Photo"
                    : "Document"}
                  {" · "}
                  {formatFileSize(
                    item.file_size_bytes
                  )}
                </div>
              </div>

              <div className="flex items-center gap-2">
                <PodLink
                  value={item.storage_path}
                  label="View"
                />

                {stop.pod_status !== "delivered" ? (
                  <Button
                    type="button"
                    variant="danger"
                    size="sm"
                    disabled={busy}
                    onClick={() =>
                      void deleteEvidence(item)
                    }
                  >
                    Delete
                  </Button>
                ) : null}
              </div>
            </div>
          ))}
        </div>
      ) : null}

      {deferredDelivery && !hasEvidence ? (
        <div role="status" className="mt-3 rounded-md border border-warning-border bg-warning-tint p-3 text-sm text-warning-strong">
          Delivery saved. Photo/POD still to add. Upload it below when available.
        </div>
      ) : null}

      {!locked || deferredDelivery ? (
        <div className="mt-3 grid max-w-xl gap-3">
          {!locked ? <>
          <Field
            id={`recipient-${stop.id}`}
            label={stop.type === "collection" ? "Collected from" : "Recipient name"}
            value={form.recipient_name}
            onChange={(event) =>
              onPodFieldChange(
                stop.id,
                "recipient_name",
                event.target.value
              )
            }
          />

          <Field
            id={`notes-${stop.id}`}
            label={stop.type === "collection" ? "Collection notes (optional)" : "POD notes"}
            value={form.pod_notes}
            onChange={(event) =>
              onPodFieldChange(
                stop.id,
                "pod_notes",
                event.target.value
              )
            }
          />
          </> : null}

          <div className="rounded-md border border-line bg-surface p-3">
            <div className="text-sm font-semibold text-ink">
              {stop.type === "collection" ? "Collection evidence (optional)" : "POD evidence"}
            </div>

            <div className="mt-1 text-xs text-ink-3">
              {stop.type === "collection"
                ? "Confirm the goods have been collected. You can add a photo or document if available; it is not required."
                : "Upload one delivery photo or one POD document. Either one is enough. Maximum 15 MB per file."}
            </div>

            {stop.type === "delivery" && !locked && !hasEvidence ? (
              <label className="mt-3 flex min-h-11 cursor-pointer items-center gap-3 rounded-md border border-line p-3 text-sm text-ink">
                <input
                  type="checkbox"
                  checked={addPhotoLater}
                  disabled={busy || !tenantMatches}
                  onChange={(event) => {
                    setAddPhotoLater(event.target.checked);
                    clearMessages();
                  }}
                  className="h-5 w-5 accent-primary"
                />
                <span>
                  <span className="block font-semibold">Add photo later</span>
                  <span className="block text-xs text-ink-3">Save as delivered now. Reopen this job to add a photo or POD document later.</span>
                </span>
              </label>
            ) : null}

            <input
              ref={cameraInputRef}
              type="file"
              accept="image/*"
              capture="environment"
              className="hidden"
              disabled={busy}
              onChange={(
                event: ChangeEvent<HTMLInputElement>
              ) => {
                void uploadFiles(
                  // Copy the FileList before resetting the input: authentication
                  // awaits below, and resetting empties the live FileList.
                  Array.from(event.target.files ?? []),
                  "photo"
                );
                event.target.value = "";
              }}
            />

            <input
              ref={photoInputRef}
              type="file"
              accept="image/*"
              multiple
              className="hidden"
              disabled={busy}
              onChange={(
                event: ChangeEvent<HTMLInputElement>
              ) => {
                void uploadFiles(
                  Array.from(event.target.files ?? []),
                  "photo"
                );
                event.target.value = "";
              }}
            />

            <input
              ref={documentInputRef}
              type="file"
              accept=".pdf,.doc,.docx,.jpg,.jpeg,.png,.webp,.heic"
              multiple
              className="hidden"
              disabled={busy}
              onChange={(
                event: ChangeEvent<HTMLInputElement>
              ) => {
                void uploadFiles(
                  Array.from(event.target.files ?? []),
                  "document"
                );
                event.target.value = "";
              }}
            />

            <div className="mt-3 flex flex-wrap gap-2">
              <Button
                type="button"
                variant="secondary"
                size="sm"
                disabled={busy}
                onClick={() =>
                  cameraInputRef.current?.click()
                }
              >
                {uploading === "photo"
                  ? "Uploading..."
                  : "Take Photo"}
              </Button>

              <Button
                type="button"
                variant="secondary"
                size="sm"
                disabled={busy}
                onClick={() =>
                  photoInputRef.current?.click()
                }
              >
                Upload Photo
              </Button>

              <Button
                type="button"
                variant="secondary"
                size="sm"
                disabled={busy}
                onClick={() =>
                  documentInputRef.current?.click()
                }
              >
                {uploading === "document"
                  ? "Uploading..."
                  : "Upload POD"}
              </Button>
            </div>
          </div>

          {evidenceError ? (
            <div className="rounded-md border border-danger-border bg-danger-tint p-2.5 text-sm text-danger-strong">
              {evidenceError}
            </div>
          ) : null}

          {evidenceMessage ? (
            <div className="rounded-md border border-success-border bg-success-tint p-2.5 text-sm text-success-strong">
              {evidenceMessage}
            </div>
          ) : null}

          {!locked ? <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              disabled={busy || !tenantMatches}
              onClick={() => void handleMarkComplete()}
            >
              {saving ? "Saving…" : stop.type === "collection" ? "Mark collected" : "Mark Delivered"}
            </Button>

            {/* Same gate as the POD controls: only while this stop's own
                tenant is the active one. The routes refuse drivers and any
                caller outside the tenant, so this is presentation only. */}
            {tenantMatches && stop.type === "delivery" ? (
              <Button
                type="button"
                variant="secondary"
                onClick={() => setTrackingOpen(true)}
              >
                Send tracking link
              </Button>
            ) : null}
          </div> : null}

          {!locked && tenantMatches && stop.type === "delivery" ? (
            <SendTrackingLinkDialog
              open={trackingOpen}
              onClose={() => setTrackingOpen(false)}
              tenantId={tenantId}
              stopId={stop.id}
            />
          ) : null}
        </div>
      ) : null}
    </div>
  );
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
