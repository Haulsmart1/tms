import {
  PDFDocument,
  rgb,
  type PDFFont,
  type PDFPage,
} from "pdf-lib";

import { embedUnicodeFonts, pdfSafeText } from "../printing/pdfFonts";
import { fitPdfText, loadPdfLogo, wrapPdfText } from "../printing/pdfText";

/*
  Quotation PDF.

  Fonts: embedded DejaVu Sans (lib/printing/pdfFonts.ts). This file used to
  avoid Helvetica's WinAnsi crash by DELETING every character outside ASCII
  plus the pound sign, so EUR prices lost their symbol and "Müller, Köln"
  printed as "Mller, Kln" (INV-5). Text is now kept and drawn through
  pdfSafeText, which only turns a glyph the font genuinely lacks into "?".
*/

type QuotePdfLine = {
  description: string;
  quantity: number;
  unitPrice: number;
  vatRate: number;
  lineTotal: number;
};

export type QuotationPdfCompanyProfile = {
  company_name?: string | null;
  trading_name?: string | null;
  address_line_1?: string | null;
  address_line_2?: string | null;
  city?: string | null;
  region?: string | null;
  postcode?: string | null;
  country_code?: string | null;
  business_phone?: string | null;
  business_email?: string | null;
  website?: string | null;
  registration_number?: string | null;
  vat_number?: string | null;
};

export type QuotationPdfDocumentSettings = {
  show_logo?: boolean | null;
  logo_signed_url?: string | null;
  show_contact_details?: boolean | null;
  show_company_registration?: boolean | null;
  show_vat_number?: boolean | null;
  footer_text?: string | null;
  generic_document_note?: string | null;
};

export type GenerateQuotationPdfInput = {
  companyName: string;
  companyProfile?: QuotationPdfCompanyProfile | null;
  documentSettings?: QuotationPdfDocumentSettings | null;
  customerName: string;
  quoteNumber: string;
  quoteDate: string | null;
  validUntil: string | null;
  currency: string;
  subtotal: number;
  vatTotal: number;
  total: number;
  notes?: string | null;
  customerReference?: string | null;
  poReference?: string | null;
  lines: QuotePdfLine[];
  termsSnapshot?: string | null;
};

type Color = ReturnType<typeof rgb>;

type PdfContext = {
  pdf: PDFDocument;
  page: PDFPage;
  normal: PDFFont;
  bold: PDFFont;
  y: number;
  quoteNumber: string;
  onPageBreak: (() => void) | null;
};

const PAGE_WIDTH = 595.28;
const PAGE_HEIGHT = 841.89;
const MARGIN = 42;
const RIGHT = PAGE_WIDTH - MARGIN;
const WIDTH = PAGE_WIDTH - MARGIN * 2;
const BOTTOM = 54;
const CONTINUATION_TOP = PAGE_HEIGHT - 62;

const NAVY = rgb(0.055, 0.1, 0.18);
const MUTED = rgb(0.34, 0.4, 0.48);
const LIGHT = rgb(0.95, 0.96, 0.97);
const LINE = rgb(0.82, 0.84, 0.87);
const ACCENT = rgb(0.78, 0.53, 0.08);

const COLUMNS = {
  description: MARGIN + 8,
  descriptionWidth: 290,
  qty: 350,
  qtyWidth: 50,
  rate: 405,
  rateWidth: 56,
  vat: 465,
  vatWidth: 38,
  net: RIGHT - 8,
};

function clean(value: unknown): string {
  return String(value ?? "").trim();
}

function money(value: number, currency: string): string {
  const amount = Number.isFinite(value) ? value : 0;
  const code = String(currency || "GBP").trim().toUpperCase();

  try {
    return new Intl.NumberFormat("en-GB", {
      style: "currency",
      currency: code,
    }).format(amount);
  } catch {
    return `${code} ${amount.toFixed(2)}`;
  }
}

function date(value: string | null): string {
  if (!value) {
    return "-";
  }

  const parsed = new Date(`${value}T00:00:00Z`);

  if (Number.isNaN(parsed.getTime())) {
    return value;
  }

  return parsed.toLocaleDateString("en-GB", {
    timeZone: "UTC",
  });
}

/** The only place this file calls page.drawText. */
function draw(
  page: PDFPage,
  text: string,
  options: { x: number; y: number; size: number; font: PDFFont; color?: Color }
) {
  const safe = pdfSafeText(text, options.font);

  if (!safe) {
    return;
  }

  page.drawText(safe, {
    x: options.x,
    y: options.y,
    size: options.size,
    font: options.font,
    color: options.color ?? NAVY,
  });
}

