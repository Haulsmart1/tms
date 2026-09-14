/*
  Layout helpers shared by the invoice and quotation PDFs (INV-1, INV-5, INV-20).

  Every string these return has already been passed through pdfSafeText for
  the SAME font it will be measured and drawn with, so a caller can hand the
  result straight to page.drawText without it throwing on an unencodable
  glyph, and widths are measured on exactly the glyphs that get drawn.
*/

import type { PDFDocument, PDFFont, PDFImage } from "pdf-lib";
import { pdfSafeText } from "./pdfFonts";

const ELLIPSIS = "...";

/**
  Hard-breaks one token that is wider than maxWidth into character runs.

  Runs in roughly linear time: it keeps a running sum of per-character widths
  and only measures the real fragment (which includes kerning) when that sum
  says the next character might not fit. Re-measuring the whole fragment on
  every character was quadratic and stalled on long pasted text.
*/
function breakLongWord(word: string, font: PDFFont, size: number, maxWidth: number): string[] {
  const parts: string[] = [];
  const charWidths = new Map<string, number>();
  let fragment = "";
  let fragmentWidth = 0;

  for (const char of word) {
    let charWidth = charWidths.get(char);
    if (charWidth === undefined) {
      charWidth = font.widthOfTextAtSize(char, size);
      charWidths.set(char, charWidth);
    }

    if (fragment && fragmentWidth + charWidth > maxWidth) {
      const realWidth = font.widthOfTextAtSize(fragment + char, size);

      if (realWidth > maxWidth) {
        parts.push(fragment);
        fragment = char;
        fragmentWidth = charWidth;
        continue;
      }

      fragment += char;
      fragmentWidth = realWidth;
      continue;
    }

    fragment += char;
    fragmentWidth += charWidth;
  }

  if (fragment) parts.push(fragment);
  return parts;
}

/**
  Word-wraps text to maxWidth. Explicit newlines start new lines (a blank line
  is kept as ""), and a single word wider than maxWidth is broken by character
  so an IBAN, URL or long reference can never run into the next column.
*/
export function wrapPdfText(value: unknown, font: PDFFont, size: number, maxWidth: number): string[] {
  const raw = value === null || value === undefined ? "" : String(value);
  const output: string[] = [];

  for (const rawParagraph of raw.replace(/\r\n?/g, "\n").split("\n")) {
    const paragraph = pdfSafeText(rawParagraph, font).trim();

    if (!paragraph) {
      output.push("");
      continue;
    }

    let line = "";

    for (const word of paragraph.split(/\s+/)) {
      const candidate = line ? `${line} ${word}` : word;

      if (font.widthOfTextAtSize(candidate, size) <= maxWidth) {
        line = candidate;
        continue;
      }

      if (line) output.push(line);

      if (font.widthOfTextAtSize(word, size) > maxWidth) {
        const pieces = breakLongWord(word, font, size, maxWidth);
        line = pieces.pop() ?? "";
        output.push(...pieces);
      } else {
        line = word;
      }
    }

    if (line) output.push(line);
  }

  return output;
}

/** One line that fits maxWidth, truncated with "..." when it does not. */
export function fitPdfText(value: unknown, font: PDFFont, size: number, maxWidth: number): string {
  const text = pdfSafeText(value, font).trim();

  if (font.widthOfTextAtSize(text, size) <= maxWidth) return text;

  const chars = Array.from(text);
  let low = 0;
  let high = chars.length;

  while (low < high) {
    const mid = Math.ceil((low + high) / 2);
    const candidate = chars.slice(0, mid).join("").trimEnd() + ELLIPSIS;

    if (font.widthOfTextAtSize(candidate, size) <= maxWidth) {
      low = mid;
    } else {
      high = mid - 1;
    }
  }

  return low === 0 ? "" : chars.slice(0, low).join("").trimEnd() + ELLIPSIS;
}

export const LOGO_FETCH_TIMEOUT_MS = 5000;
const MAX_LOGO_BYTES = 5 * 1024 * 1024;

/**
  Fetches and embeds a document logo. Any failure (timeout, HTTP error,
  oversized or undecodable image) returns null so the document is still
  produced without a logo rather than stalling or failing the email.
*/
export async function loadPdfLogo(
  pdf: PDFDocument,
  url: string | null | undefined,
  options?: { timeoutMs?: number; fetchImpl?: typeof fetch }
): Promise<PDFImage | null> {
  if (!url) return null;

  const fetchImpl = options?.fetchImpl ?? fetch;

  try {
    const response = await fetchImpl(url, {
      cache: "no-store",
      signal: AbortSignal.timeout(options?.timeoutMs ?? LOGO_FETCH_TIMEOUT_MS),
    });

    if (!response.ok) return null;

    const declared = Number(response.headers.get("content-length") ?? 0);
    if (Number.isFinite(declared) && declared > MAX_LOGO_BYTES) return null;

    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.byteLength === 0 || bytes.byteLength > MAX_LOGO_BYTES) return null;

    const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";

    if (contentType.includes("png")) return await pdf.embedPng(bytes);
    if (contentType.includes("jpeg") || contentType.includes("jpg")) return await pdf.embedJpg(bytes);

    try {
      return await pdf.embedPng(bytes);
    } catch {
      return await pdf.embedJpg(bytes);
    }
  } catch (error) {
    console.warn("[pdf] logo could not be loaded; rendering without it", error instanceof Error ? error.name : error);
    return null;
  }
}
