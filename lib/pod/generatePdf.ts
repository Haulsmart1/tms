/*
  POD PDF generation.

  Review fixes carried here:
  - POD-5: the header names the tenant's own company (lib/pod/branding.ts),
    never a hardcoded carrier.
  - POD-6: all text is drawn with embedded DejaVu Sans through pdfSafeText, so
    Polish, Czech, Romanian or Cyrillic names and addresses no longer throw,
    and an unsupported glyph (emoji) becomes "?" instead of failing the PDF.
  - POD-7: stops flow across as many pages as they need; nothing is dropped.
  - POD-8: WebP and HEIC photos are converted to JPEG with sharp. A file that
    still cannot be embedded (HEIC that the server's image library cannot
    decode, documents) is listed under "Evidence not shown in this PDF" with
    the reason, instead of silently missing.

  renderPodPdf is IO-free apart from font loading, so it is tested directly.
*/

import { PDFDocument, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import { embedUnicodeFonts, pdfSafeText } from "../printing/pdfFonts";
import { createAdminClient } from "../supabase/admin";
import type { PodBranding } from "./branding";
import { loadPodBranding } from "./brandingServer";
import { POD_BUCKET } from "./podUrl";
import { loadSharedPod, type SharedPodData, type SharedPodEvidence } from "./shareData";

const PAGE_SIZE: [number, number] = [595.28, 841.89];
const MARGIN_X = 45;
const TOP_Y = 795;
const BOTTOM_Y = 90;
const VALUE_X = 160;
const VALUE_WIDTH = PAGE_SIZE[0] - MARGIN_X - VALUE_X;
const CONTENT_WIDTH = PAGE_SIZE[0] - MARGIN_X * 2;
const LINE_HEIGHT = 14;
const MAX_ROW_LINES = 30;
const MAX_IMAGE_BYTES = 15 * 1024 * 1024;

export type PodImageLoad =
  | { kind: "jpg" | "png"; bytes: Uint8Array }
  | { kind: "unavailable"; reason: string };

export type PodImageLoader = (evidence: SharedPodEvidence) => Promise<PodImageLoad>;

export type RenderedPodPdf = {
  bytes: Uint8Array;
  pageCount: number;
  renderedStopIds: string[];
  embeddedImageIds: string[];
  notEmbedded: Array<{ id: string; filename: string; reason: string }>;
};

function formatDateTime(value: string | null): string {
  if (!value) return "-";
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? value
    : date.toLocaleString("en-GB", { timeZone: "Europe/London" });
}

function orDash(value: string | null | undefined): string {
  return value?.trim() || "-";
}

/** Word-wrap already-safe text to a width, hard-breaking words that are too long. */
export function wrapText(text: string, font: PDFFont, size: number, maxWidth: number): string[] {
  const lines: string[] = [];
  const fits = (value: string) => font.widthOfTextAtSize(value, size) <= maxWidth;

  for (const word of text.split(" ")) {
    const current = lines.length > 0 ? lines[lines.length - 1] : null;
    const candidate = current === null ? word : `${current} ${word}`;

    if (current !== null && fits(candidate)) {
      lines[lines.length - 1] = candidate;
      continue;
    }

    let rest = word;
    let first = true;
    while (rest.length > 0) {
      let cut = rest.length;
      while (cut > 1 && !fits(rest.slice(0, cut))) cut -= 1;
      const piece = rest.slice(0, cut);
      if (first && current !== null && current === "") lines[lines.length - 1] = piece;
      else lines.push(piece);
      first = false;
      rest = rest.slice(cut);
    }
    if (word.length === 0 && current === null) lines.push("");
  }

  return lines.length > 0 ? lines : [""];
}

export function isImageEvidence(evidence: Pick<SharedPodEvidence, "mimeType">): boolean {
  return Boolean(evidence.mimeType?.startsWith("image/"));
}

export async function renderPodPdf(
  pod: SharedPodData,
  branding: PodBranding,
  loadImage: PodImageLoader,
  generatedAt: Date = new Date(),
): Promise<RenderedPodPdf> {
  const pdf = await PDFDocument.create();
  const fonts = await embedUnicodeFonts(pdf);

  const embeddedImageIds: string[] = [];
  const notEmbedded: RenderedPodPdf["notEmbedded"] = [];
  const images: Array<{ evidence: SharedPodEvidence; stopOrder: number; image: Awaited<ReturnType<PDFDocument["embedJpg"]>> }> = [];

  // Load and embed images first so the summary can list what is missing.
  for (const stop of pod.stops) {
    for (const evidence of stop.evidence) {
      if (!isImageEvidence(evidence)) {
        notEmbedded.push({ id: evidence.id, filename: evidence.filename, reason: "document, open the secure POD link to view it" });
        continue;
      }
      try {
        const loaded = await loadImage(evidence);
        if (loaded.kind === "unavailable") {
          notEmbedded.push({ id: evidence.id, filename: evidence.filename, reason: loaded.reason });
          continue;
        }
        const image = loaded.kind === "png" ? await pdf.embedPng(loaded.bytes) : await pdf.embedJpg(loaded.bytes);
        images.push({ evidence, stopOrder: stop.stopOrder, image });
        embeddedImageIds.push(evidence.id);
      } catch (error) {
        console.error("[pod-pdf] unable to embed image", evidence.id, error instanceof Error ? error.message : error);
        notEmbedded.push({ id: evidence.id, filename: evidence.filename, reason: "the image file could not be read" });
      }
    }
  }

  let page: PDFPage = pdf.addPage(PAGE_SIZE);
  let y = TOP_Y;

  const newPage = () => {
    page = pdf.addPage(PAGE_SIZE);
    y = TOP_Y;
  };
  const ensure = (space: number) => {
    if (y - space < BOTTOM_Y) newPage();
  };
  const safe = (value: unknown, font: PDFFont) => pdfSafeText(value, font);

  const drawWrapped = (text: string, font: PDFFont, size: number, x: number, width: number, maxLines = MAX_ROW_LINES) => {
    let lines = wrapText(safe(text, font), font, size, width);
    if (lines.length > maxLines) {
      lines = lines.slice(0, maxLines);
      lines[maxLines - 1] = `${lines[maxLines - 1]} ...`;
    }
    for (const line of lines) {
      ensure(size + 4);
      page.drawText(line, { x, y, size, font });
      y -= size + 4;
    }
  };

  const drawRow = (label: string, value: string) => {
    ensure(LINE_HEIGHT * 2);
    page.drawText(safe(`${label}:`, fonts.bold), { x: MARGIN_X, y, size: 10, font: fonts.bold });
    drawWrapped(value, fonts.regular, 10, VALUE_X, VALUE_WIDTH);
    y -= 4;
  };

  drawWrapped(branding.carrierName, fonts.bold, 20, MARGIN_X, CONTENT_WIDTH, 2);
  y -= 6;
  page.drawText("PROOF OF DELIVERY", { x: MARGIN_X, y, size: 16, font: fonts.bold });
  y -= 32;

  drawRow("Job reference", pod.reference);
  drawRow("Customer", pod.customerName);
  drawRow("Customer reference", orDash(pod.customerReference));
  drawRow("Status", orDash(pod.status));
  drawRow("Scheduled", orDash(pod.scheduledDate));
  y -= 10;

  const renderedStopIds: string[] = [];

  for (const stop of pod.stops) {
    // Keep a stop heading together with its first rows.
    ensure(20 + LINE_HEIGHT * 4);
    const heading = `Stop ${stop.stopOrder} - ${stop.type === "collection" ? "Collection" : stop.type === "delivery" ? "Delivery" : stop.type}`;
    page.drawText(safe(heading, fonts.bold), { x: MARGIN_X, y, size: 12, font: fonts.bold });
    y -= 20;

    drawRow("Address", [stop.address, stop.city, stop.postcode].filter(Boolean).join(", ") || "-");
    drawRow("Recipient", orDash(stop.recipientName));
    drawRow(stop.type === "collection" ? "Collected" : "Delivered", formatDateTime(stop.deliveredAt));
    drawRow("POD status", orDash(stop.podStatus));
    drawRow("Notes", orDash(stop.podNotes));
    drawRow("Evidence", `${stop.evidence.length} file(s)`);
    y -= 10;
    renderedStopIds.push(stop.id);
  }

  if (notEmbedded.length > 0) {
    ensure(20 + LINE_HEIGHT * 3);
    page.drawText("Evidence not shown in this PDF", { x: MARGIN_X, y, size: 12, font: fonts.bold });
    y -= 18;
    for (const item of notEmbedded) {
      drawWrapped(`${item.filename}: ${item.reason}.`, fonts.regular, 10, MARGIN_X, CONTENT_WIDTH, 4);
    }
    drawWrapped("Every file is available through the secure POD link.", fonts.regular, 10, MARGIN_X, CONTENT_WIDTH, 2);
  }

  for (const { evidence, stopOrder, image } of images) {
    const imagePage = pdf.addPage(PAGE_SIZE);
    imagePage.drawText(safe(`POD photo - ${pod.reference}`, fonts.bold).slice(0, 90), { x: MARGIN_X, y: 795, size: 14, font: fonts.bold });
    const caption = wrapText(safe(`Stop ${stopOrder}: ${evidence.filename}`, fonts.regular), fonts.regular, 9, CONTENT_WIDTH)[0] ?? "";
    imagePage.drawText(caption, { x: MARGIN_X, y: 772, size: 9, font: fonts.regular });

    const availableWidth = CONTENT_WIDTH;
    const availableHeight = 660;
    const scale = Math.min(availableWidth / image.width, availableHeight / image.height, 1);
    const width = image.width * scale;
    const height = image.height * scale;

    imagePage.drawImage(image, {
      x: (PAGE_SIZE[0] - width) / 2,
      y: BOTTOM_Y + (availableHeight - height) / 2,
      width,
      height,
    });
  }

  const pages = pdf.getPages();
  const generated = `Generated ${generatedAt.toLocaleString("en-GB", { timeZone: "Europe/London" })}`;
  const footer = branding.footerText ? safe(branding.footerText, fonts.regular) : "";

  pages.forEach((current, index) => {
    current.drawLine({
      start: { x: MARGIN_X, y: 70 },
      end: { x: PAGE_SIZE[0] - MARGIN_X, y: 70 },
      thickness: 0.5,
      color: rgb(0.65, 0.65, 0.65),
    });
    current.drawText(`${generated}  ·  Page ${index + 1} of ${pages.length}`, { x: MARGIN_X, y: 56, size: 8, font: fonts.regular });
    if (footer) {
      const line = wrapText(footer, fonts.regular, 8, CONTENT_WIDTH)[0] ?? "";
      current.drawText(line, { x: MARGIN_X, y: 44, size: 8, font: fonts.regular });
    }
  });

  const bytes = await pdf.save();

  return {
    bytes,
    pageCount: pages.length,
    renderedStopIds,
    embeddedImageIds,
    notEmbedded,
  };
}

const CONVERTIBLE_MIME_TYPES = new Set(["image/webp", "image/heic", "image/heif"]);

/** Turn stored image bytes into something pdf-lib can embed. */
export async function prepareEvidenceImage(bytes: Uint8Array, mimeType: string | null): Promise<PodImageLoad> {
  if (mimeType === "image/jpeg") return { kind: "jpg", bytes };
  if (mimeType === "image/png") return { kind: "png", bytes };
  if (!mimeType || !CONVERTIBLE_MIME_TYPES.has(mimeType)) {
    return { kind: "unavailable", reason: "this image format cannot be embedded" };
  }

  try {
    const sharp = (await import("sharp")).default;
    const converted = await sharp(bytes)
      .rotate()
      .resize({ width: 2000, height: 2000, fit: "inside", withoutEnlargement: true })
      .jpeg({ quality: 80 })
      .toBuffer();
    return { kind: "jpg", bytes: new Uint8Array(converted) };
  } catch {
    return {
      kind: "unavailable",
      reason: mimeType === "image/webp" ? "the WebP photo could not be converted" : "the HEIC photo could not be converted on the server",
    };
  }
}

export async function generatePodPdf(
  tenantId: string,
  jobId: string,
): Promise<{ bytes: Uint8Array; filename: string; pod: SharedPodData; branding: PodBranding }> {
  const pod = await loadSharedPod(tenantId, jobId);

  if (!pod) {
    throw new Error("POD job not found.");
  }

  const admin = createAdminClient();
  const branding = await loadPodBranding(admin, tenantId);

  const loadImage: PodImageLoader = async (evidence) => {
    if (evidence.fileSize !== null && evidence.fileSize > MAX_IMAGE_BYTES) {
      return { kind: "unavailable", reason: "the photo is too large to embed" };
    }
    const { data, error } = await admin.storage.from(POD_BUCKET).download(evidence.storagePath);
    if (error || !data) {
      return { kind: "unavailable", reason: "the photo could not be downloaded" };
    }
    return prepareEvidenceImage(new Uint8Array(await data.arrayBuffer()), evidence.mimeType);
  };

  const rendered = await renderPodPdf(pod, branding, loadImage);
  const safeReference = pod.reference.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 80) || "POD";

  return {
    bytes: rendered.bytes,
    filename: `POD-${safeReference}.pdf`,
    pod,
    branding,
  };
}