function rightText(
  page: PDFPage,
  font: PDFFont,
  value: string,
  y: number,
  options: { size: number; right?: number; maxWidth?: number; color?: Color }
) {
  const fitted =
    options.maxWidth !== undefined
      ? fitPdfText(value, font, options.size, options.maxWidth)
      : pdfSafeText(value, font);

  draw(page, fitted, {
    x: (options.right ?? RIGHT) - font.widthOfTextAtSize(fitted, options.size),
    y,
    size: options.size,
    font,
    color: options.color,
  });
}

function drawRule(context: PdfContext, y: number) {
  context.page.drawLine({
    start: { x: MARGIN, y },
    end: { x: RIGHT, y },
    thickness: 0.7,
    color: LINE,
  });
}

function addPage(context: PdfContext) {
  context.page = context.pdf.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
  context.y = CONTINUATION_TOP;

  draw(context.page, "QUOTATION", {
    x: MARGIN,
    y: PAGE_HEIGHT - 38,
    size: 8,
    font: context.bold,
    color: MUTED,
  });

  rightText(context.page, context.bold, context.quoteNumber, PAGE_HEIGHT - 38, {
    size: 8,
    maxWidth: WIDTH - 80,
  });

  drawRule(context, PAGE_HEIGHT - 47);
  context.onPageBreak?.();
}

function ensureSpace(context: PdfContext, required: number) {
  if (context.y - required < BOTTOM) {
    addPage(context);
  }
}

function drawText(
  context: PdfContext,
  value: string,
  options?: {
    x?: number;
    size?: number;
    bold?: boolean;
    maxWidth?: number;
    gapAfter?: number;
    color?: Color;
    lineHeight?: number;
  }
) {
  const size = options?.size ?? 9;
  const font = options?.bold ? context.bold : context.normal;
  const x = options?.x ?? MARGIN;
  const maxWidth = options?.maxWidth ?? RIGHT - x;
  const lineHeight = options?.lineHeight ?? size * 1.35;

  for (const line of wrapPdfText(value, font, size, maxWidth)) {
    ensureSpace(context, lineHeight);
    draw(context.page, line, { x, y: context.y, size, font, color: options?.color });
    context.y -= lineHeight;
  }

  context.y -= options?.gapAfter ?? 2;
}

function drawTotals(context: PdfContext, input: GenerateQuotationPdfInput) {
  ensureSpace(context, 102);

  const labelX = 355;
  const valueWidth = RIGHT - labelX - 60;

  const rows: Array<[string, string]> = [
    ["Subtotal", money(input.subtotal, input.currency)],
    ["VAT", money(input.vatTotal, input.currency)],
  ];

  for (const [label, value] of rows) {
    draw(context.page, label, { x: labelX, y: context.y, size: 9, font: context.normal });
    rightText(context.page, context.bold, value, context.y, { size: 9, maxWidth: valueWidth });
    context.y -= 20;
  }

  drawRule(context, context.y + 8);

  draw(context.page, "TOTAL", { x: labelX, y: context.y - 5, size: 12, font: context.bold });
  rightText(context.page, context.bold, money(input.total, input.currency), context.y - 5, {
    size: 13,
    maxWidth: valueWidth,
  });

  context.y -= 34;
}

function drawLineTableHeader(context: PdfContext) {
  const top = context.y;

  context.page.drawRectangle({
    x: MARGIN,
    y: top - 21,
    width: WIDTH,
    height: 23,
    color: LIGHT,
  });

  const labelY = top - 14;
  draw(context.page, "Description", { x: COLUMNS.description, y: labelY, size: 7.5, font: context.bold });
  draw(context.page, "Qty", { x: COLUMNS.qty, y: labelY, size: 7.5, font: context.bold });
  draw(context.page, "Rate", { x: COLUMNS.rate, y: labelY, size: 7.5, font: context.bold });
  draw(context.page, "VAT", { x: COLUMNS.vat, y: labelY, size: 7.5, font: context.bold });
  rightText(context.page, context.bold, "Net", labelY, { size: 7.5, right: COLUMNS.net });

  context.y = top - 32;
}

