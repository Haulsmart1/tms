import { describe, expect, it, vi } from "vitest";
import { PDFDocument, StandardFonts } from "pdf-lib";

// generatePdf imports the admin client module; the renderer under test never uses it.
vi.mock("../supabase/admin", () => ({ createAdminClient: () => { throw new Error("not used in tests"); } }));

import { prepareEvidenceImage, renderPodPdf, wrapText, type PodImageLoader } from "./generatePdf";
import type { SharedPodData } from "./shareData";

const PNG_1PX = Uint8Array.from(
  Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64"),
);

function podWithStops(count: number): SharedPodData {
  return {
    jobId: "job-1",
    reference: "ZLEC-Łódź-001",
    customerReference: "PO 42",
    status: "completed",
    scheduledDate: "2026-09-14",
    customerName: "Przedsiębiorstwo Transportowe Wiśniewski sp. z o.o.",
    stops: Array.from({ length: count }, (_, index) => ({
      id: `stop-${index + 1}`,
      stopOrder: index + 1,
      type: index === 0 ? "collection" : "delivery",
      address: `ul. Źródlana ${index + 1}, Gdańsk-Wrzeszcz, Łęczyca i Żółkiewka`,
      city: "Kraków",
      postcode: "30-001",
      status: "completed",
      podStatus: "delivered",
      recipientName: "Łukasz Wiśniewski",
      deliveredAt: "2026-09-14T10:15:00Z",
      podNotes: "Dostarczono pod bramę. Příjemce: Řehoř Čermák. Șofer: Ștefan. Emoji 🚚 is not in the font. ".repeat(3),
      evidence:
        index === 1
          ? [
              { id: "e-png", evidenceType: "photo", filename: "zdjęcie.png", mimeType: "image/png", fileSize: 100, storagePath: "x", signedUrl: null },
              { id: "e-heic", evidenceType: "photo", filename: "IMG_0001.HEIC", mimeType: "image/heic", fileSize: 100, storagePath: "y", signedUrl: null },
              { id: "e-doc", evidenceType: "document", filename: "list przewozowy.pdf", mimeType: "application/pdf", fileSize: 100, storagePath: "z", signedUrl: null },
            ]
          : [],
    })),
  };
}

describe("renderPodPdf", () => {
  const loader: PodImageLoader = async (evidence) =>
    evidence.mimeType === "image/png"
      ? { kind: "png", bytes: PNG_1PX }
      : { kind: "unavailable", reason: "the HEIC photo could not be converted on the server" };

  it("renders all 12 stops with Polish, Czech and Romanian text across pages", async () => {
    const result = await renderPodPdf(podWithStops(12), { carrierName: "Transport Łódź sp. z o.o.", footerText: "Dziękujemy" }, loader, new Date("2026-09-14T12:00:00Z"));

    expect(result.renderedStopIds).toEqual(Array.from({ length: 12 }, (_, i) => `stop-${i + 1}`));
    expect(result.embeddedImageIds).toEqual(["e-png"]);
    expect(result.notEmbedded.map((item) => item.id)).toEqual(["e-heic", "e-doc"]);
    expect(result.pageCount).toBeGreaterThanOrEqual(3);

    const reloaded = await PDFDocument.load(result.bytes);
    expect(reloaded.getPageCount()).toBe(result.pageCount);
  });

  it("does not throw when the image loader fails", async () => {
    const failing: PodImageLoader = async () => {
      throw new Error("network down");
    };
    const result = await renderPodPdf(podWithStops(2), { carrierName: "Carrier", footerText: null }, failing);
    expect(result.embeddedImageIds).toEqual([]);
    expect(result.notEmbedded.find((item) => item.id === "e-png")?.reason).toBe("the image file could not be read");
  });
});

describe("prepareEvidenceImage", () => {
  it("passes JPEG and PNG through", async () => {
    expect((await prepareEvidenceImage(PNG_1PX, "image/png")).kind).toBe("png");
    expect((await prepareEvidenceImage(PNG_1PX, "image/jpeg")).kind).toBe("jpg");
  });

  it("converts WebP to JPEG", async () => {
    const sharp = (await import("sharp")).default;
    const webp = await sharp({ create: { width: 8, height: 6, channels: 3, background: "#336699" } }).webp().toBuffer();
    const prepared = await prepareEvidenceImage(new Uint8Array(webp), "image/webp");
    expect(prepared.kind).toBe("jpg");
    if (prepared.kind === "jpg") {
      expect([prepared.bytes[0], prepared.bytes[1]]).toEqual([0xff, 0xd8]);
    }
  });

  it("reports an undecodable HEIC instead of throwing", async () => {
    const prepared = await prepareEvidenceImage(Uint8Array.from([0, 1, 2, 3]), "image/heic");
    expect(prepared).toEqual({ kind: "unavailable", reason: "the HEIC photo could not be converted on the server" });
  });

  it("refuses formats it cannot embed", async () => {
    expect((await prepareEvidenceImage(PNG_1PX, "image/gif")).kind).toBe("unavailable");
  });
});

describe("wrapText", () => {
  it("wraps words and hard-breaks very long ones", async () => {
    const pdf = await PDFDocument.create();
    const font = await pdf.embedFont(StandardFonts.Helvetica);
    const lines = wrapText("short words here " + "x".repeat(200), font, 10, 100);
    expect(lines.length).toBeGreaterThan(2);
    for (const line of lines) expect(font.widthOfTextAtSize(line, 10)).toBeLessThanOrEqual(100);
    expect(lines.join("").replace(/ /g, "")).toBe("shortwordshere" + "x".repeat(200));
  });
});
