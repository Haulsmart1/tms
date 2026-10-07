/*
  The one rule for where a POD evidence object may live in the pod-files bucket:

    <tenantId>/<jobId>/<stopId>/<photos|documents>/<file>

  Why this exists (review POD-10): the service role bypasses the bucket's
  per-tenant path policy. Anything that signs, downloads or deletes a path read
  from pod_evidence with the service role must first prove the path sits inside
  that row's own tenant, job and stop, or a tenant could plant another tenant's
  object path in its own evidence row and have the platform serve it.

  Pure, so both server routes and tests share it.
*/

import { isUuid } from "../uuid";

export const POD_EVIDENCE_FOLDERS = ["photos", "documents"] as const;
export type PodEvidenceFolder = (typeof POD_EVIDENCE_FOLDERS)[number];

const MAX_PATH_LENGTH = 1024;
const MAX_FILENAME_LENGTH = 160;

export type PodEvidenceOwner = {
  tenantId: string;
  jobId: string;
  stopId: string;
};

function isUuidLike(value: unknown): value is string {
  return typeof value === "string" && isUuid(value);
}

/** Storage-safe filename: ASCII letters, digits, dot, dash, underscore. */
export function sanitizePodFilename(name: string | null | undefined, fallback = "pod-file"): string {
  const cleaned = String(name ?? "")
    .replace(/[^a-zA-Z0-9.\-_]/g, "_")
    .replace(/^\.+/, "_")
    .slice(0, MAX_FILENAME_LENGTH);
  return cleaned || fallback;
}

export function buildPodEvidencePath(input: PodEvidenceOwner & {
  folder: PodEvidenceFolder;
  filename: string | null | undefined;
  timestamp: number;
  random: string;
}): string {
  const { tenantId, jobId, stopId, folder } = input;
  if (!isUuidLike(tenantId) || !isUuidLike(jobId) || !isUuidLike(stopId)) {
    throw new Error("POD evidence owner ids must be UUIDs.");
  }
  if (!POD_EVIDENCE_FOLDERS.includes(folder)) {
    throw new Error("Unknown POD evidence folder.");
  }
  const random = input.random.replace(/[^a-zA-Z0-9-]/g, "").slice(0, 64);
  if (!random) throw new Error("A random path component is required.");
  return `${tenantId}/${jobId}/${stopId}/${folder}/${Math.trunc(input.timestamp)}-${random}-${sanitizePodFilename(input.filename)}`;
}

/**
  The path for a photo sent from the driver's offline queue. Derived from the
  item's client id instead of a timestamp and random part, so a retry after a
  lost answer targets the same object and records the same path, which
  recordEvidenceRow already treats as one row. When the object already exists
  the retry skips the upload rather than overwriting it (no upsert).
*/
export function buildQueuedPodEvidencePath(input: PodEvidenceOwner & {
  folder: "photos";
  clientId: string;
  filename: string | null | undefined;
}): string {
  const { tenantId, jobId, stopId, folder, clientId } = input;
  if (!isUuidLike(tenantId) || !isUuidLike(jobId) || !isUuidLike(stopId) || !isUuidLike(clientId)) {
    throw new Error("POD evidence owner ids and the client id must be UUIDs.");
  }
  if (folder !== "photos") {
    throw new Error("Queued evidence is photos only.");
  }
  return `${tenantId}/${jobId}/${stopId}/${folder}/q-${clientId.toLowerCase()}-${sanitizePodFilename(input.filename)}`;
}

/**
  True only when `path` is a well-formed evidence path owned by exactly this
  tenant, job and stop. Rejects traversal, empty segments, backslashes, and
  anything outside the two known folders.
*/
export function isPodEvidencePathFor(path: unknown, owner: PodEvidenceOwner): boolean {
  if (typeof path !== "string" || path.length === 0 || path.length > MAX_PATH_LENGTH) return false;
  if (!isUuidLike(owner.tenantId) || !isUuidLike(owner.jobId) || !isUuidLike(owner.stopId)) return false;
  if (path.includes("\\") || path.includes("\0")) return false;

  const segments = path.split("/");
  if (segments.length !== 5) return false;
  if (segments.some((segment) => segment === "" || segment === "." || segment === "..")) return false;

  const [tenant, job, stop, folder] = segments;
  return (
    tenant.toLowerCase() === owner.tenantId.toLowerCase() &&
    job.toLowerCase() === owner.jobId.toLowerCase() &&
    stop.toLowerCase() === owner.stopId.toLowerCase() &&
    (POD_EVIDENCE_FOLDERS as readonly string[]).includes(folder)
  );
}