function drawLineItem(context: PdfContext, line: QuotePdfLine, currency: string) {
  const size = 8;
  const lineHeight = 10;
  const descriptionLines = wrapPdfText(line.description, context.normal, size, COLUMNS.descriptionWidth);
  const maxLinesPerPage = Math.max(1, Math.floor((CONTINUATION_TOP - 32 - BOTTOM - 12) / lineHeight));

  let remaining = descriptionLines;
  let first = true;

  while (first || remaining.length > 0) {
    const chunk = remaining.slice(0, maxLinesPerPage);
    remaining = remaining.slice(chunk.length);

    const rowHeight = Math.max(24, chunk.length * lineHeight + 12);
    ensureSpace(context, rowHeight);

    const top = context.y;
    let descriptionY = top;

    for (const descriptionLine of chunk) {
      draw(context.page, descriptionLine, { x: COLUMNS.description, y: descriptionY, size, font: context.normal });
      descriptionY -= lineHeight;
    }

    if (first) {
      draw(context.page, fitPdfText(String(line.quantity), context.normal, size, COLUMNS.qtyWidth), {
        x: COLUMNS.qty,
        y: top,
        size,
        font: context.normal,
      });

      draw(context.page, fitPdfText(money(line.unitPrice, currency), context.normal, size, COLUMNS.rateWidth), {
        x: COLUMNS.rate,
        y: top,
        size,
        font: context.normal,
      });

      draw(context.page, fitPdfText(`${Number(line.vatRate)}%`, context.normal, size, COLUMNS.vatWidth), {
        x: COLUMNS.vat,
        y: top,
        size,
        font: context.normal,
      });

      rightText(context.page, context.bold, money(line.lineTotal, currency), top, {
        size,
        right: COLUMNS.net,
        maxWidth: COLUMNS.net - (COLUMNS.vat + COLUMNS.vatWidth) - 4,
      });
    }

    context.page.drawLine({
      start: { x: MARGIN, y: top - rowHeight + 7 },
      end: { x: RIGHT, y: top - rowHeight + 7 },
      thickness: 0.45,
      color: LINE,
    });

    context.y = top - rowHeight;
    first = false;
  }
}

