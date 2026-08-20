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
import { useTenant } from "../components/TenantProvider";

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
  status: string | null;
  pod_status: string | null;
  recipient_name: string | null;
  delivered_at: string | null;
  pod_notes: string | null;
  pod_photo_url: string | null;
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
  onMarkDelivered: (stopId: string) => void;
};

export default function StopCard({
  jobId,
  tenantId,
  stop,
  podForm,
  onPodFieldChange,
  onMarkDelivered,
}: Props) {
  const supabase = useMemo(() => createClient(), []);
  const tenant = useTenant();

  const [evidence, setEvidence] = useState<PodEvidence[]>([]);
  const [uploading, setUploading] = useState<EvidenceType | "">("");
  const [evidenceError, setEvidenceError] = useState("");
  const [evidenceMessage, setEvidenceMessage] = useState("");

  const cameraInputRef = useRef<HTMLInputElement>(null);
  const photoInputRef = useRef<HTMLInputElement>(null);
  const documentInputRef = useRef<HTMLInputElement>(null);

  const activeTenantId = tenant.activeTenantId;

  const form: PodFormState = podForm ?? {
    recipient_name: "",
    pod_notes: "",
    pod_photo_url: "",
  };

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
    files: FileList | null,
    evidenceType: EvidenceType
  ) {
    if (!files?.length) {
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

      for (const file of Array.from(files)) {
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

        const safeName = file.name.replace(
          /[^a-zA-Z0-9.\-_]/g,
          "_"
        );

        const folder =
          evidenceType === "photo"
            ? "photos"
            : "documents";

        const storagePath =
          `${activeTenantId}/${jobId}/${stop.id}/${folder}/` +
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

        const { error: insertError } = await supabase
          .from("pod_evidence")
          .insert({
            tenant_id: activeTenantId,
            job_id: jobId,
            stop_id: stop.id,
            evidence_type: evidenceType,
            storage_path: storagePath,
            original_filename: file.name,
            mime_type: file.type || null,
            file_size_bytes: file.size,
            created_by: user.id,
          });

        if (insertError) {
          await supabase.storage
            .from(POD_BUCKET)
            .remove([storagePath]);

          throw insertError;
        }
      }

      setEvidenceMessage(
        evidenceType === "photo"
          ? "POD photo uploaded successfully."
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
      const { error: storageError } = await supabase.storage
        .from(POD_BUCKET)
        .remove([item.storage_path]);

      if (storageError) {
        throw storageError;
      }

      const { error: deleteError } = await supabase
        .from("pod_evidence")
        .delete()
        .eq("id", item.id)
        .eq("tenant_id", activeTenantId)
        .eq("job_id", jobId)
        .eq("stop_id", stop.id);

      if (deleteError) {
        throw deleteError;
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

  function handleMarkDelivered() {
    clearMessages();

    if (!tenantMatches) {
      setEvidenceError(
        "This job does not belong to the active tenant."
      );
      return;
    }

    if (!form.recipient_name.trim()) {
      setEvidenceError(
        "Recipient name is required before marking this delivery complete."
      );
      return;
    }

    if (evidence.length === 0 && !stop.pod_photo_url) {
      setEvidenceError(
        "Upload at least one POD photo or document before marking this delivery complete."
      );
      return;
    }

    onMarkDelivered(stop.id);
  }

  const busy = Boolean(uploading);

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

      <div className="mt-1.5 text-xs text-ink-3">
        Stop status: {stop.status || "-"} · POD:{" "}
        {stop.pod_status || "pending"}
      </div>

      {stop.delivered_at ? (
        <div className="mt-1.5 text-xs text-ink-3">
          Delivered at:{" "}
          {new Date(
            stop.delivered_at
          ).toLocaleString("en-GB")}
        </div>
      ) : null}

      {stop.recipient_name ? (
        <div className="mt-1.5 text-sm text-ink">
          Recipient: {stop.recipient_name}
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

      {stop.type === "delivery" &&
      stop.pod_status !== "delivered" ? (
        <div className="mt-3 grid max-w-xl gap-3">
          <Field
            id={`recipient-${stop.id}`}
            label="Recipient name"
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
            label="POD notes"
            value={form.pod_notes}
            onChange={(event) =>
              onPodFieldChange(
                stop.id,
                "pod_notes",
                event.target.value
              )
            }
          />

          <div className="rounded-md border border-line bg-surface p-3">
            <div className="text-sm font-semibold text-ink">
              POD evidence
            </div>

            <div className="mt-1 text-xs text-ink-3">
              Take a delivery photo or upload a POD
              document. Maximum 15 MB per file.
            </div>

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
                  event.target.files,
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
                  event.target.files,
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
                  event.target.files,
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

          <div>
            <Button
              type="button"
              disabled={busy || !tenantMatches}
              onClick={handleMarkDelivered}
            >
              Mark Delivered
            </Button>
          </div>
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