import { PDFDocument } from "pdf-lib";
import { describe, expect, it } from "vitest";
import { embedUnicodeFonts, pdfSafeText } from "./pdfFonts";

const TAB = String.fromCodePoint(0x09);
const LF = String.fromCodePoint(0x0a);
const ZWSP = String.fromCodePoint(0x200b);
const TRUCK_EMOJI = String.fromCodePoint(0x1f69a);

describe("embedUnicodeFonts", () => {
  it("draws text that Helvetica cannot encode without throwing", async () => {
    const pdf = await PDFDocument.create();
    const { regular, bold } = await embedUnicodeFonts(pdf);
    const page = pdf.addPage();
    const text = pdfSafeText(`Łódź Sp. z o.o. €1,234.50 İstanbul şirketi Győr → Kraków${TAB}end`, regular);
    page.drawText(text, { x: 20, y: 700, size: 10, font: regular });
    page.drawText(pdfSafeText("Faktura Ł", bold), { x: 20, y: 680, size: 12, font: bold });
    const bytes = await pdf.save();
    expect(bytes.byteLength).toBeGreaterThan(1000);
  });

  it("keeps accented letters and the euro sign instead of deleting them", async () => {
    const pdf = await PDFDocument.create();
    const { regular } = await embedUnicodeFonts(pdf);
    const input = "Café €5 Łukasz";
    expect(pdfSafeText(input, regular)).toBe(input);
  });

  it("turns tabs and newlines into one space and strips invisible characters", async () => {
    const pdf = await PDFDocument.create();
    const { regular } = await embedUnicodeFonts(pdf);
    expect(pdfSafeText(`a${TAB}b${LF}${LF}cd${ZWSP}e`, regular)).toBe("a b cde");
  });

  it("replaces glyphs the font lacks with ? rather than throwing", async () => {
    const pdf = await PDFDocument.create();
    const { regular } = await embedUnicodeFonts(pdf);
    expect(pdfSafeText(`van ${TRUCK_EMOJI}`, regular)).toBe("van ?");
  });

  it("returns empty string for null and undefined", async () => {
    const pdf = await PDFDocument.create();
    const { regular } = await embedUnicodeFonts(pdf);
    expect(pdfSafeText(null, regular)).toBe("");
    expect(pdfSafeText(undefined, regular)).toBe("");
  });
});
