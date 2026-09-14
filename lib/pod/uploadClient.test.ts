import { describe, expect, it, vi } from "vitest";
import { readJsonSafe, uploadEvidenceViaSignedUrl } from "./uploadClient";
import { validateEvidenceContent, validateEvidenceMetadata } from "./evidenceRules";

function jsonResponse(status: number, body: unknown) {
  return { ok: status >= 200 && status < 300, status, json: async () => body } as unknown as Response;
}

describe("uploadEvidenceViaSignedUrl", () => {
  it("requests a URL, uploads to storage, then records the server-chosen path", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(200, { path: "t/j/s/photos/1-x-a.jpg", token: "tok" }))
      .mockResolvedValueOnce(jsonResponse(201, { ok: true }));
    const storage = { uploadToSignedUrl: vi.fn().mockResolvedValue({ error: null }) };
    const file = new Blob([new Uint8Array(10)], { type: "image/jpeg" });

    await uploadEvidenceViaSignedUrl({
      fetchImpl: fetchImpl as unknown as typeof fetch,
      storage,
      uploadUrlEndpoint: "/u",
      recordEndpoint: "/r",
      file,
      filename: "a.jpg",
      mimeType: "image/jpeg",
      extraBody: { tenantId: "t" },
    });

    expect(JSON.parse(fetchImpl.mock.calls[0][1].body)).toEqual({ tenantId: "t", filename: "a.jpg", mimeType: "image/jpeg", size: 10 });
    expect(storage.uploadToSignedUrl).toHaveBeenCalledWith("t/j/s/photos/1-x-a.jpg", "tok", file, { contentType: "image/jpeg", upsert: false });
    expect(JSON.parse(fetchImpl.mock.calls[1][1].body)).toEqual({ tenantId: "t", storagePath: "t/j/s/photos/1-x-a.jpg", originalFilename: "a.jpg", mimeType: "image/jpeg" });
  });

  it("surfaces the server's refusal and never uploads", async () => {
    const fetchImpl = vi.fn().mockResolvedValueOnce(jsonResponse(409, { error: "This delivery is already complete." }));
    const storage = { uploadToSignedUrl: vi.fn() };
    await expect(
      uploadEvidenceViaSignedUrl({ fetchImpl: fetchImpl as unknown as typeof fetch, storage, uploadUrlEndpoint: "/u", recordEndpoint: "/r", file: new Blob(["x"]), filename: "a", mimeType: "image/jpeg" }),
    ).rejects.toThrow("This delivery is already complete.");
    expect(storage.uploadToSignedUrl).not.toHaveBeenCalled();
  });

  it("stops when the storage upload fails", async () => {
    const fetchImpl = vi.fn().mockResolvedValueOnce(jsonResponse(200, { path: "p", token: "t" }));
    const storage = { uploadToSignedUrl: vi.fn().mockResolvedValue({ error: { message: "boom" } }) };
    await expect(
      uploadEvidenceViaSignedUrl({ fetchImpl: fetchImpl as unknown as typeof fetch, storage, uploadUrlEndpoint: "/u", recordEndpoint: "/r", file: new Blob(["x"]), filename: "a", mimeType: "image/jpeg" }),
    ).rejects.toThrow(/did not complete/);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});

describe("readJsonSafe", () => {
  it("tolerates a non-JSON error body", async () => {
    expect(await readJsonSafe({ status: 413, json: async () => { throw new SyntaxError("x"); } })).toEqual({});
  });
});

describe("evidence rules", () => {
  it("checks type, size and declared mime", () => {
    expect(validateEvidenceMetadata({ evidenceType: "photo", mimeType: "image/jpeg", size: 10 })).toEqual({ ok: true });
    expect(validateEvidenceMetadata({ evidenceType: "photo", mimeType: "application/pdf", size: 10 })).toMatchObject({ ok: false, status: 415 });
    expect(validateEvidenceMetadata({ evidenceType: "document", mimeType: "application/pdf", size: 10 })).toEqual({ ok: true });
    expect(validateEvidenceMetadata({ evidenceType: "document", mimeType: "application/pdf", size: 16 * 1024 * 1024 })).toMatchObject({ ok: false, status: 413 });
    expect(validateEvidenceMetadata({ evidenceType: "video", mimeType: "image/jpeg", size: 1 })).toMatchObject({ ok: false, status: 400 });
    expect(validateEvidenceMetadata({ evidenceType: "photo", mimeType: "image/jpeg", size: 0 })).toMatchObject({ ok: false, status: 400 });
  });

  it("checks leading bytes against the declared type", () => {
    expect(validateEvidenceContent(Uint8Array.from([0x25, 0x50, 0x44, 0x46, 0x2d]), "application/pdf")).toEqual({ ok: true });
    expect(validateEvidenceContent(Uint8Array.from([0xff, 0xd8, 0xff, 0xe0]), "image/jpeg")).toEqual({ ok: true });
    expect(validateEvidenceContent(Uint8Array.from([0x3c, 0x68, 0x74]), "application/pdf")).toMatchObject({ ok: false });
    expect(validateEvidenceContent(Uint8Array.from([0x50, 0x4b, 0x03, 0x04]), "application/msword")).toMatchObject({ ok: false });
  });
});
