import { PDFDocument } from "pdf-lib";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { generateQuotationPdf, type GenerateQuotationPdfInput } from "./generatePdf";

const UNICODE = "Łódź €12.50 İstanbul";
const LONG_WORD = "https://example.com/very/long/path/with-no-spaces-anywhere/RMA-2026-000123-CAMBRIDGE-AUDIO";

function input(overrides: Partial<GenerateQuotationPdfInput> = {}): GenerateQuotationPdfInput {
  return {
    companyName: `Müller Spedition GmbH, Köln ${UNICODE}`,
    companyProfile: {
      trading_name: `${UNICODE} ${LONG_WORD}`,
      address_line_1: "Hohe Straße 1",
      city: "Köln",
      website: LONG_WORD,
      vat_number: LONG_WORD,
    },
    documentSettings: {
      logo_signed_url: "https://logo.example/logo.png",
      footer_text: `Footer ${UNICODE}`,
      generic_document_note: LONG_WORD,
    },
    customerName: `${UNICODE} Şirketi`,
    quoteNumber: "QUO-0042",
    quoteDate: "2026-09-14",
    validUntil: "2026-09-28",
    currency: "EUR",
    subtotal: 12.5,
    vatTotal: 2.5,
    total: 15,
    notes: `${UNICODE} ${LONG_WORD}`,
    customerReference: "Leeds → Gdańsk",
    poReference: null,
    lines: [
      { description: `${UNICODE} ${LONG_WORD}`, quantity: 1, unitPrice: 12.5, vatRate: 20, lineTotal: 15 },
    ],
    termsSnapshot: `1. Terms ${UNICODE}\n\n2. ${LONG_WORD}`,
    ...overrides,
  };
}

describe("generateQuotationPdf", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("", { status: 404 })));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("renders non-WinAnsi text and an unbreakable word without throwing", async () => {
    const { bytes, filename } = await generateQuotationPdf(input());
    const doc = await PDFDocument.load(bytes);
    expect(doc.getPageCount()).toBeGreaterThanOrEqual(1);
    expect(filename).toBe("Quotation-QUO-0042.pdf");
  });

  it("paginates long terms and many lines", async () => {
    const lines = Array.from({ length: 70 }, (_, index) => ({
      description: `Line ${index} ${UNICODE}`,
      quantity: 2,
      unitPrice: 5,
      vatRate: 20,
      lineTotal: 12,
    }));

    const { bytes } = await generateQuotationPdf(
      input({ lines, termsSnapshot: `Clause ${UNICODE}. `.repeat(300) })
    );
    const doc = await PDFDocument.load(bytes);
    expect(doc.getPageCount()).toBeGreaterThan(2);
  }, 20000);
});
