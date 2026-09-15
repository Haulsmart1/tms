/*
  Unicode fonts for every generated PDF (invoice, quotation, POD).

  Why: pdf-lib's StandardFonts (Helvetica) only encode WinAnsi. Any other
  character (Polish "Ł", Turkish "ş", Hungarian "ő", arrows, emoji) makes
  drawText THROW, which aborted invoice and POD emails with a 500, and the
  quotation generator worked around it by silently deleting the euro sign and
  accented letters. Review findings INV-1, INV-5, POD-6.

  Fonts: DejaVu Sans regular and bold, vendored in lib/printing/fonts (licence
  alongside). They cover Latin, Greek, Cyrillic, the euro sign and arrows.
  Embedded with subsetting, so a PDF only carries the glyphs it uses.

  Server-only (reads from disk).
*/

import { readFile } from "node:fs/promises";
import { join } from "node:path";
import fontkit from "@pdf-lib/fontkit";
import type { PDFDocument, PDFFont } from "pdf-lib";

const FONT_DIR = join(process.cwd(), "lib", "printing", "fonts");

let cached: Promise<{ regular: Uint8Array; bold: Uint8Array }> | null = null;

function loadFontBytes() {
  if (!cached) {
    cached = Promise.all([
      readFile(join(FONT_DIR, "DejaVuSans.ttf")),
      readFile(join(FONT_DIR, "DejaVuSans-Bold.ttf")),
    ]).then(([regular, bold]) => ({ regular: new Uint8Array(regular), bold: new Uint8Array(bold) }));
    cached.catch(() => {
      cached = null;
    });
  }
  return cached;
}

export type PdfFonts = { regular: PDFFont; bold: PDFFont };

export async function embedUnicodeFonts(pdf: PDFDocument): Promise<PdfFonts> {
  pdf.registerFontkit(fontkit);
  const bytes = await loadFontBytes();
  const [regular, bold] = await Promise.all([
    pdf.embedFont(bytes.regular, { subset: true }),
    pdf.embedFont(bytes.bold, { subset: true }),
  ]);
  return { regular, bold };
}

/** Tab, LF, CR, and the Unicode line and paragraph separators. */
function isLineBreakLike(cp: number): boolean {
  return cp === 0x09 || cp === 0x0a || cp === 0x0d || cp === 0x2028 || cp === 0x2029;
}

/** C0/C1 controls, zero-width characters, bidi controls, word joiners, BOM. */
function isInvisible(cp: number): boolean {
  return (
    cp <= 0x1f ||
    (cp >= 0x7f && cp <= 0x9f) ||
    (cp >= 0x200b && cp <= 0x200f) ||
    (cp >= 0x202a && cp <= 0x202e) ||
    (cp >= 0x2060 && cp <= 0x2064) ||
    cp === 0xfeff
  );
}

/**
  Make arbitrary user text safe to draw with `font`:
  - runs of tabs and line breaks become one space (callers wrap lines themselves),
  - other control and invisible characters are removed,
  - any character the font has no glyph for becomes "?" instead of throwing
    or disappearing silently.
*/
export function pdfSafeText(value: unknown, font: PDFFont): string {
  if (value === null || value === undefined) return "";
  const supported = new Set(font.getCharacterSet());
  let out = "";
  let pendingSpace = false;
  for (const ch of String(value).normalize("NFC")) {
    const cp = ch.codePointAt(0)!;
    if (isLineBreakLike(cp)) {
      pendingSpace = true;
      continue;
    }
    if (isInvisible(cp)) continue;
    if (pendingSpace) {
      out += " ";
      pendingSpace = false;
    }
    out += supported.has(cp) ? ch : "?";
  }
  if (pendingSpace) out += " ";
  return out;
}
