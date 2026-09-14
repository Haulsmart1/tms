import { PDFDocument } from "pdf-lib";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { formatPdfMoney, generateInvoicePdf, type GenerateInvoicePdfInput } from "./generatePdf";

const UNICODE = "Łódź €12.50 İstanbul";
const LONG_WORD = "GB29NWBK60161331926819-RMA-2026-000123-CAMBRIDGE-AUDIO-RETURNS-WITH-NO-SPACES-AT-ALL";
const TAB = String.fromCodePoint(0x09);

function input(overrides: Partial<GenerateInvoicePdfInput> = {}): GenerateInvoicePdfInput {
  return {
    companyName: `${UNICODE} Haulage Sp. z o.o.`,
    companyProfile: {
      company_name: `${UNICODE} Logistics ${LONG_WORD}`,
      address_line_1: `ul. Piotrkowska 1${TAB}Łódź`,
      city: "Győr",
      business_email: `accounts@${LONG_WORD}.example`,
      registration_number: LONG_WORD,
      vat_number: "PL1234567890",
    },
    documentSettings: {
      show_logo: true,
      logo_signed_url: "https://logo.example/logo.png",
      bank_details: `IBAN ${LONG_WORD}\nSWIFT NWBKGB2L`,
    },
    customerName: `${UNICODE} Şirketi`,
    invoiceNumber: "INV-2026-0001",
    status: "approved",
    issueDate: "2026-09-14",
    dueDate: "2026-10-14",
    currency: "EUR",
    poReference: LONG_WORD,
    customerReference: "Leeds → Gdańsk",
    notes: `Notes ${UNICODE} ${LONG_WORD}`,
    subtotal: 12.5,
    vatTotal: 2.5,
    total: 15,
    amountPaid: 0,
    creditTotal: 0,
    balanceDue: 15,
    lines: [
      {
        description: `${UNICODE} ${LONG_WORD}`,
        quantity: 1,
        unitPrice: 12.5,
        vatRate: 20,
        netAmount: 12.5,
        vatAmount: 2.5,
        grossAmount: 15,
      },
    ],
    jobs: [{ reference: `JOB ${LONG_WORD}`, externalReference: UNICODE, podStatus: "complete" }],
    ...overrides,
  };
}

describe("generateInvoicePdf", () => {
  beforeEach(() => {
    /* No network in tests: the logo fetch fails and the PDF renders without it. */
    vi.stubGlobal("fetch", vi.fn(async () => new Response("", { status: 404 })));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("renders non-WinAnsi text and an unbreakable word without throwing", async () => {
    const { bytes, filename } = await generateInvoicePdf(input());
    const doc = await PDFDocument.load(bytes);
    expect(doc.getPageCount()).toBeGreaterThanOrEqual(1);
    expect(filename).toBe("INV-2026-0001.pdf");
  });

  it("flows many lines and a huge description onto numbered continuation pages", async () => {
    const lines = Array.from({ length: 60 }, (_, index) => ({
      description: `Line ${index} ${UNICODE}`,
      quantity: 1,
      unitPrice: 10,
      vatRate: 20,
      netAmount: 10,
      vatAmount: 2,
      grossAmount: 12,
    }));
    /* 40 long words wrap to more lines than one page holds, so this row is
       split across pages. */
    lines.push({ ...lines[0], description: `${LONG_WORD} `.repeat(40) });

    const { bytes } = await generateInvoicePdf(input({ lines }));
    const doc = await PDFDocument.load(bytes);
    expect(doc.getPageCount()).toBeGreaterThan(2);
  }, 20000);

  it("survives a malformed currency code", async () => {
    await expect(generateInvoicePdf(input({ currency: "not-a-code" }))).resolves.toBeTruthy();
  });
});

describe("formatPdfMoney", () => {
  it("keeps the euro sign and falls back to the ISO code when Intl rejects the currency", () => {
    expect(formatPdfMoney(12.5, "EUR")).toBe("€12.50");
    expect(formatPdfMoney(12.5, "??")).toBe("?? 12.50");
    expect(formatPdfMoney(Number.NaN, "GBP")).toBe("£0.00");
  });
});
