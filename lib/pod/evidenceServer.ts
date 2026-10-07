/*
  Server-only helpers shared by the office and driver evidence routes.
  Never import from client code.
*/

import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { buildPodEvidencePath, buildQueuedPodEvidencePath, type PodEvidenceFolder, type PodEvidenceOwner } from "./evidencePath";
import { POD_BUCKET } from "./podUrl";
import { MAX_POD_EVIDENCE_BYTES, validateEvidenceContent, type EvidenceCheck } from "./evidenceRules";

export const POD_EVIDENCE_SELECT =
  "id,tenant_id,job_id,stop_id,evidence_type,storage_path,original_filename,mime_type,file_size_bytes,created_by,created_at";

/** The pod_evidence row at exactly this storage path in this tenant, or null. Throws on a failed lookup. */
export async function findEvidenceByPath(admin: SupabaseClient, tenantId: string, path: string) {
  const { data, error } = await admin
    .from("pod_evidence")
    .select(POD_EVIDENCE_SELECT)
    .eq("tenant_id", tenantId)
    .eq("storage_path", path)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data;
}

export async function createEvidenceUploadUrl(
  admin: SupabaseClient,
  owner: PodEvidenceOwner,
  folder: PodEvidenceFolder,
  filename: string | null | undefined,
  options: { clientId?: string | null } = {},
): Promise<{ path: string; token: string | null }> {
  if (!options.clientId) {
    const path = buildPodEvidencePath({ ...owner, folder, filename, timestamp: Date.now(), random: randomUUID() });
    const { data, error } = await admin.storage.from(POD_BUCKET).createSignedUploadUrl(path);
    if (error || !data?.token) {
      throw new Error(`Unable to prepare upload: ${error?.message ?? "no token"}`);
    }
    return { path, token: data.token };
  }

  // A queued photo has a path derived from its client id, so a retry after a
  // lost answer targets the same object. There is deliberately NO upsert: an
  // upsert token would let a recorded, verified POD photo be swapped for
  // unchecked bytes, even after delivery. Instead a retry whose object is
  // already stored (a row exists, or storage says it exists) gets token null
  // and the caller skips the upload and goes straight to recording.
  if (folder !== "photos") throw new Error("Queued evidence is photos only.");
  const path = buildQueuedPodEvidencePath({ ...owner, folder, clientId: options.clientId, filename });
  let existing: unknown;
  try {
    existing = await findEvidenceByPath(admin, owner.tenantId, path);
  } catch (error) {
    throw new Error(`Unable to prepare upload: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (existing) return { path, token: null };

  const { data, error } = await admin.storage.from(POD_BUCKET).createSignedUploadUrl(path);
  if (error) {
    const status = (error as { statusCode?: string | number; status?: string | number }).statusCode
      ?? (error as { status?: string | number }).status;
    if (String(status) === "409" || /already exists|duplicate/i.test(error.message)) {
      return { path, token: null };
    }
    throw new Error(`Unable to prepare upload: ${error.message}`);
  }
  if (!data?.token) throw new Error("Unable to prepare upload: no token");
  return { path, token: data.token };
}

/** Best effort: a failed removal is logged, never thrown. Returns whether the object is gone. */
export async function removeEvidenceObject(admin: SupabaseClient, path: string): Promise<boolean> {
  const { data, error } = await admin.storage.from(POD_BUCKET).remove([path]);
  if (error || !data || data.length === 0) {
    console.error("[pod-evidence] storage object was not removed", path, error?.message ?? "nothing removed");
    return false;
  }
  return true;
}

/**
  Confirm the uploaded object exists at exactly `path` and matches the declared
  type and size limit. An invalid object is removed.
*/
export async function verifyUploadedEvidence(
  admin: SupabaseClient,
  path: string,
  mimeType: string,
): Promise<{ ok: true; size: number } | (Extract<EvidenceCheck, { ok: false }> | { ok: false; status: 404; message: string })> {
  const { data, error } = await admin.storage.from(POD_BUCKET).download(path);
  if (error || !data) {
    return { ok: false, status: 404, message: "The upload was not found. Try uploading the file again." };
  }

  const bytes = new Uint8Array(await data.arrayBuffer());

  if (bytes.byteLength === 0 || bytes.byteLength > MAX_POD_EVIDENCE_BYTES) {
    await removeEvidenceObject(admin, path);
    return { ok: false, status: 413, message: "The file is empty or exceeds the 15 MB POD upload limit." };
  }

  const content = validateEvidenceContent(bytes, mimeType);
  if (!content.ok) {
    await removeEvidenceObject(admin, path);
    return content;
  }

  return { ok: true, size: bytes.byteLength };
}

/** Insert the evidence row; on failure remove the object so nothing is orphaned. */
export async function recordEvidenceRow(
  admin: SupabaseClient,
  row: PodEvidenceOwner & {
    evidenceType: "photo" | "document";
    storagePath: string;
    originalFilename: string | null;
    mimeType: string;
    size: number;
    createdBy: string;
  },
) {
  const { data: existing, error: existingError } = await admin
    .from("pod_evidence")
    .select(POD_EVIDENCE_SELECT)
    .eq("tenant_id", row.tenantId)
    .eq("storage_path", row.storagePath)
    .maybeSingle();
  if (existingError) throw new Error(existingError.message);
  if (existing) return existing;

  const { data, error } = await admin
    .from("pod_evidence")
    .insert({
      tenant_id: row.tenantId,
      job_id: row.jobId,
      stop_id: row.stopId,
      evidence_type: row.evidenceType,
      storage_path: row.storagePath,
      original_filename: row.originalFilename ? row.originalFilename.slice(0, 255) : null,
      mime_type: row.mimeType,
      file_size_bytes: row.size,
      created_by: row.createdBy,
    })
    .select(POD_EVIDENCE_SELECT)
    .single();

  if (error) {
    await removeEvidenceObject(admin, row.storagePath);
    throw new Error(error.message);
  }

  return data;
}