export async function generateQuotationPdf(
  input: GenerateQuotationPdfInput
): Promise<{
  bytes: Uint8Array;
  filename: string;
}> {
  const pdf = await PDFDocument.create();
  const { regular: normal, bold } = await embedUnicodeFonts(pdf);

  const context: PdfContext = {
    pdf,
    page: pdf.addPage([PAGE_WIDTH, PAGE_HEIGHT]),
    normal,
    bold,
    y: PAGE_HEIGHT - MARGIN,
    quoteNumber: clean(input.quoteNumber),
    onPageBreak: null,
  };

  const profile = input.companyProfile ?? {};
  const settings = input.documentSettings ?? {};

  const logo =
    settings.show_logo !== false
      ? await loadPdfLogo(pdf, settings.logo_signed_url)
      : null;

  let headerTextX = MARGIN;

  if (logo) {
    const scale = Math.min(68 / logo.height, 78 / logo.width);
    const logoWidth = logo.width * scale;
    const logoHeight = logo.height * scale;

    context.page.drawImage(logo, {
      x: MARGIN,
      y: PAGE_HEIGHT - MARGIN - logoHeight,
      width: logoWidth,
      height: logoHeight,
    });

    headerTextX = MARGIN + logoWidth + 16;
  }

  const headerTextWidth = RIGHT - 150 - headerTextX;

  const displayCompany =
    clean(profile.company_name) ||
    clean(profile.trading_name) ||
    clean(input.companyName);

  draw(context.page, fitPdfText(displayCompany, bold, 11, headerTextWidth), {
    x: headerTextX,
    y: PAGE_HEIGHT - MARGIN - 13,
    size: 11,
    font: bold,
  });

  const address = [
    profile.address_line_1,
    profile.address_line_2,
    profile.city,
    profile.region,
    profile.postcode,
    profile.country_code,
  ]
    .map(clean)
    .filter(Boolean)
    .join(", ");

  let headerY = PAGE_HEIGHT - MARGIN - 29;

  if (address) {
    for (const addressLine of wrapPdfText(address, normal, 7.4, headerTextWidth).slice(0, 3)) {
      draw(context.page, addressLine, { x: headerTextX, y: headerY, size: 7.4, font: normal, color: MUTED });
      headerY -= 9.5;
    }
  }

  if (settings.show_contact_details !== false) {
    const contacts = [clean(profile.business_phone), clean(profile.business_email), clean(profile.website)]
      .filter(Boolean)
      .join("   ");

    if (contacts) {
      draw(context.page, fitPdfText(contacts, normal, 7, headerTextWidth), {
        x: headerTextX,
        y: headerY - 2,
        size: 7,
        font: normal,
        color: MUTED,
      });
    }
  }

  if (settings.show_company_registration !== false && clean(profile.registration_number)) {
    rightText(context.page, normal, `Company No: ${clean(profile.registration_number)}`, PAGE_HEIGHT - MARGIN - 14, {
      size: 7,
      maxWidth: 140,
    });
  }

  if (settings.show_vat_number !== false && clean(profile.vat_number)) {
    rightText(context.page, normal, `VAT No: ${clean(profile.vat_number)}`, PAGE_HEIGHT - MARGIN - 27, {
      size: 7,
      maxWidth: 140,
    });
  }

  context.y = PAGE_HEIGHT - 148;
  drawRule(context, context.y + 18);

  drawText(context, "Quotation", { size: 22, bold: true, gapAfter: 3 });
  drawText(context, context.quoteNumber, { size: 14, bold: true, gapAfter: 14, color: ACCENT });

  const detailTop = context.y;
  const rightX = 382;
  const leftWidth = rightX - MARGIN - 16;

  drawText(context, "CUSTOMER", { size: 7, bold: true, gapAfter: 4, color: MUTED, maxWidth: leftWidth });
  drawText(context, input.customerName, { size: 10, bold: true, gapAfter: 9, maxWidth: leftWidth });
  drawText(context, "CUSTOMER REFERENCE", { size: 7, bold: true, gapAfter: 3, color: MUTED, maxWidth: leftWidth });
  drawText(context, clean(input.customerReference) || "-", { size: 9, gapAfter: 8, maxWidth: leftWidth });
  drawText(context, "PO REFERENCE", { size: 7, bold: true, gapAfter: 3, color: MUTED, maxWidth: leftWidth });
  drawText(context, clean(input.poReference) || "-", { size: 9, maxWidth: leftWidth });

  const firstPage = pdf.getPage(0);
  const onFirstPage = context.page === firstPage;
  const leftBottom = context.y;
  const rightWidth = RIGHT - rightX;

  draw(firstPage, "QUOTE DATE", { x: rightX, y: detailTop, size: 7, font: bold, color: MUTED });
  rightText(firstPage, normal, date(input.quoteDate), detailTop - 14, { size: 9, maxWidth: rightWidth });

  draw(firstPage, "VALID UNTIL", { x: rightX, y: detailTop - 43, size: 7, font: bold, color: MUTED });
  rightText(firstPage, normal, date(input.validUntil), detailTop - 57, { size: 9, maxWidth: rightWidth });

  draw(firstPage, "TOTAL", { x: rightX, y: detailTop - 86, size: 7, font: bold, color: MUTED });
  rightText(firstPage, bold, money(input.total, input.currency), detailTop - 101, { size: 11, maxWidth: rightWidth });

  context.y = onFirstPage ? Math.min(leftBottom, detailTop - 115) - 12 : context.y - 12;

  drawRule(context, context.y + 8);
  context.y -= 10;

  ensureSpace(context, 60);
  drawLineTableHeader(context);
  context.onPageBreak = () => drawLineTableHeader(context);

  for (const line of input.lines) {
    drawLineItem(context, line, input.currency);
  }

  context.onPageBreak = null;
  context.y -= 8;

  drawTotals(context, input);

  if (clean(input.notes)) {
    ensureSpace(context, 60);
    drawText(context, "NOTES", { size: 7, bold: true, gapAfter: 5, color: MUTED });
    drawText(context, clean(input.notes), { size: 8, gapAfter: 14 });
  }

  if (clean(settings.generic_document_note)) {
    ensureSpace(context, 60);
    drawRule(context, context.y + 7);
    drawText(context, clean(settings.generic_document_note), { size: 7.5, gapAfter: 12, color: MUTED });
  }

  if (clean(input.termsSnapshot)) {
    ensureSpace(context, 70);
    drawRule(context, context.y + 8);
    drawText(context, "TERMS & CONDITIONS", { size: 10, bold: true, gapAfter: 10 });
    drawText(context, clean(input.termsSnapshot), { size: 7.4, lineHeight: 10, maxWidth: WIDTH });
  }

  if (clean(settings.footer_text)) {
    ensureSpace(context, 44);
    drawRule(context, context.y + 8);
    drawText(context, clean(settings.footer_text), { size: 7, color: MUTED });
  }

  const pages = pdf.getPages();

  pages.forEach((page, index) => {
    page.drawLine({
      start: { x: MARGIN, y: 36 },
      end: { x: RIGHT, y: 36 },
      thickness: 0.45,
      color: LINE,
    });

    draw(page, fitPdfText(displayCompany, normal, 6.8, WIDTH - 90), {
      x: MARGIN,
      y: 22,
      size: 6.8,
      font: normal,
      color: MUTED,
    });

    rightText(page, normal, `Page ${index + 1} of ${pages.length}`, 22, {
      size: 6.8,
      color: MUTED,
    });
  });

  const safeNumber = context.quoteNumber.replace(/[^A-Za-z0-9._-]+/g, "-") || "quotation";

  return {
    bytes: await pdf.save(),
    filename: `Quotation-${safeNumber}.pdf`,
  };
}
