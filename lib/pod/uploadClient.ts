/*
  Browser-side two-step evidence upload (review POD-2, POD-10, POD-17).

  1. POST the file's name, type and size to an upload-url endpoint. The server
     authorizes the caller, picks the storage path itself and returns a signed
     upload token.
  2. Upload the bytes straight to storage with that token (never through a
     route handler, so the 4.5 MB function body limit does not apply).
  3. POST the path to the record endpoint, which checks the stored object and
     writes the pod_evidence row. If recording fails, the server removes the
     object.

  Imports nothing server-only; the storage client is passed in.
*/

export type SignedUploadStorage = {
  uploadToSignedUrl(
    path: string,
    token: string,
    file: Blob,
    options?: { contentType?: string; upsert?: boolean },
  ): Promise<{ error: { message: string } | null }>;
};

/** Parse a response body without assuming JSON (a 413 from the platform is HTML or text). */
export async function readJsonSafe(response: { json(): Promise<unknown>; status: number }): Promise<Record<string, unknown>> {
  try {
    const parsed = await response.json();
    return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

export function errorFromBody(body: Record<string, unknown>, status: number, fallback: string): string {
  if (typeof body.error === "string" && body.error.trim()) return body.error;
  if (status === 413) return "The file is too large to upload.";
  return fallback;
}

export async function uploadEvidenceViaSignedUrl(input: {
  fetchImpl: typeof fetch;
  storage: SignedUploadStorage;
  uploadUrlEndpoint: string;
  recordEndpoint: string;
  file: Blob;
  filename: string;
  mimeType: string;
  extraBody?: Record<string, unknown>;
  headers?: Record<string, string>;
}): Promise<Record<string, unknown>> {
  const headers = { "Content-Type": "application/json", ...(input.headers ?? {}) };

  const urlResponse = await input.fetchImpl(input.uploadUrlEndpoint, {
    method: "POST",
    headers,
    body: JSON.stringify({
      ...(input.extraBody ?? {}),
      filename: input.filename,
      mimeType: input.mimeType,
      size: input.file.size,
    }),
  });
  const urlBody = await readJsonSafe(urlResponse);
  if (!urlResponse.ok || typeof urlBody.path !== "string" || typeof urlBody.token !== "string") {
    throw new Error(errorFromBody(urlBody, urlResponse.status, "Unable to start the upload."));
  }

  const { error: uploadError } = await input.storage.uploadToSignedUrl(urlBody.path, urlBody.token, input.file, {
    contentType: input.mimeType,
    upsert: false,
  });
  if (uploadError) {
    throw new Error("The file upload did not complete. Check the connection and try again.");
  }

  const recordResponse = await input.fetchImpl(input.recordEndpoint, {
    method: "POST",
    headers,
    body: JSON.stringify({
      ...(input.extraBody ?? {}),
      storagePath: urlBody.path,
      originalFilename: input.filename,
      mimeType: input.mimeType,
    }),
  });
  const recordBody = await readJsonSafe(recordResponse);
  if (!recordResponse.ok) {
    throw new Error(errorFromBody(recordBody, recordResponse.status, "Unable to save the uploaded file."));
  }
  return recordBody;
}
